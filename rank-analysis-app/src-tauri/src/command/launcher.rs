//! # 免 WeGame 启动命令模块
//!
//! 直接拉起国服英雄联盟的「腾讯登录客户端」（`Launcher\Client.exe`，回退
//! `TCLS\Client.exe`），跳过 WeGame 主客户端。WeGame 点「开始游戏」本质就是拉起
//! 这个登录客户端；用绝对路径直接 spawn 它即可，登录后它会链式拉起
//! `RiotClientServices → LeagueClient → LeagueClientUx`，随后本工具的 LCU 连接
//! 自动就绪。注意：仍会弹腾讯登录窗，非免密登录。
//!
//! ## 安装目录发现（无需读注册表）
//!
//! 1. **config 记忆**（主来源）：客户端在线时由 [`remember_install_root`]（在
//!    `game_state_monitor` 检测到「已连接」时调用）从运行进程反推根目录并持久化。
//! 2. **进程反推**：极少数「已连着还点启动」时，直接从运行进程取。
//! 3. **扫盘兜底**：遍历盘符找默认安装位置 `<盘>:\WeGameApps\英雄联盟`。
//!
//! 三者皆失败时返回明确错误，引导用户先手动打开一次游戏（之后即被记忆）。

// 安装目录发现 / 记忆整条链路都基于 Windows 国服的目录布局（`<root>\Launcher\Client.exe`），
// 非 Windows 平台不编译，避免把 Windows 假设套到别的平台上（见 `remember_install_root`）。
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use crate::config::{self, Value};

/// 游戏安装根目录的 config 键；与前端 `CONFIG_KEYS.gameInstallPath` 对应。
#[cfg(target_os = "windows")]
const GAME_INSTALL_PATH_KEY: &str = "gameInstallPath";

/// 安装根目录下的登录客户端候选路径，按优先级排列（Windows 国服）。
///
/// 优先 `Launcher\Client.exe`（LeagueAkari 实测同款、最稳），回退 `TCLS\Client.exe`
/// （部分版本/机器只装了这个）。仅拼路径、不查存在性，便于纯逻辑单测。
#[cfg(target_os = "windows")]
fn launch_target_candidates(root: &Path) -> [PathBuf; 2] {
    [
        root.join("Launcher").join("Client.exe"),
        root.join("TCLS").join("Client.exe"),
    ]
}

/// 在安装根目录下定位首个真实存在的登录客户端 exe（Windows 国服）。
#[cfg(target_os = "windows")]
fn resolve_launch_target(root: &Path) -> Option<PathBuf> {
    launch_target_candidates(root)
        .into_iter()
        .find(|p| p.is_file())
}

/// 读取 config 中记忆的安装根目录（存在且仍是有效目录时才返回）。
#[cfg(target_os = "windows")]
async fn read_remembered_root() -> Option<PathBuf> {
    let value = config::get_config(GAME_INSTALL_PATH_KEY).await.ok()?;
    let root = PathBuf::from(config::extract_string(&value)?);
    root.is_dir().then_some(root)
}

/// 发现游戏安装根目录：config 记忆 → 运行进程反推 → 扫盘默认位置（Windows 国服）。
#[cfg(target_os = "windows")]
async fn discover_game_root() -> Option<PathBuf> {
    // 1) config 记忆（主来源）
    if let Some(root) = read_remembered_root().await {
        return Some(root);
    }
    // 2) 客户端正在运行时直接反推（少见：已连着还点启动）
    if let Some(root) = crate::lcu::util::token::get_client_install_root() {
        if root.is_dir() {
            return Some(root);
        }
    }
    // 3) 扫盘兜底：默认安装位置 <盘>:\WeGameApps\英雄联盟。
    //    以「能否定位到登录客户端 exe」为准，避免命中残留空目录。
    for drive in b'C'..=b'Z' {
        let candidate = PathBuf::from(format!(r"{}:\WeGameApps\英雄联盟", drive as char));
        if resolve_launch_target(&candidate).is_some() {
            return Some(candidate);
        }
    }
    None
}

/// 将安装根目录写入 config（前端包装格式 `{value: String}`）；与已存值一致则跳过写盘。
#[cfg(target_os = "windows")]
async fn persist_install_root(root: &Path) {
    if read_remembered_root().await.as_deref() == Some(root) {
        return; // 已记忆且一致，免去重复落盘
    }
    let mut wrapped = HashMap::new();
    wrapped.insert(
        "value".to_string(),
        Value::String(root.to_string_lossy().to_string()),
    );
    // 不打印具体路径：安装路径可能含用户名，日志开启上报时会外传。
    match config::put_config(GAME_INSTALL_PATH_KEY.to_string(), Value::Map(wrapped)).await {
        Ok(()) => log::info!("已记忆游戏安装目录，之后可免 WeGame 一键启动"),
        Err(e) => log::warn!("记忆游戏安装目录失败: {}", e),
    }
}

/// 在客户端「已连接」时记忆其安装目录（仅 Windows）。
///
/// 由 `game_state_monitor` 在「未连接 → 已连接」转变时调用。此刻
/// `LeagueClientUx.exe` 在运行，可反推出根目录；持久化后即便游戏关闭也能一键启动。
#[cfg(target_os = "windows")]
pub async fn remember_install_root() {
    if let Some(root) = crate::lcu::util::token::get_client_install_root() {
        persist_install_root(&root).await;
    }
}

/// 记忆安装目录（非 Windows 平台空操作）。
///
/// [`get_client_install_root`] 按 Windows 布局 `<root>\LeagueClient\LeagueClientUx.exe`
/// 向上两级取根目录。macOS 的实际布局是
/// `/Applications/League of Legends.app/Contents/LoL/<App>.app/Contents/MacOS/<bin>`，
/// 同样退两级只会得到某个 `.app/Contents`——实测曾把 `LeagueClientUx Helper.app/Contents`
/// 写进 config，并打出「已记忆游戏安装目录，之后可免 WeGame 一键启动」的假日志。
/// 而 [`launch_league`] 在非 Windows 本就直接返回「暂不支持」，这份记忆无人使用，
/// 故整条链路在非 Windows 不编译。
///
/// [`get_client_install_root`]: crate::lcu::util::token::get_client_install_root
#[cfg(not(target_os = "windows"))]
pub async fn remember_install_root() {}

/// 开机自启 Run 键的注册表子路径（HKLM 与 HKCU 共用）。
#[cfg(target_os = "windows")]
const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// 判断 Run 键中某条值的数据是否指向腾讯登录客户端的开机自启程序。
///
/// 登录客户端（`Launcher\Client.exe`）被拉起后，会以管理员权限把
/// `<安装根>\Launcher\startup_runner.exe` 注册为开机自启（值名形如 `Client_26`，
/// 随版本变化），导致每次开机自动弹出 LOL 登录窗。这里按「文件名 + 父目录名」
/// 双重匹配定位，与值名、安装盘符无关，也不会误删其他软件的自启项。
#[cfg(target_os = "windows")]
fn is_login_client_autostart(data: &str) -> bool {
    let path = Path::new(data.trim().trim_matches('"'));
    let name_is = |name: Option<&std::ffi::OsStr>, expect: &str| {
        name.is_some_and(|n| n.eq_ignore_ascii_case(expect))
    };
    name_is(path.file_name(), "startup_runner.exe")
        && name_is(path.parent().and_then(Path::file_name), "Launcher")
}

/// 一次清理的结果。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PurgeOutcome {
    /// 成功删除的自启项数
    pub removed: usize,
    /// 发现了但因无权限（需管理员）未能删除的自启项数
    pub blocked: usize,
}

/// 枚举某个 Run 键视图里指向登录客户端自启程序的值名（只读，普通权限即可）。
#[cfg(target_os = "windows")]
fn find_login_client_autostart(hive: winreg::HKEY, view: u32) -> Vec<String> {
    use winreg::enums::KEY_QUERY_VALUE;
    use winreg::types::FromRegValue;
    use winreg::RegKey;

    let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_QUERY_VALUE | view)
    else {
        return Vec::new();
    };
    key.enum_values()
        .filter_map(Result::ok)
        .filter(|(_, value)| {
            String::from_reg_value(value).is_ok_and(|data| is_login_client_autostart(&data))
        })
        .map(|(name, _)| name)
        .collect()
}

/// 需要扫描的 Run 键视图：HKLM 分别查 64/32 位视图（后者即 WOW6432Node）；
/// HKCU 的 Run 键不受 WOW64 重定向影响，查一次即可。
#[cfg(target_os = "windows")]
fn run_key_views() -> [(winreg::HKEY, u32); 3] {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    [
        (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY),
        (HKEY_CURRENT_USER, 0),
    ]
}

/// 当前残留的 LOL 开机自启项数（只读扫描，不需要管理员）。
#[cfg(target_os = "windows")]
fn count_login_client_autostart() -> usize {
    run_key_views()
        .into_iter()
        .map(|(hive, view)| find_login_client_autostart(hive, view).len())
        .sum()
}

/// 清理腾讯登录客户端注册的 LOL 开机自启项。
///
/// 免 WeGame 直接拉起 `Launcher\Client.exe` 后（经 WeGame 启动亦可能发生），它会
/// 把 `startup_runner.exe` 写入机器级 Run 键（实测在 HKLM 的 32 位视图，即
/// `WOW6432Node`），使 LOL 每次开机自启。本函数扫描 HKLM（64/32 位视图）与 HKCU
/// 的 Run 键，删除所有指向 `Launcher\startup_runner.exe` 的值。
///
/// 删除 HKLM 值需要管理员权限。线上日志表明多数用户以普通权限运行本工具也能
/// 连上客户端（「能连上即已提权」的假设不成立），此时只能记为 `blocked`，由
/// [`purge_and_report`] 通知前端引导用户一键提权清理。
#[cfg(target_os = "windows")]
pub fn purge_login_client_autostart() -> PurgeOutcome {
    use winreg::enums::KEY_SET_VALUE;
    use winreg::RegKey;

    let mut outcome = PurgeOutcome::default();
    for (hive, view) in run_key_views() {
        // 先只读枚举定位目标值名，再以写权限打开删除：普通权限下多数情况
        // 无目标值，避免无谓的 HKLM 写权限请求失败刷日志。
        let targets = find_login_client_autostart(hive, view);
        if targets.is_empty() {
            continue;
        }
        let writable =
            match RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE | view) {
                Ok(k) => k,
                Err(e) => {
                    log::info!("发现 LOL 开机自启项但当前无权限清理（需管理员）: {}", e);
                    outcome.blocked += targets.len();
                    continue;
                }
            };
        for name in targets {
            match writable.delete_value(&name) {
                Ok(()) => {
                    log::info!("已移除腾讯登录客户端注册的 LOL 开机自启项（{}）", name);
                    outcome.removed += 1;
                }
                Err(e) => {
                    log::warn!("移除 LOL 开机自启项 {} 失败: {}", name, e);
                    outcome.blocked += 1;
                }
            }
        }
    }
    outcome
}

/// 清理 LOL 开机自启项（非 Windows 平台占位）。
///
/// macOS 无注册表开机自启机制，此为空操作。
#[cfg(not(target_os = "windows"))]
pub fn purge_login_client_autostart() -> PurgeOutcome {
    PurgeOutcome::default()
}

/// 「有自启项但无权限清理」的最新状态，供前端挂载时查询（事件可能早于前端监听）。
static AUTOSTART_BLOCKED: AtomicBool = AtomicBool::new(false);

/// 「无权限清理」状态变化时推给前端的事件名，载荷为 `bool`（true = 有残留待提权清理）。
pub const AUTOSTART_BLOCKED_EVENT: &str = "lol-autostart-blocked";

/// 更新「无权限清理」状态，变化时通知前端。
fn set_autostart_blocked(app: &AppHandle, blocked: bool) {
    if AUTOSTART_BLOCKED.swap(blocked, Ordering::Relaxed) != blocked {
        if let Err(e) = app.emit(AUTOSTART_BLOCKED_EVENT, blocked) {
            log::warn!("推送 LOL 开机自启状态失败: {}", e);
        }
    }
}

/// 尝试清理 LOL 开机自启项，并把「是否因无权限残留」同步给前端。
///
/// 在启动、客户端连上 / 断开时调用。无权限时前端会提示用户一键提权清理
/// （[`purge_lol_autostart_elevated`]）。
pub fn purge_and_report(app: &AppHandle) {
    let outcome = purge_login_client_autostart();
    set_autostart_blocked(app, outcome.blocked > 0);
}

/// 查询是否存在「发现了但无权限清理」的 LOL 开机自启项。
#[tauri::command]
pub fn get_lol_autostart_blocked() -> bool {
    AUTOSTART_BLOCKED.load(Ordering::Relaxed)
}

/// 弹 UAC 以管理员身份清理 LOL 开机自启项。
///
/// 拉起本程序的提权辅助进程（[`HELPER_PURGE_ARG`]）完成删除并等待其退出，随后
/// 以普通权限只读复查一遍注册表作为最终结论——不依赖辅助进程的退出码。
///
/// # 返回值
///
/// - `Ok(())`: 已清理干净
/// - `Err(String)`: 用户取消 UAC / 拉起失败 / 复查仍有残留 / 非 Windows 平台
#[tauri::command]
pub async fn purge_lol_autostart_elevated(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::observability::track_feature("purge_lol_autostart");
        tokio::task::spawn_blocking(|| run_self_elevated(HELPER_PURGE_ARG, true))
            .await
            .map_err(|e| format!("清理任务异常退出: {}", e))??;
        let remaining = count_login_client_autostart();
        set_autostart_blocked(&app, remaining > 0);
        if remaining > 0 {
            log::warn!("提权清理后仍残留 {} 个 LOL 开机自启项", remaining);
            return Err("清理未完成，请稍后重试。".to_string());
        }
        log::info!("已通过提权清理移除 LOL 开机自启项");
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("当前平台没有 LOL 开机自启项需要清理。".to_string())
    }
}

/// 提权辅助进程：拉起登录客户端并守候清理自启项。参数为登录客户端 exe 路径。
pub const HELPER_LAUNCH_ARG: &str = "--rank-analysis-elevated-launch";

/// 提权辅助进程：清理一次自启项后退出。
pub const HELPER_PURGE_ARG: &str = "--rank-analysis-elevated-purge";

/// 辅助进程拉起登录客户端后守候清理的时长：登录客户端写自启项的时机未实测
/// 确认（启动时 / 登录后 / 链式拉起后都有可能），留足 10 分钟覆盖登录过程。
#[cfg(target_os = "windows")]
const HELPER_WATCH_SECS: u64 = 600;

/// 守候期间的扫描间隔；只读枚举一个小注册表键，开销可忽略。
#[cfg(target_os = "windows")]
const HELPER_POLL_SECS: u64 = 3;

/// 命令行解析出的辅助进程任务。
#[derive(Debug, PartialEq, Eq)]
enum HelperTask {
    Launch(std::path::PathBuf),
    Purge,
}

/// 从命令行参数（不含 argv[0]）解析辅助进程任务；普通启动返回 `None`。
fn parse_helper_args(args: &[String]) -> Option<HelperTask> {
    match args {
        [flag, path] if flag == HELPER_LAUNCH_ARG => {
            Some(HelperTask::Launch(std::path::PathBuf::from(path)))
        }
        [flag] if flag == HELPER_PURGE_ARG => Some(HelperTask::Purge),
        _ => None,
    }
}

/// 若本进程是以提权辅助模式启动的，执行对应任务并返回退出码；普通启动返回 `None`。
///
/// 必须在 `main` 最开头调用：辅助进程不初始化日志 / 上报 / 迁移 / 窗口，跑完即退。
///
/// 为什么需要辅助进程：删 HKLM 的自启项要管理员权限，而本工具通常以普通权限
/// 运行。一键启动本来就要为登录客户端弹一次 UAC，改为把 UAC 给辅助进程——由它
/// （已提权，不会再弹第二次）拉起登录客户端并守候删除自启项，用户体验不变。
pub fn run_helper_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let task = parse_helper_args(&args)?;
    #[cfg(target_os = "windows")]
    {
        Some(match task {
            HelperTask::Purge => {
                if purge_login_client_autostart().blocked == 0 {
                    0
                } else {
                    1
                }
            }
            HelperTask::Launch(exe) => run_launch_helper(&exe),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = task;
        Some(1)
    }
}

/// 辅助进程：拉起登录客户端，随后在守候期内反复清理自启项。
#[cfg(target_os = "windows")]
fn run_launch_helper(exe: &Path) -> i32 {
    // 以管理员身份运行任意传入路径是越权面：只接受真实存在的 `Client.exe`。
    let is_client = exe
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("Client.exe"));
    if !is_client || !exe.is_file() {
        return 2;
    }
    if spawn_detached(exe).is_err() {
        return 1;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(HELPER_WATCH_SECS);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_secs(HELPER_POLL_SECS));
        purge_login_client_autostart();
    }
    0
}

/// `ShellExecuteExW` 在用户取消 UAC 时的错误码（`ERROR_CANCELLED`）。
#[cfg(target_os = "windows")]
const ERROR_CANCELLED: i32 = 1223;

/// 以管理员身份（`runas`，弹 UAC）拉起本程序的辅助模式。
///
/// # 参数
/// - `params`: 命令行参数（已按 Windows 规则加好引号）
/// - `wait`: 是否等待辅助进程退出（最多 30 秒）
///
/// # 返回值
/// - `Err`: 用户取消 UAC 时文案以「已取消」开头，其余为拉起失败说明
#[cfg(target_os = "windows")]
fn run_self_elevated(params: &str, wait: bool) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::shellapi::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use winapi::um::synchapi::WaitForSingleObject;
    use winapi::um::winuser::SW_HIDE;

    // 失败文本里不带路径：路径含用户名，开启上报时会随日志外传。
    let exe = std::env::current_exe().map_err(|e| format!("获取当前程序路径失败: {}", e))?;
    let to_wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
    let verb = to_wide(OsStr::new("runas"));
    let file = to_wide(exe.as_os_str());
    let params = to_wide(OsStr::new(params));

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = if wait { SEE_MASK_NOCLOSEPROCESS } else { 0 };
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(ERROR_CANCELLED) {
            return Err("已取消管理员授权。".to_string());
        }
        return Err(format!("以管理员身份运行失败: {}", err));
    }
    if wait && !info.hProcess.is_null() {
        unsafe {
            WaitForSingleObject(info.hProcess, 30_000);
            CloseHandle(info.hProcess);
        }
    }
    Ok(())
}

/// 免 WeGame 一键启动英雄联盟。
///
/// - **Windows（国服）**：发现安装根目录后，直接 spawn `Launcher\Client.exe`
///   （回退 `TCLS\Client.exe`）。成功仅表示登录客户端进程已拉起——随后会弹腾讯
///   登录窗，用户登录后客户端链式启动。
/// - **macOS / 其他平台**：暂不支持一键启动，直接返回明确错误，引导用户手动打开。
///
/// 拉起后本工具经 `game_state_monitor` 自动感知连接，无需在此等待。
///
/// # 返回值
///
/// - `Ok(())`: 登录客户端已拉起
/// - `Err(String)`: 未找到安装目录 / 未找到登录客户端 / spawn 失败 / 平台暂不支持
#[tauri::command]
pub async fn launch_league() -> Result<(), String> {
    // 两个块都不带 `return`：cfg 会移除其中一个，剩下的那个即函数尾表达式。
    // 写 `return` 会在对应平台触发 clippy::needless_return（-D warnings 下即编译失败）。
    #[cfg(target_os = "windows")]
    {
        launch_league_windows().await?;
        crate::observability::track_feature("launch_league");
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂不支持一键启动游戏，请手动打开英雄联盟。".to_string())
    }
}

/// Windows（国服）一键启动：spawn 腾讯登录客户端。
#[cfg(target_os = "windows")]
async fn launch_league_windows() -> Result<(), String> {
    let root = discover_game_root()
        .await
        .ok_or("未找到英雄联盟安装目录。请先手动打开一次游戏，之后即可一键启动。")?;
    let target = resolve_launch_target(&root).ok_or_else(|| {
        format!(
            "在 {} 下未找到登录客户端（Launcher\\Client.exe 或 TCLS\\Client.exe），安装可能不完整。",
            root.display()
        )
    })?;
    // spawn 前把根目录记下来，下次直接命中（尤其首次经扫盘发现的情况）。
    persist_install_root(&root).await;

    // 经提权辅助进程拉起：登录客户端一启动就会往 HKLM 写开机自启项，只有管理员
    // 进程删得掉。辅助进程顶替原本给登录客户端弹的那次 UAC，并在之后守候清理。
    // Windows 路径不可能含 `"`，直接加引号即可安全传参。
    let params = format!("{} \"{}\"", HELPER_LAUNCH_ARG, target.display());
    match tokio::task::spawn_blocking(move || run_self_elevated(&params, false)).await {
        Ok(Ok(())) => {
            log::info!("已拉起国服登录客户端（免 WeGame，提权辅助进程守候清理自启项）");
            return Ok(());
        }
        // 用户主动取消 UAC：不再退回直接拉起（那会立刻再弹一次 UAC）
        Ok(Err(e)) if e.starts_with("已取消") => {
            return Err("已取消管理员授权，未启动游戏。若弹出 UAC 请点“是”授权。".to_string())
        }
        Ok(Err(e)) => log::warn!("提权辅助进程拉起失败，退回直接拉起登录客户端: {}", e),
        Err(e) => log::warn!("提权辅助任务异常，退回直接拉起登录客户端: {}", e),
    }
    spawn_detached(&target)?;
    log::info!("已拉起国服登录客户端（免 WeGame）");
    Ok(())
}

/// 关闭客户端兜底强杀的进程链，先杀渲染层（Ux）再杀主进程。
///
/// 刻意不含对局进程 `League of Legends.exe`：对局中强退会被判定为逃跑
/// （掉胜点 + 排队惩罚），代价远超「客户端没关干净」，故只关客户端本体。
const CLIENT_PROCESS_CHAIN: [&str; 2] = ["LeagueClientUx.exe", "LeagueClient.exe"];

/// LCU 空 JSON 请求体（`process-control` 退出端点不需要参数）。
#[derive(serde::Serialize)]
struct EmptyJsonBody {}

/// 关闭正在运行的英雄联盟客户端。
///
/// 优先走 LCU 的 `POST /process-control/v1/process/quit` 让客户端优雅退出
/// （等同于点客户端右上角关闭，客户端自行收尾并带走整条进程链）；LCU 不可用
/// 或请求失败（客户端卡死等）时，兜底按进程名强杀
/// `LeagueClientUx.exe` / `LeagueClient.exe`。
///
/// # 返回值
///
/// - `Ok(())`: 已发出优雅退出指令，或已强制结束至少一个客户端进程
/// - `Err(String)`: 两条路径都失败（通常是客户端本就没在运行）
#[tauri::command]
pub async fn close_league() -> Result<(), String> {
    crate::observability::track_feature("close_league");

    let graceful = crate::lcu::util::http::lcu_post::<serde_json::Value, _>(
        "process-control/v1/process/quit",
        &EmptyJsonBody {},
    )
    .await;
    if graceful.is_ok() {
        log::info!("已通过 LCU 优雅退出游戏客户端");
        return Ok(());
    }

    // LCU 打不通时按进程名强杀兜底；单个进程名失败不影响其余
    let killed: u32 = CLIENT_PROCESS_CHAIN
        .iter()
        .map(|name| crate::lcu::util::token::kill_processes_by_name(name).unwrap_or(0))
        .sum();
    if killed > 0 {
        log::info!("已强制结束 {} 个游戏客户端进程", killed);
        Ok(())
    } else {
        Err("未检测到正在运行的游戏客户端。".to_string())
    }
}

/// 启动目标可执行文件（工作目录设为其所在目录），需要提权时自动弹 UAC（仅 Windows）。
///
/// **必须用 `ShellExecuteW` 而非 `std::process::Command`**：国服 `Launcher\Client.exe`
/// 的清单要求管理员权限（含 ACE/TP 反作弊驱动），`CreateProcess`（即 `Command::spawn`）
/// 会以 `ERROR_ELEVATION_REQUIRED`（os error 740）失败。`ShellExecuteW` 用默认动词
/// （`lpVerb = NULL`）会遵循 exe 清单——需要提权时自动弹 UAC（与 WeGame 启动游戏时
/// 弹 UAC 一致），普通 exe 则正常启动。路径作为独立宽字符串参数传入，**不加引号**。
/// 工作目录设为 exe 所在目录，避免其相对依赖的 dll 加载失败。
#[cfg(target_os = "windows")]
fn spawn_detached(exe: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::SW_SHOWNORMAL;

    let work_dir = exe.parent().ok_or("无法推导启动工作目录")?;

    // ShellExecuteW 需要以 null 结尾的宽字符串。
    let to_wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
    let file = to_wide(exe.as_os_str());
    let dir = to_wide(work_dir.as_os_str());

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(), // lpVerb = NULL：默认动词，遵循清单（要求提权则弹 UAC）
            file.as_ptr(),
            std::ptr::null(), // 无参数
            dir.as_ptr(),     // 工作目录 = exe 所在目录
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW 返回值 > 32 表示成功；<= 32 为错误码（用户取消 UAC 时为
    // SE_ERR_ACCESSDENIED 等）。
    if (result as isize) <= 32 {
        return Err(format!(
            "启动登录客户端失败（ShellExecuteW 错误码 {}）；若弹出 UAC 请点“是”授权。",
            result as isize
        ));
    }
    Ok(())
}

#[cfg(test)]
#[cfg(target_os = "windows")]
mod tests {
    use super::*;

    #[test]
    fn launch_candidates_prefer_launcher_over_tcls() {
        let root = Path::new(r"C:\WeGameApps\英雄联盟");
        let candidates = launch_target_candidates(root);

        // 均以 Client.exe 结尾
        assert_eq!(candidates[0].file_name().unwrap(), "Client.exe");
        assert_eq!(candidates[1].file_name().unwrap(), "Client.exe");
        // 优先 Launcher，回退 TCLS
        assert_eq!(
            candidates[0].parent().unwrap().file_name().unwrap(),
            "Launcher"
        );
        assert_eq!(candidates[1].parent().unwrap().file_name().unwrap(), "TCLS");
        // 保持在安装根目录之下
        assert!(candidates[0].starts_with(root));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn login_client_autostart_matches_launcher_startup_runner() {
        // 实测被注册的形态（HKLM\...\Run\Client_26）
        assert!(is_login_client_autostart(
            r"C:\WeGameApps\英雄联盟\Launcher\startup_runner.exe"
        ));
        // 自定义安装盘符/路径、带引号、大小写差异均应命中
        assert!(is_login_client_autostart(
            r#""D:\Games\LOL\launcher\Startup_Runner.EXE""#
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn login_client_autostart_ignores_unrelated_entries() {
        // 其他软件的自启项不能误删
        assert!(!is_login_client_autostart(
            r"C:\Program Files\Tencent\QQNT\QQ.exe"
        ));
        // 文件名相同但不在 Launcher 目录下（防止碰瓷同名 exe）
        assert!(!is_login_client_autostart(
            r"C:\SomeApp\bin\startup_runner.exe"
        ));
        // 父目录对但文件名不对
        assert!(!is_login_client_autostart(
            r"C:\WeGameApps\英雄联盟\Launcher\Client.exe"
        ));
        assert!(!is_login_client_autostart(""));
    }
}

#[cfg(test)]
mod helper_args_tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn should_parse_launch_helper_with_path() {
        assert_eq!(
            parse_helper_args(&args(&[HELPER_LAUNCH_ARG, r"C:\LOL\Launcher\Client.exe"])),
            Some(HelperTask::Launch(std::path::PathBuf::from(
                r"C:\LOL\Launcher\Client.exe"
            )))
        );
    }

    #[test]
    fn should_parse_purge_helper() {
        assert_eq!(
            parse_helper_args(&args(&[HELPER_PURGE_ARG])),
            Some(HelperTask::Purge)
        );
    }

    #[test]
    fn should_treat_normal_startup_as_not_helper() {
        assert_eq!(parse_helper_args(&[]), None);
        // 缺路径 / 多余参数 / 未知参数都不进入辅助模式，按普通启动处理
        assert_eq!(parse_helper_args(&args(&[HELPER_LAUNCH_ARG])), None);
        assert_eq!(parse_helper_args(&args(&[HELPER_PURGE_ARG, "x"])), None);
        assert_eq!(parse_helper_args(&args(&["--foo"])), None);
    }
}
