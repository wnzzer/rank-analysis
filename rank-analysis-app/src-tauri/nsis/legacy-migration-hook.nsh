; =====================================================================
; legacy-migration-hook.nsh — 接管 "lol-record-analysis-app" 旧安装
; =====================================================================
;
; ## 为什么需要这个钩子
;
; 改名（lol-record-analysis-app -> Rank Analysis）只改了 productName，没改
; identifier（bundle id）。原设计以为 NSIS 靠 identifier 识别"这是不是同一个
; 应用的旧安装"，实测并非如此——Tauri NSIS 模板（tauri-bundler installer.nsi）
; 里，卸载注册表键和"记住上次安装目录"的键，用的都是 productName：
;
;   !define UNINSTKEY      "...\Uninstall\${PRODUCTNAME}"
;   !define MANUPRODUCTKEY "Software\${MANUFACTURER}\${PRODUCTNAME}"
;
; productName 一变，这两个键对新安装程序来说都是"从没见过的全新键"，于是：
;
;   1. .onInit 里的 RestorePreviousInstallLocation 读 MANUPRODUCTKEY 直接
;      miss，新安装被当成第一次装，旧版永远不会被自动发现、更不会被卸载；
;   2. 自动更新流程下安装程序带 `/UPDATE` 参数跑（$UpdateMode=1）。
;      CreateOrUpdateStartMenuShortcut / CreateOrUpdateDesktopShortcut 在探测
;      不到"已有指向新 exe 的旧快捷方式"时，见 $UpdateMode=1 就直接 Return——
;      这是新 productName 的第一次安装，自然没有任何旧快捷方式指向新 exe，
;      于是新版装完一个快捷方式都没有；
;   3. 用户开始菜单/桌面上原来的快捷方式还留着、还指向旧 exe，旧版本每次
;      启动照常做静默更新检查，又发现"有新版"，用户又更新一次——死循环，
;      旧版永远卡在用户的启动入口里出不去，最终两份安装、两条"应用和功能"
;      条目、两份逐渐分叉的 config.yaml。
;
; 本文件实现 NSIS_HOOK_POSTINSTALL，在 Section Install 尾部（模板已经建完
; 新版快捷方式之后，见 installer.nsi 里 `!ifmacrodef NSIS_HOOK_POSTINSTALL`
; 的插入位置）跑，做四件事：
;
;   1. 读旧版卸载注册表项的 UninstallString / InstallLocation
;      （HKCU 优先——tauri.conf.json 的 nsis.installMode = "currentUser"
;      决定了旧版当年只会写 HKCU；仍防御性地看一眼 HKLM，应对手工改过安装
;      模式，或日后把 installMode 换成 perMachine/both 的情况）；
;   2. 把旧版 InstallLocation 下的 config.yaml / device_id 复制到新
;      $INSTDIR——顺序陷阱：必须在卸载旧版*之前*做，因为卸载会删掉上面
;      读到的注册表键，届时旧 InstallLocation 就彻底查不到了。这一步也是
;      唯一能覆盖"用户当年把旧版装到了非默认目录"场景的地方：
;      src-tauri/src/migrate.rs 里硬编码的 %LOCALAPPDATA%\lol-record-analysis-app\
;      只对默认安装目录成立，自定义目录下它会静默 no-op；只有这里读到的
;      注册表值知道旧版的真实安装路径；
;   3. 用 UninstallString 自带的 `_?=<InstallLocation>` 参数静默同步跑旧版
;      卸载程序——`_?=` 让卸载程序原地同步执行，而不是自复制到 $TEMP 后台
;      异步跑（那样我们没法知道它何时结束，也就没法保证"卸载完再建新快捷
;      方式"这个顺序）；
;   4. 清理旧开始菜单/桌面快捷方式，无条件为新版本创建同名快捷方式，绕开
;      上面第 2 点提到的"更新模式下探测不到旧快捷方式就不建"的坑。
;
; ## migrate.rs 为什么没被删
;
; 这个钩子只覆盖"用户通过 NSIS 安装程序装/更新"这一条路径。绿色版解压运行、
; 用户手工把新版文件拷进旧目录、或者这个钩子本身跑失败（见下面的容错原则）
; 等场景，仍然要靠 migrate.rs 在应用启动时兜底迁移。migrate.rs 的"目标目录
; 已有 config.yaml 就整体短路"逻辑，也让它在钩子已经搬过数据时自动 no-op，
; 不会重复搬运或覆盖。
;
; ## 容错原则
;
; 下面每一步都可能因为各种原因失败（注册表没有旧安装、文件被占用、卸载程序
; 报错……），但**新版安装本身不能因此失败**：宁可留一份卸载不掉的旧安装，
; 也不能让用户新版都装不上。所以：
; - 找不到旧安装（读不到 UninstallString/InstallLocation）时，整段直接跳过；
; - 复制文件前用 ${FileExists} 判断源存在、目标不存在，不覆盖已有数据；
; - ExecWait 卸载旧版的返回值不做任何检查，失败也继续往下走；
; - 没有一处会 Abort 安装。

Var LegacyUninstallString
Var LegacyInstallLocation
Var LegacyInstallLocationUnquoted
Var LegacyRegKey
Var LegacyExecExitCode
Var LegacyStrLen

!macro NSIS_HOOK_POSTINSTALL
  ; 旧安装的卸载注册表键：固定用改名前的 productName 拼，构造方式与模板的
  ; UNINSTKEY 完全一致（见上面背景说明）。这里故意写死字符串而不是引用
  ; ${PRODUCTNAME}——${PRODUCTNAME} 现在是新名字"Rank Analysis"，这里要挂的
  ; 是旧名字。
  StrCpy $LegacyRegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\lol-record-analysis-app"

  ; installMode=currentUser 下旧版只会写 HKCU，但仍防御性地看一眼 HKLM
  ClearErrors
  ReadRegStr $LegacyUninstallString HKCU "$LegacyRegKey" "UninstallString"
  ReadRegStr $LegacyInstallLocation HKCU "$LegacyRegKey" "InstallLocation"
  ${If} $LegacyUninstallString == ""
    ClearErrors
    ReadRegStr $LegacyUninstallString HKLM "$LegacyRegKey" "UninstallString"
    ReadRegStr $LegacyInstallLocation HKLM "$LegacyRegKey" "InstallLocation"
  ${EndIf}

  ; 读不到旧安装（用户本来就是全新用户，或旧安装已经被清理过）：直接跳过
  ; 下面所有步骤，不产生任何副作用。
  ${If} $LegacyUninstallString != ""
  ${AndIf} $LegacyInstallLocation != ""
    ; Tauri 写注册表时用 $\"..$\" 包了一层字面引号
    ; （WriteRegStr ... "InstallLocation" "$\"$INSTDIR$\""），读回来的
    ; $LegacyInstallLocation 本身就带首尾引号，直接拼文件路径会多出一层。
    ; 这里剥掉引号，单独留一份不带引号的版本用于拼路径；
    ; $LegacyInstallLocation 本身原样保留，给下面的 `_?=` 参数用
    ; （`_?=` 就是期待一个可能带引号的路径，不需要我们再手工加引号）。
    StrCpy $LegacyInstallLocationUnquoted $LegacyInstallLocation
    StrCpy $LegacyStrLen $LegacyInstallLocationUnquoted 1
    ${If} $LegacyStrLen == '"'
      StrLen $LegacyStrLen $LegacyInstallLocationUnquoted
      IntOp $LegacyStrLen $LegacyStrLen - 2
      StrCpy $LegacyInstallLocationUnquoted $LegacyInstallLocationUnquoted $LegacyStrLen 1
    ${EndIf}

    ; ---- 第 2 步：先搬用户数据，再卸载旧版（顺序陷阱，见文件头说明） ----
    ; 只在源存在、目标不存在时才复制：目标已有说明钩子之前跑过、或用户在
    ; 新版下已经产生了自己的配置，两种情况都不该覆盖。
    ${If} ${FileExists} "$LegacyInstallLocationUnquoted\config.yaml"
    ${AndIfNot} ${FileExists} "$INSTDIR\config.yaml"
      ClearErrors
      CopyFiles /SILENT "$LegacyInstallLocationUnquoted\config.yaml" "$INSTDIR\config.yaml"
    ${EndIf}
    ${If} ${FileExists} "$LegacyInstallLocationUnquoted\device_id"
    ${AndIfNot} ${FileExists} "$INSTDIR\device_id"
      ClearErrors
      CopyFiles /SILENT "$LegacyInstallLocationUnquoted\device_id" "$INSTDIR\device_id"
    ${EndIf}

    ; ---- 第 3 步：静默同步卸载旧版 ----
    ; $LegacyUninstallString 已经是形如 "C:\...\uninstall.exe" 的带引号
    ; 字符串（同样是 Tauri 那层 $\"..$\"），不需要再手工加引号。
    ; /S 全静默，不弹确认页/进度页打扰用户；
    ; _?=<安装目录> 让卸载程序原地同步跑完再返回，而不是自复制到 $TEMP
    ; 后台异步跑——不加这个参数我们就没法知道旧版何时卸载完，也就没法
    ; 保证下面创建新快捷方式时旧安装已经清理干净。
    ; 退出码不检查：卸载失败也不阻断新版安装。
    ClearErrors
    ExecWait '$LegacyUninstallString /S _?=$LegacyInstallLocation' $LegacyExecExitCode

    ; ---- 第 4 步：清理旧快捷方式、无条件建新快捷方式 ----
    ; 旧快捷方式留着就是"用户点了却启动旧版"这个坑的根源。
    Delete "$SMPROGRAMS\lol-record-analysis-app.lnk"
    Delete "$DESKTOP\lol-record-analysis-app.lnk"

    ; 无条件创建：绕开模板 CreateOrUpdateStartMenuShortcut /
    ; CreateOrUpdateDesktopShortcut 在 $UpdateMode=1 时的提前 Return——
    ; 这是新 productName 的第一次安装，模板判断不出"已有匹配的旧快捷方式"，
    ; 会认为不需要建；但上面已经把用户原来的快捷方式删了，不主动建的话
    ; 用户会彻底找不到入口。
    ;
    ; 项目当前未设置 nsis.startMenuFolder（$AppStartMenuFolder 为空），
    ; 快捷方式直接建在 $SMPROGRAMS 根目录，与模板默认行为一致；若日后配置
    ; 了 startMenuFolder，这里也要同步改成 "$SMPROGRAMS\$AppStartMenuFolder\"
    ; （参考模板的 CreateOrUpdateStartMenuShortcut 函数）。
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
