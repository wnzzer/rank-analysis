# Record 页面 UI Polish (Reference Quality) — 设计

> 状态：设计稿，待实施
> 日期：2026-05-23
> 作者：wnzzer

## 1. 背景

Record 是 app 最高频入口页（左侧召唤师卡 + 段位 + 最近表现，右侧战绩列表），现状 13 个相关组件 UI 品质未到 reference quality，主要问题：

- **Token 已有但未贯彻**：`src/global.css` 已经定义了完整的 `--space-*` / `--radius-*` / `--shadow-*` / `--dur-*` / `--ease-*` 体系，但组件大量硬编码——5 种 radius 值（6/8/10/12/999px）、8 档 font-size、3 种 padding 值散布在 inline style 与 scoped CSS 里
- **缺字阶 token**：现有 token 不含 font-size 阶梯，导致字号无规范
- **naive-ui 视觉脱钩**：没配 `GlobalThemeOverrides`，naive-ui 内置组件（Card / Button / Tag 等）默认外观跟自家 token 不对齐
- **加载/空态降级粗糙**：列表加载只有全屏 loadingbar、无骨架屏；筛选无结果无专属 empty 态；图片懒加载无占位
- **响应式断点过低**：500px 才切移动态，且 v-show 硬切无过渡

### 目标

把 Record 页打磨到 reference quality（A 视觉精致度 + C 交互反馈 + D 一致性/token 三层联动），作为后续 Gaming/MatchDetail/其他页扩散设计语言的基准。此页打磨后的 token + 模式将复用到其他页，每页后续按这套迁移属于常规改造，不再单独 spec。

### 用户硬约束

- 小组件不上毛玻璃效果（保留大面板 `panel-glass`）
- 侧边栏禁止滚动条
- Settings 页保持原样不动

## 2. 范围

### 涉及文件（新建 / 修改 / 不动 三类）

**新建**：
- `src/theme/overrides.ts` — naive-ui GlobalThemeOverrides 工厂
- `src/composables/useBreakpoint.ts` — 响应式断点 reactive ref
- `src/components/record/RecordCardSkeleton.vue` — 战绩卡骨架屏
- `src/components/common/LazyImg.vue` — 带占位的懒加载 img wrapper

**修改**：
- `src/global.css` — 追加字阶、补 space 阶、补 radius、抽 win/loss 渐变
- `src/pinia/setting.ts` — 暴露 `themeOverrides` computed（依赖主题切换）
- `src/views/Record.vue` — 断点抬到 768px、加过渡动画
- 13 个 record 相关组件 — token 清洗（pattern 一致）：
  `UserRecord.vue` / `MatchHistory.vue` / `RecordCard.vue` / `RankCard.vue` / `RelationshipPanel.vue` / `RecentStatsTable.vue` / `ProgressStatRow.vue` / `StatDots.vue` / `RecordButton.vue` / `TeamAvatarGroup.vue` / `AssetTooltipContent.vue` / `MatchDetailModal.vue` / `MatchAIPanel.vue`

**不动**（Out of Scope）：
- `src/views/Settings.vue` 和 `src/views/settings/**`（用户约束）
- `src/components/Header.vue` / `SideNavigation.vue` / `Framework.vue`（全局 layout）
- `src/components/automation/**` / `tags/**` / `gaming/**`（下一轮扩散）
- IPC / composable 业务逻辑 / Rust 端
- 不引入 Tailwind / UnoCSS / CSS-in-JS / Storybook
- 不做 i18n 提取、a11y 全面审计、第三主题

## 3. 设计

### 3.1 Token 体系补全

`global.css` 在 `:root` 和 `.theme-light` 块内**只追加不删**（确保未改动的旧组件继续可用）：

| 类别 | 新增 token | 用途 |
|---|---|---|
| 字阶 | `--font-size-{2xs:10, xs:11, sm:12, base:13, md:14, lg:16, xl:18}` | 收编 8 档硬编码 |
| 字阶辅助 | `--line-height-{tight:1.2, normal:1.45}` + `--font-weight-{medium:500, semibold:600, bold:700}` | 配套 |
| 间距补阶 | `--space-{2:2, 6:6, 10:10}` | tooltip padding / icon gap 强需 |
| 圆角 | `--radius-xs: 3px`（收编 MVP 徽章） + `--radius-pill: 999px`（进度条 token 化） | 消化 5 种值 |
| 渐变 | `--win-bar-gradient` / `--loss-bar-gradient`（深浅两套） | 从 RecordCard 内联渐变抽离 |

### 3.2 naive-ui GlobalThemeOverrides

新建 `src/theme/overrides.ts`：

```ts
export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides
```

实现要点：
- 通过 `getComputedStyle(document.documentElement).getPropertyValue(...)` 读 token
- 每个 key 带 fallback hex/数值，防 SSR/首屏空字符串
- 至少覆盖以下范畴（具体值在实现时按 token 填）：
  - `common`: primaryColor / textColor1/2/3 / borderColor / cardColor
  - `Card`: borderRadius = `--radius-lg`, paddingMedium = `--space-12`
  - `Button`: borderRadiusSmall = `--radius-sm`
  - `Select / Input / Pagination`: 圆角对齐 sm/md
  - `Tag`: borderRadius = `--radius-pill`, heightSmall = 18px
  - `Tooltip / Popover`: borderRadius = `--radius-md`, padding = `--space-8 --space-12`
  - `Skeleton / Empty`: borderRadius = `--radius-md`

`src/pinia/setting.ts` 增 computed `themeOverrides`（依赖 `theme.value.name`），App 根 `n-config-provider` 绑 `:theme-overrides`。求值放在 `onMounted` / `nextTick` 后，避免首屏读不到 CSS var。

### 3.3 组件清洗 pattern（13 个全做）

通用 pattern：

1. inline `style="font-size: Xpx"` → class + `var(--font-size-*)`，按字阶映射
2. `padding/margin/gap: Xpx` → `var(--space-X)`；不在阶上的吸附到最近 token
3. `border-radius: 6/10/12px` → `var(--radius-{sm,md,lg})`
4. ad-hoc `box-shadow` → `var(--shadow-{sm,md,lg})`；保留 `--glow-win/loss` 不动
5. naive-ui 组件上的微调 style 迁到 scoped class，多数能被 `GlobalThemeOverrides` 兜底删除
6. 十六进制硬编码色 → 对应 `--semantic-*` / `--win-*` / `--loss-*` token；若代码里有 rgba 透明度拼字符串场景，保留 `--glow-*` 不动

代表重灾区（先做这 3 个建立 pattern 范例，其他批量过）：

| 组件 | 硬编码处数 | 重要性 |
|---|---|---|
| `RecordCard.vue` | 16 | 列表基本单元，权重最高 |
| `UserRecord.vue` | 8 | 占侧栏，是字号视觉基准 |
| `MatchDetailModal.vue` | 34 | 弹窗最大单文件 |

### 3.4 新增 UI 状态

**骨架屏（n-skeleton）**：
- 新建 `RecordCardSkeleton.vue`（高度对齐真实 ~64px，内 `n-skeleton` 模拟 win-bar / 头像 / KDA / 装备格）
- `MatchHistory.vue` 在 `isRequestingMatchHostory && !matchHistory` 时渲染 10 个 skeleton 占位
- 翻页 loading 走 toolbar 上方 2px 进度条，不全屏闪
- `MatchAIPanel.vue` 流式加载初期 `n-skeleton text :repeat="4"` 替代空白

**空态（n-empty）**：
- `MatchHistory.vue` 筛选后 `games.length === 0`：`<n-empty description="没有匹配的对局" />` + "清除筛选" 按钮（复用 `resetFilter`）
- 战绩首次加载失败：catch 分支设 `loadError = true` → `<n-empty>` + 重试按钮

**图片懒加载占位**：
- 新建 `src/components/common/LazyImg.vue`：onload 前用 `--bg-elevated` + `@keyframes shimmer`（global.css 已有）扫光，onload 后切真实 img；onError fallback
- 本轮落地到 `RecordCard.vue` 的英雄/item/spell/perk icon 和 `TeamAvatarGroup.vue`

### 3.5 响应式过渡

`Record.vue` 当前 `windowWidth < 500` 直 `v-show` 切换。改造：

- 新建 `src/composables/useBreakpoint.ts`，导出 `{ md: 768, lg: 1024 }` 的 reactive ref；替换组件内直接读 `window.innerWidth` 的散落代码
- 断点抬到 768px
- `n-layout-content` 包 `<Transition name="slide-fade">`：`opacity + translateX(16px)` + `var(--dur-normal)` + `var(--ease-expo)`
- `n-layout-sider` 宽度变化加 `transition: width var(--dur-spring) var(--ease-expo)`
- 把"侧栏无滚动条"的 `::-webkit-scrollbar { display: none }` 从 scoped 提到 `global.css` 的 `.no-scrollbar` 类，组件按需 class（确保用户硬约束生效）

## 4. 验证

### 4.1 MCP 截图对比流程（用 hypothesi/tauri-mcp-server）

1. 启动 `npm run tauri dev`；`driver_session start port=9223`
2. **基线快照**：对 `#/Record?name=幽默的二次元#12510` 截 4 张到 `tests/visual/baseline/`：
   - dark × ≥768px viewport
   - dark × 767px（mobile 态）
   - light × ≥768px
   - light × 767px

   用 `manage_window resize` 切窗口宽度
3. 每完成一个组件清洗：`webview_screenshot` 同视口 → 与 baseline 肉眼/diff 比对（不能"明显变样"，只能更整齐）
4. **token 验证脚本**（`webview_execute_js`）：遍历 RecordCard / UserRecord 内的关键节点，读 `getComputedStyle(el).{fontSize, borderRadius, padding}`，断言数值落在 token 集合内（不能出现 7px/10px 这类非阶值）
5. **DOM 对比**：`webview_dom_snapshot type=structure` 前后跑一次，确认没多塞元素、层级一致

### 4.2 自动化测试

- `vitest`：
  - `useBreakpoint` 纯逻辑（resize 事件触发 → ref 更新）
  - `buildThemeOverrides(isDark)` 工厂函数返回结构断言
  - `MatchHistory` skeleton / empty 分支：`@vue/test-utils` 渲染断言"loading 时 skeleton 数量 == 10" / "filter 且 0 games 时 n-empty 出现"

### 4.3 视觉回归人工自查清单

每个组件改完，从开发窗口实际滚一遍：
a) hover 态
b) dark ↔ light 切主题
c) 768px 临界 resize
d) 筛选 0 条
e) 翻页 loading
f) 战绩加载失败模拟

### 4.4 质量门禁

`cd lol-record-analysis-tauri && npm run check` 必须全绿（prettier + eslint + vue-tsc + cargo fmt --check + cargo clippy -Dwarnings，与 CI 一致）。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `getComputedStyle` 读 token 在首屏返回空字符串 | 每个 key 带 fallback hex；`themeOverrides` 求值放 `onMounted` / `nextTick` |
| 十六进制硬编码改 CSS var 后 rgba 拼字符串失效 | 保留 `--glow-win/loss` 不动，只替换实色用法 |
| 断点抬到 768px 在小窗 Tauri 直接进 mobile 态 | 接受现状，代码留 user override hook（YAGNI 本轮不做） |
| 13 个组件 token 清洗误改文案/结构 | 每个组件独立 commit；MCP DOM snapshot 前后对比；视觉自查清单逐项过 |
| GlobalThemeOverrides 改 naive-ui 视觉，可能波及未在 scope 的页面（Settings/Header）| 这些页面已经是 naive-ui 默认外观，新 overrides 若与默认差异大需在 PR 自查；小差异接受、大差异酌情豁免某些 naive 组件 |

## 6. 回滚策略

每个组件独立 commit（消息格式 `refactor(record): clean tokens in <Component>`），token 与 overrides 各自单独 commit。出问题逐 commit `git revert`。`global.css` 只追加不删 token，旧组件即使没改也不会坏。

## 7. 实施顺序

建议执行顺序（每步独立 commit，方便 revert）：

1. `global.css` 追加字阶 / space-2/6/10 / radius-xs/pill / win-loss 渐变 token
2. 新建 `theme/overrides.ts` + `pinia/setting.ts` 接通 + App 根 `n-config-provider` 绑定
3. 新建 `composables/useBreakpoint.ts`
4. 新建 `common/LazyImg.vue` + `record/RecordCardSkeleton.vue`
5. `Record.vue` 断点 + 过渡（先验证布局没破）
6. `RecordCard.vue` → `UserRecord.vue` → `MatchHistory.vue`（含 skeleton/empty 接入）
7. `RankCard` / `RelationshipPanel` / `RecentStatsTable` / `ProgressStatRow` / `StatDots` / `RecordButton` / `TeamAvatarGroup` / `AssetTooltipContent`
8. `MatchDetailModal.vue`（34 处，最重）
9. `MatchAIPanel.vue`（含 streaming skeleton）
10. 全量 `npm run check` + MCP 截图对比 + 视觉自查清单走一遍

## 8. 后续工作（非本 spec 范围）

本 spec 落地后，token + 模式将成为基准。后续每个页/组件群按相同 pattern 扩散：

- 下一轮：`MatchDetailModal` 系列已含本轮；之后是 `gaming/**`（PlayerCard / SubteamCard / PlayerStatsCard 等）
- 再下一轮：`automation/**` / `tags/**`
- 最后：是否引入 `:root[data-density="compact|comfortable"]` 让用户切信息密度（YAGNI，看反馈）

这些都作为单独的小型 spec 或常规改造 PR 走，不再单独大型设计。
