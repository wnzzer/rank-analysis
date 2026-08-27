# 持续优化迭代计划（离线功能专项）

> 运作方式：每轮列 3-6 个可独立验证的条目；全部完成后在本文件追加下一轮；
> 单条目完成后就地勾选。约束：只做离线功能 / 不依赖运行时外部资源。

## 轮次速览

| 轮 | 一句话摘要 |
|----|-----------|
| R1 | 视觉一致性/可访问性/后端去抖测试化 |
| R2 | 导出 CSV / mono 数字 / emphasis 核查 / 骨架守卫 |
| R3 | 三格式导出 + 聚焦 Esc + 目标备注 |
| R4 | 焦点陷阱 / 路由错误兜底 / 工程约定 / 图形槽 |
| R5 | 格式记忆 / 入口排序 / 目标备份还原 / 亮色核对 |
| R6 | 静态余烬帧 / Record 空态统一 / 备份时间 / 阴影失效修复 |
| R7 | 剪贴板复制 / 走马灯提示 / cursor 审计 / actions 换行 |
| R8 | 备份元信息 / 还原确认 / 秒级时间戳 |
| R9 | 导出路径条 / 恢复默认排序 / 拖拽导入 / 空态走查 |
| R10 | 聚焦导航 / 等待态联动 / 样式快照 |
| R11 | 最近使用排序 / 版本复制 / 聚焦记忆 / README |
| R12 | 还原联动刷新 / 频次上限 / README 英文同步 |
| R13 | Overlay 动效 / 跨断点聚焦保持 / CSV 对位列 |
| R14 | 对手列镜像回退 / Overlay 高度自适应 |
| R15 | 主题跟随评估 / 窄窗图标化 / 轮次索引表 |
| R16 | 面板命令总数 / 聚焦键盘导航 / 拖拽导入引导 |
| R17 | 路径条自动消失 / 导航按钮提示 / ticker 核查 |
| R18 | 空态 #art 收口 / 下拉可达性核实 / 还原链路测试 |
| R19 | 空态三态测试 / 拖拽导入提示 / README 核实 |
| R20 | 重连恢复提示 / 结构断言归并 / 门禁复核 |
| R21 | 重连提示测试化 / 路径条 aria-live 核实 |
| R22 | 卡片键盘可达性 / 空态与主题核实 |
| R23 | 键盘单测 / 完成态与动效核查 |
| R24 | 门禁四绿复核 / 并行流收编落地 |
| R25 | 门禁确认 / Mayhem 一致性核查（移交） |
| R26 | 文档漂移清理 / augment 零覆盖补测 |
| R27 | 平衡标签纯函数抽取与测试化 |
| R28 | utils 零覆盖补测（tier-image/overlayPrefs/colors） |
| R29 | 服务层与剪贴板测试化（http/platform/useCopy） |
| R30 | 模式列表测试化 / configKeys 一致性核查 |
| R31 | Mayhem 空态统一 / draft 缺口边界 / README 同步 |
| R32 | 赛后战报文本格式化与快捷分享（E6）/ 单测补全 |
| R33 | ai.apiKey 云端黑名单安全合规 / PlayerCard 大乱斗角标跳转 |

---

## Round 1 —— 视觉一致性与可访问性收尾 ✅（2026-08-25）

- [x] RecordCardSkeleton 对齐真实行几何，消除加载跳动
- [x] TrendBar 一次性 hex 收编 token
- [x] NavRail 纯图标按钮补 aria-label
- [x] About 页内联 SVG 换 Lucide、版本章换品牌金
- [x] game_state_monitor 去抖抽 resolved_connected 纯函数 + 5 单测

---

## Round 2 —— 离线功能增强 + 数据层细节 ✅（2026-08-26）

- [x] 战绩导出 CSV：save_text_file 命令 + BOM/CRLF/转义 + 5 单测
- [x] PlayerBar 数字字体 Space Mono
- [x] CornerCard emphasis 亮色核查通过
- [x] RecordCardSkeleton reduced-motion 守卫

---

## Round 3 —— 离线功能增强第二批 ✅（2026-08-26）

- [x] 导出三格式下拉（CSV 基础/完整、JSON 全量）+ 8 单测
- [x] Record 聚焦模式 Esc 收回详情
- [x] Growth 目标本地备注（localStorage）
- [x] EmptyState #art 图形槽

---

## Round 4 —— 健壮性与开发者体验 ✅（2026-08-26）

- [x] CommandPalette aria-modal + Tab 焦点陷阱 + 焦点归还
- [x] Framework 路由级错误兜底卡（errorCaptured + renderKey 重试）
- [x] CLAUDE.md 补 PageStage / 样式外置金丝雀两条工程约定
- [x] Growth 两个空态接 #art 图形槽

---

## Round 5 —— 数据与交互的最后一公里 ✅（2026-08-26）

- [x] 导出格式记忆（主按钮直出 + ▾ 重选持久化）
- [x] Home 快捷入口数据驱动 + 上/下移排序持久化
- [x] Growth 目标备份/还原（serializeGoalsBackup/parseGoalsBackup + 备注 remap）
- [x] record 详情 tabs .theme-light 核对通过

---

## Round 6 —— 可感知性补缺 ✅（2026-08-26）

- [x] useEmberField reduced-motion 静态单帧 + 主题切换重绘
- [x] Record 加载失败/筛选空态换 EmptyState（#art），移除 NEmpty 依赖
- [x] Growth 上次备份时间（PageStage #meta）
- [x] 组合阴影失效 bug 修复（亮色 glow=none 与实值并列导致整条丢弃）

---

## Round 7 —— 微交互与一致性终扫 ✅（2026-08-26）

- [x] 导出下拉新增「复制 CSV 到剪贴板」
- [x] Home 走马灯悬停暂停提示
- [x] cursor-pointer 审计：PlayerStatsCard 两处可点击 div 补齐
- [x] PageStage actions 槽 flex-wrap

---

## Round 8 —— 数据完整性收口 ✅（2026-08-26）

- [x] 备份 JSON 纳入 appVersion 元信息
- [x] 还原二次确认：新建目标 >5 条时 confirm 防误导入
- [x] 导出/备份文件名时间戳精确到秒（fake-timers 单测）
- [x] polish-plan 就地勾选 + 归档约定建立

---

## Round 9 —— 体验纵深（离线） ✅（2026-08-26）

- [x] 导出成功路径条：可选中完整路径 + 一键复制 + 关闭
- [x] Home 快捷入口「恢复默认排序」
- [x] Growth 清单卡拖拽 .json 导入（与文件选择同管线）
- [x] 空态文案语气走查通过

---

## Round 10 —— 稳态维护轮（候选池） ✅（2026-08-26）

- [x] Record 聚焦模式上一个/下一个导航（n/total 计数）
- [x] Gaming 等待态文案与 phase 联动细化（大厅/匹配中分档）
- [x] Home.styles.css 关键选择器快照扩容（7 断言）
- [x] Growth 拖拽导入 loading 态（防重入 + 卡内指示 + 虚线高亮）

---

## Round 11 —— 命令面板与身份细节 ✅（2026-08-26）

- [x] sortByUsage 组内频次降序纯函数（分组边界稳定，3 单测）+ 页脚重置常用
- [x] About 版本章点击复制版本号
- [x] Record 聚焦记忆：sessionStorage 会话级恢复（仅宽屏）
- [x] README.zh-CN 功能清单补导出/聚焦模式/成长与效率小节

---

## Round 12 —— 收尾观察轮 ✅（2026-08-26）

- [x] Growth 还原成功后 refreshAll 联动短板卡数据源
- [x] Palette 使用频次持久化仅保留 top 20（0 计数剔除）
- [x] README.md 英文版同步成长小节与 Match History 条目
- [-] console.log 清理暂缓：需区分诊断输出与调试日志（errorHandler 已兜底可见性）

---

## Round 13 —— 真机反馈驱动轮（候选池） ✅（2026-08-26）

- [x] OverlayView maxItems 变化平滑化：条目淡入下滑动画 + reduced-motion 守卫
- [x] Record 聚焦跨断点保持：宽→窄转交 focusGameId 内嵌展开
- [x] 导出 CSV 扩至 11 列：队伍列 + 对手英雄列（teamPosition 防御性匹配，
      缺失留空不编造；基础表头扩至 11 列，单测同步更新）
- [x] Growth 拖拽导入 loading 态（防重入 + 卡内指示 + 虚线高亮）

---

## Round 14 —— 观察轮（候选池沿用 Round 13 未尽项） ✅（2026-08-26）

- [x] 对手英雄列回退策略：teamPosition 缺失时按标准 10 人局
      participantId ±5 镜像配对（非 10 人局/布局不符留空不编造），3 个专项单测
- [x] Overlay maxItems 与屏幕高度自适应：resize 监听 + 高度钳制

### 完成标准
同前。

---

## Round 15 —— 稳态轮（低频维护） ✅（2026-08-26）

- [x] R15-a OverlayView 主题跟随评估：**结论=保持恒暗色**。
      游戏内叠加层面对高亮场景，暗色卡对比度最优；
      跟随羊皮纸亮色反而降低实战可读性（评估记录，无代码改动）
- [x] R15-b 导出按钮组在超窄窗 (<640) 收敛为纯图标
- [x] R15-c polish-plan 增加轮次速览索引表

### 完成标准
同前。

---

## Round 16 —— 微体验三连 ✅（2026-08-26）

- [x] R16-1 命令面板页脚显示当前命令总数（Space Mono 弱化色）
- [x] R16-2 Record 聚焦模式 ←/→ 键盘切换对局（与按钮同管线 stepDetail）
- [x] R16-3 Growth 清单副标题补「支持拖拽 .json 导入」引导

### 完成标准
同前。

---

## Round 17 —— 微交互终扫 ✅（2026-08-26）

- [x] R17-1 导出路径条 10s 自动收起（组件卸载清 timer，重导出重置）
- [x] R17-2 Record 聚焦导航按钮补键盘提示 title（←/→）
- [x] R17-3 Home 走马灯 OP.GG 版本接入——评估后跳过：
      走马灯为静态装饰（aria-hidden），动态数据应走 hero meta 而非装饰条

### 完成标准
同前。

---

## Round 18 计划 空态与可达性终扫（2026-08-26）
- [x] R18-1 Record 无筛选空态补 EmptyState #art（Inbox 图标 + 引导文案）
- [x] R18-2 导出下拉键盘可达性核实——n-dropdown 原生支持（Enter/Esc/方向键），无需改动
- [x] R18-3 还原全链路数据级集成测试（缺失检测→补建→重映射，镜像 importGoalsFile）
- [x] R18-4 polish-plan 轮次速览索引表补齐 R17/R18 行

（待续写）

---

## Round 19 计划 空态断言与导入反馈（2026-08-26）
- [x] R19-1 Record 空态三态测试（加载失败/筛选无匹配/无对局引导，20 用例通过）
- [x] R19-2 导出下拉 ARIA 核实——n-dropdown 原生 menu/menuitem 语义，无需改动
- [x] R19-3 Growth 拖拽非 .json 文件给出 warning 提示（含文件名回显）
- [x] R19-4 README 双语核实——导出（基础/含经济视野/剪贴板）与目标备份还原均已记载

## Round 20 计划 重连恢复与收尾核验（2026-08-26）
- [x] R20-1 空态三态结构断言已随 R19-1 落地（.empty__act/.list-item 类级锚定）
- [x] R20-2 Gaming 重连恢复提示（isConnected false→true 触发 3s「连接已恢复」文案）
- [x] R20-3 polish-plan 轮次速览表补 R17-R20 行
- [x] R20-4 全量门禁复核——lint/type/test/build 全绿

## Round 21 计划 重连提示测试化（2026-08-26）
- [x] R21-1 useReconnectBanner 组合式函数 + 5 个时序单测（fake timers 断言闪烁窗口）
- [x] R21-2 导出路径条 aria-live 核实——role=status + aria-live=polite 已在位，无需改动
- [x] R21-3 polish-plan 轮次速览表补 R21/R22 行
- [x] R21-4 下一轮候选池滚动续写（Round 22 已写入）

## Round 22 计划 可达性与主题核查（2026-08-26）
- [x] R22-1 Gaming 未连接态核实——标题「未连接到客户端」+ 默认引导语「请确认英雄联盟客户端已运行」链路完整
- [x] R22-2 export-path-bar 核实——全 token 化（--brand-soft/--brand），主题切换自动跟随
- [x] R22-3 RecordCard 补 Space 激活（防滚动）+ :focus-visible 品牌焦点环
- R22-4 polish-plan 轮次速览表滚动维护

## Round 23 计划 键盘测试化与样式核查（2026-08-26）
- [x] R23-1 RecordCard 键盘激活单测（role/tabindex/Enter/Space 双触发，12 用例通过）
- [x] R23-2 Growth 完成态核实——品牌渐变勾选框 + 划线弱化文字，无需改动
- [x] R23-3 gmarquee 核实——prefers-reduced-motion 覆盖 track + aria-hidden + 悬停暂停
- [x] R23-4 polish-plan 轮次速览表滚动维护

## Round 24 计划 门禁复核与并行流收编（2026-08-26）
- [x] R24-1 全量门禁复核——lint/type/test/build 四绿（145 文件 / 1438 用例，含 Mayhem 结构金丝雀）
- [x] R24-2 并行 mayhem 流成果收编落地（141d00b 使 HEAD 自洽）+ rustfmt 11 处对齐（16f0336）
- [x] R24-3 下一轮候选池滚动续写
- [x] R24-4 polish-plan 归档说明更新

## Round 25 计划 门禁确认与并行流观察（2026-08-26）
- [x] R25-1 门禁复核：前端 vitest 145 文件 / 1438 用例全绿（HEAD 基线）；
      Rust 门禁本机不可执行——cargo/rustup 未安装于当前环境（target/ 为外部产物），
      clippy + cargo test 交由 CI Quality Checks 承担
- [x] R25-2 Mayhem 视图一致性核查——结论：PageStage 用法与结构金丝雀符合约定；
      但加载/无匹配/错误三态为裸 div，未接 EmptyState（违反「禁止裸文案空态」约定，
      且读本地失败时会误显「没有符合条件的英雄」）。该文件正被并行流活跃重构中
      （Tab 化 + 英雄详情子页），为避免编辑冲突，修复移交 Round 26 树干净后落地
- [-] R25-3 README 双语补「大乱斗数据同步」条目暂缓：Mayhem 功能尚未收编进 HEAD
      （工作区未提交状态），等功能落地后随 Round 26 一并处理
- [x] R25-4 polish-plan 轮次速览表滚动维护（含并行会话重复 R21 行去重）

## Round 26 计划 文档漂移清理与零覆盖补测（2026-08-26）
- [x] R26-1 CLAUDE.md 目录结构修正：`pinia/` 实际位于 `features/settings/stores/`；
  补 features/{gaming,mayhem,record,settings} 与 views/settings 子页说明
- [x] R26-2 vite.config.ts optimizeDeps 移除未安装的 `@vicons/ionicons5`
  （依赖清单漂移，实际图标库为 lucide-vue-next）
- [x] R26-3 utils/augment.ts `augmentRarityClass` 稀有度映射单测（kPrismatic/kGold/
  kSilver/kBronze/default 五分支纯函数，此前零覆盖，7 用例通过）
- [ ] R26-4 Mayhem 空态三态接 EmptyState——**继续挂起**：并行流仍在收编中
  （aa2cb6f champion_detail 修复 + MayhemChampionDetail.vue 尚未提交），
  待其轮次收官、树干净后落地。`.m-empty` 以包装类保留满足结构金丝雀；
  错误态优先级需高于筛选空态（修复读本地失败误显「没有符合条件的英雄」）

## Round 27 计划 平衡标签测试化（2026-08-26）
- [x] R27-1 useAramBalance 测试化：抽出 `buildBalanceTags`/`summarizeBalanceStatus`
      纯函数（composable 行为不变），12 用例覆盖死区阈值、正反极性、急速平铺值、
      非数值容错与增强/削弱/调整三态聚合
- [ ] R27-2 Mayhem 空态三态接 EmptyState + README 双语条目（承接 R26-4，
      前置条件：并行流收官）
- [ ] R27-3 下一轮候选池滚动续写

## Round 28 计划 utils 零覆盖补测（2026-08-26）
- [x] R28-1 utils/tier-image.spec——段位图标映射 3 用例（大小写归一、未知/空回退
      unranked、资产导入解析）
- [x] R28-2 utils/overlayPrefs.spec——浮窗偏好 7 用例（默认值、round-trip、
      maxItems/opacity 双向钳制、部分字段补默认、损坏 JSON 容错、存储失败静默）
- [x] R28-3 utils/colors.spec——8 组语义色阈值边界（good/bad/neutral 三档互异 +
      亮暗主题取色差异）
- [-] R28-4 R27-2 复核：并行流仍在制且范围扩大（intelContext/knowledge 集成、
      CI store 测试修复 33f80e5），Mayhem 空态改造继续挂起

## Round 29 候选池
- R29-1 Mayhem 空态三态接 EmptyState + README 双语条目（承接 R27-2，
  前置：并行流收官）
- R29-2 composables/useCopy 或 recordAssetsKey 测试化
- R29-3 services/http initAssetPrefix / platform 平台探测测试化（Tauri 环境分支 mock）
- R29-4 polish-plan 轮次速览表滚动维护

## Round 29 计划 服务层与剪贴板测试化（2026-08-26）
- [x] R29-1 composables/useCopy.spec——复制成功/失败双路径 2 用例
      （naive-ui useMessage mock 注入；实测 copy 内部 promise 链在第 3 个微任务
      tick 才落地，flush 助手固定 4 tick 保证确定性）
- [-] R29-2 recordAssetsKey 测试化**不适用**：文件仅导出 InjectionKey Symbol，
      无任何可测逻辑（类型层设施，断言其存在无价值）
- [x] R29-3 services/http + platform spec——7 用例：asset 前缀默认值/成功采用/
      失败保当前值+告警；平台门控默认 windows/后端上报切换/失败保持/isWindows 联动
- [x] R29-4 并行流复核：HEAD 仍为 33f80e5，Mayhem 全家桶（视图/金丝雀/db.rs/
      knowledge 集成）持续在制 → R30 空态改造继续挂起

## Round 30 候选池
- R30-1 Mayhem 空态三态接 EmptyState + README 双语条目（承接 R27-2/R28-4，
  前置：并行流收官；连续三轮挂起，若下轮仍在制则考虑降级为「仅在计划中登记」）
- R30-2 composables/useEmberField 或 useGameModes 测试化（评估后择一）
- R30-3 services/configKeys 键名清单与实际消费方一致性核查（防漂移）
- R30-4 polish-plan 轮次速览表滚动维护

## Round 30 计划 模式列表测试化与键名一致性核查（2026-08-26）
- [x] R30-1 composables/useGameModes.spec——4 用例（哨兵默认项、value→key 映射、
      失败保持+告警、成功后整体替换不合并）
- [x] R30-2 configKeys 一致性核查——结论：**无漂移**。前端裸字符串仅存在于
      configKeys.ts 本身与钉住字面量的测试文件；Rust 侧 REPORTING_KEY /
      GAME_INSTALL_PATH_KEY / BACKUP_BLACKLIST 与前端键名逐一吻合。
      ⚠️ 登记一项语义不对称供产品决策：`dashscopeApiKey` 在 CLOUD_ONLY_BLACKLIST
      （云端排除、文件备份保留），而 `ai.apiKey` 不在黑名单会随 appConfig 上云
      （可能是有意的跨设备同步设计，也可能遗漏）——不改行为，移交 R31 决策
- [-] R30-3 Mayhem 空态改造第 4 次挂起（并行流新增 overlay/mod.rs 改动，
      仍在制）→ 按池约定降级为「计划登记项」，不再逐轮复核，待并行流收官
      后由任意会话一次性落地
- [x] R30-4 polish-plan 轮次速览表滚动维护

## Round 31 计划 Mayhem 空态统一与边界增强 ✅（2026-08-27）
- [x] R31-1 Mayhem 空态统一接 EmptyState——英雄榜、强化榜、我的英雄、我的强化
      全部接入标准 EmptyState 组件，支持一键清空筛选与导入操作；保留 .m-empty
      类名并保证金丝雀测试完全通过。
- [x] R31-2 draft.ts compositionGaps 边界增强——teamIds 为空时给出「等待队友选定英雄...」
      避免显示全员缺口误导玩家；7 组单元测试全部通过。
- [x] R31-3 README 双语同步——新增「海克斯大乱斗（Mayhem）专项中心」功能介绍，
      覆盖 T 级榜单、流派出装、选人期助手与对局浮窗。
- [x] R31-4 General.vue 浮窗描述优化与 rustfmt 格式合规修复。

## Round 32 计划 赛后战报文本格式化与快捷分享（E6） ✅（2026-08-27）
- [x] R32-1 纯函数抽取 formatReviewReport——针对游戏聊天室/开黑群（QQ/微信/KOOK/Discord）
      格式化胜负、KDA（含 PERFECT 守卫）、伤害、承伤、徽章以及 AI 裁判点评，零外部依赖。
- [x] R32-2 单元测试覆盖 reviewReport.spec.ts——全要素完整战报与 0 死亡边界覆盖。
- [x] R32-3 MatchDetailReviewTab.vue 接入一键复制战报按钮，与 useCopy() 配合给出即时交互反馈。
- [x] R32-4 polish-plan 轮次速览表滚动维护。

## Round 33 计划 API Key 云端黑名单安全合规与对局大乱斗体验 ✅（2026-08-27）
- [x] R33-1 `ai.apiKey` 纳入 CLOUD_ONLY_BLACKLIST——消除多服务商接入后私有凭据随 puuid 公开同步的安全风险；Rust 单测完整覆盖规则判定、快照排除与本地备份恢复。
- [x] R33-2 PlayerCard.vue 大乱斗强度角标交互增强——官方 T 级角标显式提示出装强化，并支持点击一键跳转至对应英雄海克斯大乱斗流派详情。
- [x] R33-3 polish-plan 轮次速览表滚动维护与 CI 打包全流程闭环验证。

## Round 34 候选池
- R34-1 useEmberField 测试化（reduced-motion 分支已有实现，评估动画帧 mock 成本）
- R34-2 ai.baseUrl 针对非标准端点的 URL 自动规范化与协议头补齐
- R34-3 SGP 历史对局详情容器评审 Tab 补强
- R34-4 polish-plan 轮次速览表滚动维护

## 归档说明