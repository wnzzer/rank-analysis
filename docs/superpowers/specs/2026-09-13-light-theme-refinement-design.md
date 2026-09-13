# 亮色主题精修（冷瓷修正版）

- 日期：2026-09-13
- 状态：已批准，待写实现计划
- 范围：前端 `rank-analysis-app/src/`，不改 Rust；只改变亮色表现，暗色像素不变
- 前置：子项目 A（加载与详情窗，#166）已合入；本文是其「不在本次范围」里约定的子项目 B
- 取代：`2026-07-24-light-theme-completion-design.md` 中批 1–4 与收尾守门（批 0 壳层已完成，沿用）

## 背景

用户反馈：亮色主题「有点脏、不够好看、不够精致」。7 月的「冷瓷」方案只完成了批 0（顶栏 / 侧栏），其余页面仍是暗色结构换 token。

## 诊断（dev 版真机，战绩 / 详情 / 对局（真实数据模拟）/ 设置 四屏实拍）

| 现象 | 根因 |
|---|---|
| 灰上叠灰、发闷发脏（设置页、对局页最重） | 卡片 / 输入框 / 内嵌小框在亮色下都是半透明冷墨（`--glass-bg-*` 2.5%–6%，`overrides.ts` 的 `Card.color` / `Input.color` 同值）叠在 `#eff1f3` 灰画布上，形成 3–4 层灰 |
| 输入框像禁用态 | 同上：输入框底是半透明灰 |
| 详情头部发灰发粉、战绩卡左侧像污渍 | 暗色氛围手法照搬白底：两团径向光晕 + 头部胜负环境光 + 英雄虚影、战绩卡胜负色 wash、胜负徽章 / 头像 / 队伍色条外发光（组件内写死约 33 处 `0 0 Npx` 光晕、6 个文件的色块渐变） |
| 设置子导航选中块很重 | 组件样式一层 13% 绿 + naive `itemColorActive` 一层 12% 绿叠加 |
| 浮层白字压白底（实测备注面板标题不可见） | `theme-light` 类挂在 `n-config-provider` 上，teleport 到 body 的浮层拿到 `:root` 暗色 token |
| 进度条轨道隐形 | `ProgressStatRow` 的 `rail-color` 写死 `rgba(255,255,255,0.1)` |

## 决策记录

| 决策点 | 结论 |
|---|---|
| 视觉方向 | **A 冷瓷修正版**（在真机原型 A 冷瓷修正 / B 纯白极简 / C 暖纸 中选定）：冷中性浅灰画布 + 实心白卡 + 发丝边 + 极淡双层投影 |
| 落地方式 | **token 化根治，一个 PR**：组件只引用语义 token，不再写亮色补丁；主题类挂 `<html>`；按页面截图验收 |
| 暗色 | 保持像素不变（新 token 暗色值 = 各处现值），截图逐像素比对验证 |

## 一、视觉规范与 token 体系

### 1. 亮色调色板（`.theme-light` 取值变更）

| token | 现值 | 新值 |
|---|---|---|
| `--bg-base`（画布） | `#eff1f3` | `#f1f3f5` |
| `--bg-surface`（外壳） | `#fafbfc` | `#fbfcfd` |
| `--bg-elevated` | `#ffffff` | `#ffffff`（不变） |
| `--border-subtle` / `--glass-border` | 冷墨 (20,30,35) 9% | 冷墨 (15,23,42) 8% |
| `--text-primary / -secondary / -tertiary` | (20,30,35) 94% / 60% / 42% | (15,23,42) 92% / 62% / 42% |
| `--glass-bg-low / -mid / -high` | (20,30,35) 2.5% / 4% / 6% | (15,23,42) 同比例（仅换墨色） |
| `--semantic-win` / `--semantic-loss` | `#2d8a6c` / `#b84242` | `#1f8a66` / `#c2413b` |
| `--shadow-card` / `--shadow-sm` / `--shadow-md` | 现双层投影 | `0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.05)` |
| `--shadow-lg` | 现值 | `0 8px 24px rgba(15,23,42,.10)` |

材质规则：亮色所有面实心；层级只靠「浅灰画布 → 白卡（发丝边 + 柔影）→ 淡灰凹面」三级；胜负只用左侧色条与文字色表达，不铺色块；不用任何发光。

### 2. 新增语义 token

`--glass-bg-*` 三档保留且两主题取值不变（除上表墨色），亮色下角色本就正确的用法（图片骨架扫光、弹窗内嵌框、各类 hover / chip）不动。只把**亮色下角色不对**的用法迁到语义 token；同一角色在暗色有不同档位的，拆成两个 token 保证暗色逐处对齐。

| token | 角色 | 暗色值（= 现值） | 亮色值 |
|---|---|---|---|
| `--surface-card` | 卡面（战绩卡、玩家卡、naive `Card.color`） | `rgba(255,255,255,.05)` | `#ffffff` |
| `--surface-sunken` | 凹面（数据框、每局小条、近期数据框、胜率徽章、AI 报告内嵌块） | `rgba(255,255,255,.03)` | `#f5f7f9` |
| `--sunken-border` / `--sunken-shadow` | 凹面的边与投影 | `var(--glass-border)` / `var(--shadow-sm)` | `transparent` / `0 0 #0000` |
| `--surface-input` | naive 输入框底（`Input.color`） | `rgba(255,255,255,.05)` | `#ffffff` |
| `--surface-control` | 自绘控件底（战绩筛选下拉、分页按钮） | `rgba(255,255,255,.03)` | `#ffffff` |
| `--surface-group` | 分组容器（对局页队伍容器） | `rgba(255,255,255,.05)` | `transparent` |
| `--surface-shell` | 外壳面（顶栏、设置子导航栏） | `rgba(255,255,255,.03)` | `var(--bg-surface)` |
| `--surface-sidebar` | 左侧主导航栏 | `var(--bg-base)` | `var(--bg-surface)` |
| `--panel-glass-bg` / `--panel-glass-shadow` | 左栏玻璃面板（`.panel-glass`） | `transparent` / `0 0 #0000` | `var(--bg-elevated)` / `var(--shadow-card)` |
| `--track-bg` | 详情对比条轨道 | `rgba(255,255,255,.05)` | `rgba(15,23,42,.08)` |
| `--progress-rail` | `ProgressStatRow` 进度轨道 | `rgba(255,255,255,.1)` | `rgba(15,23,42,.08)` |
| `--stat-dot-empty` | `StatDots` 空点 | `var(--border-subtle)` | `rgba(15,23,42,.2)` |
| `--accent-hover` / `--accent-pressed` | 主色 hover / pressed（naive） | `#378b6e` / `#317c62` | `#1a7a5a` / `#166a4e` |
| `--focus-ring-soft` | 输入框聚焦外环（naive） | `rgba(61,155,122,.35)` | `rgba(31,138,102,.35)` |
| `--menu-item-active` / `--menu-item-active-hover` | naive 菜单选中底 | `rgba(61,155,122,.14)` / `.18` | `rgba(31,138,102,.09)` / `.13` |
| `--settings-menu-active-bg` | 设置子导航组件层选中底 | `rgba(61,155,122,.13)` | `transparent`（只留 naive 一层） |

组件专属特例（暗色值独一份、无法并入通用语义）允许在 `global.css` 定义带域前缀的 token，如 `--detail-team-card-bg`（暗 `rgba(255,255,255,.015)` / 亮 `var(--surface-card)`）、`--detail-column-header-bg`（暗 `transparent` / 亮 `var(--surface-sunken)`）、`--detail-row-me-bg`（暗 胜色 10% / 亮 胜色 8%）、`--shell-header-shadow`（暗 现双层 / 亮 `0 0 #0000`）。

**供 `overrides.ts` 读取的 token 必须是字面色值（hex / rgba）**：naive 的 `common.*` 等键会做 JS 颜色运算，`color-mix()` / `var()` 字符串会让其运行时报错（7 月已验证）。

### 3. 效果强度开关

| token | 暗色 | 亮色 | 覆盖 |
|---|---|---|---|
| `--fx-glow` | `1` | `0` | 所有带颜色的外发光（`0 0 Npx` + 颜色） |
| `--fx-wash` | `1` | `0` | 色块渐变 / 径向光晕 / 环境光 |
| `--fx-ambient` | `1` | `0` | 详情头部英雄虚影透明度 |

写法：`box-shadow: 0 0 14px color-mix(in srgb, var(--semantic-win) calc(22% * var(--fx-glow)), transparent)`；透明度 `opacity: calc(0.3 * var(--fx-ambient))`。已在 WebView2 实测：强度 1 时计算结果与原写法完全一致（`color(srgb … / 0.22)`），强度 0 时完全透明。

## 二、结构修正：主题类挂 `<html>`

- `App.vue`：watcher（`flush: 'sync'`, `immediate: true`）把 `theme-light` 同步到 `document.documentElement`，去掉 `n-config-provider` 上的类绑定。浮层（popover / dropdown / modal）因此拿到亮色 token。现有 `.theme-light …` 选择器照常生效。
- `theme/overrides.ts`：删掉 `isDark ? a : b` 的颜色手抄，全部经 `cssVar()` 从 `<html>` 读计算后的 token（单一数据源 = `global.css`）：`Layout.color ← --bg-base`、`Card.color ← --surface-card`、`Card.borderColor / Input.border ← --glass-border`、`Card.boxShadow ← --shadow-md`、`Input.color ← --surface-input`、`primaryColor ← --semantic-win`、`primaryColorHover / Suppl ← --accent-hover`、`primaryColorPressed ← --accent-pressed`、`boxShadowFocus ← --focus-ring-soft`、`Button 边框 ← --border-control / -hover`、`textColor* ← --text-primary`、`Menu.itemColorActive / Hover ← --menu-item-active / -hover`、`itemTextColorActive / itemIconColorActive ← --semantic-win`。watcher 先翻类、computed 后读，时序由 `flush: 'sync'` 保证。
- `components/record/detailWindow.ts` 的 `currentThemeBackground()` 改为直接读 `document.documentElement`。
- `global.css` 里的 `.theme-light .panel-glass`、`.theme-light .subteam-card`、`.theme-light .n-layout-header.header`、`.theme-light .n-layout-sider.left` 四个材质补丁全部改为 token 驱动后删除。

## 三、组件改造清单

通用动作：`--glass-bg-*` 中角色不对的用法换语义 token；写死光晕 / 渐变接强度开关；删组件内 `.theme-light` 块（改 token）；裸 `rgba(255,255,255,…)` 换 token 或标 `/* theme-fixed */`。

| 页面 | 组件 | 要点 |
|---|---|---|
| 壳 | `Framework` | 顶栏底 → `--surface-shell`、顶栏阴影 → `--shell-header-shadow`、左栏 → `--surface-sidebar` |
| | `Header` / `SideNavigation` | 新调色板下复查（批 0 已 token 化） |
| 战绩 | `RecordCard` | 卡底 → `--surface-card`；胜负 wash → `--fx-wash`；头像环 / MVP 光晕 → `--fx-glow`；数据框 → `--surface-sunken` + `--sunken-border/-shadow`；队伍胶囊 → `--surface-sunken`；删 4 个 `.theme-light` 块 |
| | `UserRecord` / `RankCard` / `RecentStatsTable` / `RelationshipPanel` | `.panel-glass` → `--panel-glass-*`；胜率徽章 → `--surface-sunken` |
| | `ProgressStatRow` | `rail-color` → `var(--progress-rail)` |
| | `MatchHistory` / `AiSearchResults` | 筛选下拉、分页按钮 → `--surface-control`；残余光晕接 `--fx-glow` |
| | `StatDots` | 空点 → `--stat-dot-empty`，删 `.theme-light` 块 |
| 对局 | `SubteamCard` | 容器 → `--surface-group` |
| | `PlayerCard` / `PlayerHistoryGrid` / `PlayerStatsCard` | 卡 → `--surface-card`；小条 / 近期数据框 → `--surface-sunken` + `--sunken-border`；光晕 → `--fx-glow` |
| | `ChampionIntelCard` / `MettingPlayersCard` / `BpDecisionBar` / `Gaming` | 光晕接 `--fx-glow`，写死暗色胜负渐变 → `--fx-wash` + 语义色 |
| 详情 | `MatchDetailModal` | 两团径向光晕、头部环境光、头部渐变 → `--fx-wash`；英雄虚影 → `--fx-ambient`；徽章 / 头像 / 队伍色条光晕 → `--fx-glow`；队伍卡 → `--detail-team-card-bg`；表头 → `--detail-column-header-bg`；「我」行 → `--detail-row-me-bg`；对比条轨道 → `--track-bg`；删 5 个 `.theme-light` 块 |
| | `MatchDetail` | 标题栏渐变 → `--fx-wash`，删 `.theme-light` 块 |
| 设置 | `Settings` | 子导航栏 → `--surface-shell`；选中态 → `--settings-menu-active-bg`（亮色只留 naive 一层轻着色） |
| | 各设置页 | 卡片 / 输入框随 `overrides.ts` 走新 token |
| 浮层 | `PlayerNoteBadge` / `ErrorReportingConsentDialog` / `CloudConfigPullDialog` / `MatchAIPanel` / `RuleEditModal` / `BpSuggestModal` / `AISuggestModal` / `AssetTooltipContent` | 挂 `<html>` 后自动取亮色 token；残余裸白 alpha / 光晕换 token；逐个截图检查 |
| 其他 | `LoadingComponent` / `SuperSearch` | 残余光晕接 `--fx-glow`，删 `.theme-light` 块 |

## 测试与验收

### 自动化守门（vitest）

1. **token 成对**：解析 `global.css`，断言第一节第 2、3 小节列出的每个新 token 在 `:root` 与 `.theme-light` 中都有定义。
2. **组件样式规则**：扫描所有 `.vue` 的 `<style>`：不得出现 `.theme-light`；不得出现裸白 alpha（正则 `rgba\(\s*255\s*,\s*255\s*,\s*255\s*,`，覆盖有无空格两种写法）；匹配 `0 0 \d+px` 且同一行带颜色（`rgba(` / `color-mix(` / `#`）的行必须包含 `--fx-glow`。含 `/* theme-fixed */` 的行豁免。
3. **主题类位置**：挂载 App 后切换主题，断言 `document.documentElement.classList` 同步翻转，且 `buildThemeOverrides` 读到对应 token 值。
4. `theme/overrides.spec.ts` 随 `cssVar()` 化更新。

### 真机验收（dev + MCP bridge）

- **暗色像素比对**：改动前在 main 上拍暗色基线（战绩 / 详情 / 对局模拟 / 设置），改后同屏再拍，用 Node 小脚本（zlib 解 PNG）逐像素比对，差异像素 < 0.1%（数据相同、加载动画已停止）。
- **亮色截图**：同四屏 + 备注弹出面板 + 一个对话框，SendUserFile 发用户，与原型 A 对照验收。
- **Mac 验收（用户）**：亮色下浮层与各页面。

### 门禁与文档

- `npm run check` + `npm run test` + `cargo test` 全绿，按 `.claude/skills/shipping-changes/SKILL.md` 提 PR。
- `CODE_QUALITY.md` 补「亮色材质规则」小节：语义 token 用法、强度开关写法、`theme-fixed` 豁免条件。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 迁移中误改暗色 | 新 token 暗色值逐处对齐现值；暗色像素比对兜底 |
| `overrides.ts` 读到 `color-mix` / `var()` 字符串导致 naive 报错 | 供其读取的 token 限定字面色值；`overrides.spec` 断言读出值为 hex/rgba |
| 主题类挂 `<html>` 后旧选择器失配 | `.theme-light X` 以祖先关系匹配，`<html>` 为所有元素祖先；截图覆盖全页面 + 浮层 |
| 守门规则误伤主题无关的固定色 | `/* theme-fixed */` 行级豁免 |

## 不在本次范围

- 暗色主题的任何视觉调整。
- 布局 / 信息结构调整（只改材质与色彩）。
- 对局页真实选人期的交互态（仅用真实数据模拟会话做静态验收）。
