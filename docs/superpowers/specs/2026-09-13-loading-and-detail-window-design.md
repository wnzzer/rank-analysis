# 加载体验 + 对局详情窗打开/自适应优化

- 日期：2026-09-13
- 状态：已批准，待写实现计划
- 范围：前端 `rank-analysis-app/src/` 为主，Rust 仅 `src-tauri/src/main.rs` 一处兜底 + `tauri.conf.json` 一个字段

## 背景

用户反馈的体验问题拆成两个互相独立的子项目，本文只覆盖 **子项目 A（加载与详情窗）**；**子项目 B（亮色主题精修）** 另起 spec，见文末「不在本次范围」。

用户原话：首页顶部加载条太 low（考虑直接干掉）；打开对局详情有一段白屏，然后又一个缩放的不好的体验；对局详情不能滚轮放大缩小自适应。

## 诊断（dev 版真机 + MCP bridge 连拍/打点实测）

| 现象 | 根因 |
|---|---|
| 首页顶部加载条 | `MatchHistory.vue` 调 naive-ui `useLoadingBar()`；列表首屏本来就有骨架屏，属于重复反馈 |
| 首页左栏假数据 | `UserRecord.vue` 用 `defaultRank()` / `defaultRecentWinRate()` / `defaultRecentData()` 先渲染，数据回来前显示「无段位 / 暂无对局 / KDA 0 / 红色 0%」，随后突变 |
| 战绩卡骨架跳变 | `RecordCardSkeleton.vue` 的块布局与 `RecordCard.vue` 的列网格不对应，数据到达时整块跳 |
| 详情窗白屏 | 新 WebView 首帧前是默认白底；dev 实测导航开始到 first-paint 956ms（dev 未打包，241 个请求） |
| 详情窗「暗色闪一下」 | `main.ts` 里 `useSettingsStore().initTheme()` 未 await，mount 时默认 `darkTheme`，IPC 回来才切亮色（连拍第一帧确为暗色） |
| 详情窗「缩放不好」 | `useZoom` 在 `onMounted` 里异步读 `settings.ui.zoomFactor`（用户存的 1.03）后才 `setZoom`，整页再缩放一次，列位置整体漂移 |
| 详情不能「自适应」 | Ctrl+滚轮本身生效；但版心 `max-width: 1360px`，最大化（2485 CSS px）内容缩在中间一窄条；`MatchDetailModal.vue` 的 `@media (max-width: 1100px)` 让 CSS 宽度 <1100 时表格塌成单列卡片——窗口偏小或 Ctrl+滚轮放大到 ~1.19 倍即触发 |

附带发现：`index.html` 外链 Google Fonts 样式表是渲染阻塞的。本机 0.4s 可达，不是本机白屏主因，但国内直连不稳定的用户会被卡到超时。

## 决策记录

| 决策点 | 结论 |
|---|---|
| 子项目拆分 | A 加载与详情窗先做；B 亮色主题精修后做，另起 spec |
| 详情「自适应」语义 | **等比缩放铺满**：固定设计稿排版，窗口多大整体等比缩放，一屏看全 10 人；Ctrl+滚轮在铺满基础上微调；永不塌单列 |
| 详情窗打开方式 | **① 就绪后再显示**（隐藏创建 → 首帧就绪后 show）。预热窗口池、主窗口浮层均不做 |
| 缩放实现 | 内容容器上用 CSS `zoom`（同步、标题栏不缩、不污染主窗口缩放）；Mac 上若浮层定位有问题，退回 `webview.setZoom`，计算函数不变 |

## 一、详情窗打开链路（顺带修掉所有窗口的首帧问题）

目标：窗口第一次出现即最终态（主题对、比例对、两队齐全），之后不再跳。

### 1. 启动顺序（`main.ts`，所有窗口共用）

- mount 前并发取「平台三项 + 主题 + 缩放比例」，主题写入 store 后再 mount。把 mount 前的准备步骤抽成可测函数（如 `prepareBoot()`），`main.ts` 只负责调用与 mount。
- 主窗口的已存缩放（`settings.ui.zoomFactor`）在 mount 前 `setZoom`；`useZoom` 不再在 `onMounted` 里补应用，只负责事件（Ctrl+滚轮 / Ctrl± / Ctrl+0）与落盘。
- 详情窗不走主窗口缩放（见第二节），其 webview 缩放保持 1。
- `index.html` 删除 Google Fonts 外链，改为本地打包 Inter / Oswald（woff2，仅 latin 子集，`@font-face` 声明在全局样式里），体积约 100–200KB。

### 2. 详情窗（`components/record/detailWindow.ts` + `views/MatchDetail.vue`）

- `new WebviewWindow` 增加 `visible: false` 与 `backgroundColor`（按当前主题取底色；注意 `theme-light` 类挂在 `n-config-provider` 根上而非 `documentElement`，不能直接读 `:root` 的 `--bg-base`，需从该元素读或按 `isDark` 取值）。
- 详情页挂载后按序：读对局 → 算缩放 → 两队同帧渲染 → `nextTick` + `document.fonts.ready` → `getCurrentWindow().show()` + `setFocus()` → emit 就绪事件。
- **就绪判定不依赖 `requestAnimationFrame`**：隐藏的 WebView 可能被视为 hidden 页面而暂停 rAF / 绘制，等 rAF 会退化成只能靠兜底才出现。show 之后的首帧只剩绘制（布局与资源已就绪），期间由窗口 `backgroundColor` 兜住，不会露白。
- 去掉 `MatchDetailModal.vue` 的 `visibleTeamCount` 80ms 分批渲染（窗口隐藏期间渲染，分批已无意义）；图片仍经 `LazyImg` 淡入，尺寸固定不挤布局。
- 兜底：`openMatchDetailWindow` 创建后 3s 内未收到就绪事件，且窗口仍不可见，则主动 `show()`。
- `openMatchDetailWindow(game)` 的返回 Promise 改为「窗口已显示（就绪或兜底）」时 resolve；同一 label 的并发调用复用同一个进行中的 Promise（修掉快速双击 `new WebviewWindow` 同 label 报错的竞态）。已存在的窗口沿用现逻辑直接 `show()` + `setFocus()`。
- 点击反馈：`RecordCard.vue` 新增「打开中」态（轻微按下 + 右侧小 spinner），由 `MatchHistory.vue` / `AiSearchResults.vue` 按 gameId 在 Promise pending 期间传入；打开中重复点击忽略。`MettingPlayersCard.vue` 只获得并发去重，不加指示。

### 3. 主窗口

- `tauri.conf.json` 主窗口 `"visible": false`；前端 mount + `nextTick` 后 `show()`（同上，不依赖 rAF）。
- `src-tauri/src/main.rs` 的 `setup` 里加 3s 兜底：主窗口仍不可见则 `show()`，防止前端异常导致窗口永不出现。

## 二、详情窗等比缩放 + Ctrl+滚轮

### 1. 排版

- 内容按固定设计宽 **W = 1280 CSS px** 排版一次，窗口尺寸只决定缩放比例。
- 删除 `MatchDetail.vue` 整页 `--font-size-*` 的 `clamp(…100vw…)` 覆盖，以及 `MatchDetailModal.vue` 里跟 `100vw` 挂钩的尺寸（头部英雄图、玩家名字号等），改为固定设计值（取 ~1280 宽下的现值）。否则与 zoom 叠加形成双重缩放。
- 删除 `MatchDetailModal.vue` 的 `@media (max-width: 1100px)` 单列规则。
- 删除 `.match-detail-window-inner` 的 `max-width: 1360px` 版心居中（由缩放容器接管居中）。

### 2. 缩放比例

纯函数（放在详情缩放 composable 同模块，便于单测）：

```
computeDetailScale(availW, availH, contentH, userFactor):
  fit = min(availW / W, max(availH / contentH, 1))
  return clamp(fit, 0.8, 2.0) * userFactor
```

- `availW` / `availH`：标题栏以下的可用区域；`contentH`：内容在设计宽 W 下的自然高度（头部 + 队伍区完整高度，不受缩放影响，无反馈环）。
- 宽度方向必放得下；内容比窗口矮时按高度放大到刚好填满（不超过宽度上限）；内容比窗口高（如斗魂竞技场 8 队）时不因高度缩小，改为纵向滚动。
- 参考值：默认 1300×900 窗口 ≈ 1.0；2560 屏最大化 ≈ 1.57；1366 笔记本 ≈ 0.95。

### 3. 应用方式

- 缩放容器（不含 28px 标题栏）设 CSS `zoom: s`、宽 `W`、高 `availH / s`（视觉高正好等于可用高），**头部固定、队伍区内部滚动的现有结构保持不变**。
- 外层包一层横向滚动容器，`justify-content: safe center`：未溢出时居中，放大超出窗口时可滚到左缘。
- `ResizeObserver` 监听可用区与内容高度，同步重算，拖动窗口边缘不卡顿。
- 浮层（naive-ui tooltip / popover、AI 复盘 `n-modal`）teleport 到 body，不随 zoom 缩放，保持 1 倍可读；定位依赖 Chromium ≥128 标准化后的 `zoom` 下 `getBoundingClientRect` 返回视觉坐标。

### 4. Ctrl+滚轮 / Ctrl± / Ctrl+0（仅详情窗）

- 调整 `userFactor`，范围 0.7–1.5，步进复用 `useZoom.ts` 的 `nextZoomFactor` 规则；Ctrl+0 复位为 1（纯铺满）。
- 持久化到新配置键 `settings.ui.detailZoomFactor`（加入 `services/configKeys.ts`），新开详情窗沿用；与主窗口 `settings.ui.zoomFactor` 互不影响。
- 调整时标题栏短暂（~1.2s）显示当前倍率（如「110%」）。
- `Framework.vue` 改为仅主窗口调用 `useZoom()`；详情窗使用详情缩放 composable。

### 5. 窗口最小尺寸

`detailWindow.ts` 的 `FLOOR_SIZE.width` 900 → 1040（0.8 × 1280 + 边距），仍受「不超过工作区实际尺寸」约束（`fitToWorkArea` 现有逻辑）。

## 三、首页（战绩页）加载

### 1. 去掉顶部加载条

删除 `App.vue` 的 `n-loading-bar-provider`、`MatchHistory.vue` 的 `useLoadingBar` 调用，以及 `__tests__/MatchHistory.spec.ts` 里对应的 stub。

### 2. 左栏骨架屏（`UserRecord.vue`）

- 三块独立加载态：身份卡（头像 / 名字 / 大区）、段位卡 ×2（`RankCard`）、近期表现（`RecentStatsTable`）。各自数据返回即淡入（~150ms），不再渲染默认假值。
- `route.query.name` 切换时各块回到骨架屏，不展示上一个人的数据。
- 跨区分支逻辑不变。
- 请求失败：退出骨架，回落到今天的默认渲染（行为与现状一致），不新增重试 UI。

### 3. 战绩卡骨架按真卡重做（`RecordCardSkeleton.vue`）

- 复用 `RecordCard.vue` 的列网格轨道与行高：胜负/时长 | 英雄 | 模式/日期 | KDA+装备 | 数据框 | 双方头像。数据到达原地淡入，高度不变。
- 骨架视觉收敛为一个全局工具类（放 `global.css`）：主题感知底色 + 淡扫光（复用现有 `shimmer` keyframes），左栏与战绩卡共用；`prefers-reduced-motion` 下关闭扫光。

### 4. 翻页 / 筛选

- 旧列表立即变淡（约 0.5 透明度）并 `pointer-events: none`，页码旁显示小 spinner；新数据到达沿用现有 `list-enter` 错位入场。
- 仅首次加载显示骨架，翻页不闪骨架。

### 5. 等待连接页（`LoadingComponent.vue`）

去掉 `⚔` emoji（跨系统渲染不一致）与多余的 `loading-shimmer-bar`（与转圈重复），只保留一个转圈 + 文案，风格与上面统一。`Gaming.vue` 共用该组件，一并生效。

## 测试与验收

### 单元测试（vitest）

- `computeDetailScale`：默认窗口 ≈1.0、最大化受高度约束、超高内容不缩小、0.8 / 2.0 边界、`userFactor` 相乘。
- `detailWindow.ts`（mock `WebviewWindow`）：创建参数含 `visible: false` 与 `backgroundColor`；3s 兜底 show；同 label 并发只创建一次；返回 Promise 在就绪 / 兜底时 resolve。
- 启动准备函数：断言主题在 mount 前已写入 store。
- `MatchHistory`：删除 loading bar stub；翻页请求期间列表处于变淡态。
- `UserRecord`：加载中渲染骨架、数据返回后渲染内容、切换玩家回到骨架。

### 真机验收（dev + MCP bridge，同本次诊断方法）

- 点开详情连拍：第一张截图即为最终主题与比例，无暗色闪、无缩放跳、无列横跳；记录点击→显示耗时。
- 尺寸矩阵截图：默认 / 最大化 / 最小尺寸 / Ctrl+滚轮 1.5 倍——不塌单列、最大化铺满。
- 首页亮 / 暗各一组：骨架态、加载完成态、翻页中态。
- 正式包打开速度由用户体感验收；若仍嫌慢，另立项做预热窗口。
- **Mac 验收（用户）**：详情窗缩放下浮层定位、隐藏创建后正常显示、本地字体生效。

### 门禁

`npm run check` + `npm run test` + `cargo test` 全绿，按 `.claude/skills/shipping-changes/SKILL.md` 流程提 PR。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 窗口永不显示 | 双兜底：详情窗由主窗口 3s 强制 show；主窗口由 Rust `setup` 3s 强制 show |
| 隐藏 WebView 暂停 rAF / 绘制 | 就绪判定只用 `nextTick` + `document.fonts.ready`，不等 rAF；show 后首帧由窗口 `backgroundColor` 兜底 |
| Mac WKWebView 下 CSS `zoom` 浮层定位异常 | `computeDetailScale` 不变，仅把应用层换成 `webview.setZoom` |
| 去掉分批渲染后图片请求集中 | 窗口隐藏期间发生、图片淡入；验收对比点击→显示耗时不回退 |
| 本地字体增大包体 | 约 100–200KB，可忽略 |

## 不在本次范围

- **子项目 B：亮色主题精修**（7 月「冷瓷」方案仅完成批 0 壳层；详情头部红蓝径向光晕 + 英雄虚影发灰发粉、战绩卡胜负色渐变洗白底像污渍、卡片材质混用、进度条白轨道隐形等），A 完成后另起 spec，配合浏览器出配色方案挑选。
- 详情窗预热窗口池；详情窗独立轻量入口（不加载全量 naive-ui / router）。
- 主窗口的缩放交互（保持现状，仅把已存比例的应用提前到 mount 前）。
