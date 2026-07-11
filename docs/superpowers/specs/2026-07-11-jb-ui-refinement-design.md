# UI 质感统一 + JetBrains 细节借鉴 设计文档

日期：2026-07-11
范围决策（用户已确认）：**轻度借鉴 JB（Int UI）+ 全量硬编码清洗**。整体深色玻璃拟态风格与游戏语义色保留，只吸收 JB 的标志性细节。

## 背景调研结论

- 项目已有完整 token 体系（`src/global.css`）+ naive-ui 桥接层（`src/theme/overrides.ts`）+ 明暗双主题，架构正确。
- 短板是落地一致性：36 种一次性 hex、157 处 rgba、约 49 处硬编码字号（`12px` 直写 27 次）、约 20 处硬编码圆角（5/7/10px 野值）、约 46 处离散 padding。
- JetBrains Int UI 的质感配方（来自 intellij-community expUI theme JSON 与 Jewel 源码）：
  1. 镂空描边按钮：secondary = 透明底 + 1px 边框，hover 只提亮边框不加底色
  2. Primary 按钮 hover 变深不变浅
  3. 几乎全扁平，层次靠灰阶与 1px 分割线
  4. 小圆角双档制：控件 4px / 浮层 8px，无中间值
  5. 实心 2px focus ring + 1px offset，替代光晕
  6. 控件高 28px、UI 字号 13px（Inter）

## 已实施（阶段一：token + overrides）

### `src/global.css`
- 新增 `--radius-control: 4px` / `--radius-overlay: 8px`（双档制）
- 新增 `--border-control` / `--border-control-hover`（镂空按钮边框，明暗两套）
- 新增 focus ring token：`--focus-ring-width/offset/color` + 全局 `:focus-visible` 实心环规则
- 新增语义高亮 token（收编散落 hex 用，明暗两套）：
  `--accent-gold` `--accent-gold-deep` `--accent-blue` `--accent-sky` `--semantic-win-bright` `--semantic-loss-bright`
- 字阶补全：`--font-size-3xs: 9px`、`--font-size-2xl: 24px`、`--font-size-3xl: 28px`

### `src/theme/overrides.ts`
- `common`：borderRadius → 4px 控件档；fontSize 13px；heightMedium 28px / heightSmall 24px；primaryColor 统一到 semantic-win，hover/pressed 逐级**变深**
- `Button`：默认按钮改镂空描边（透明底 + 1px 边，hover 只提亮边框，文字色不变）
- `Input`：focus 改实心环（borderFocus + 2px boxShadowFocus @35%）
- `Tooltip/Popover/Dropdown` → `--radius-overlay`(8px)；`Select/Pagination` → `--radius-control`(4px)
- Card 保持 12px 玻璃拟态、Tag 保持 pill、Menu 保持现状（应用个性，不 JB 化）

## 阶段二/三：硬编码清洗映射规范

清洗只动 `<style>` 内的值与内联 style，**不改模板结构、类名、逻辑**。

### 颜色映射
| 散落值 | 归入 token |
|---|---|
| 金/琥珀系（#f2bf63 #f7d35f #f6d365 #f4c658 等亮金） | `var(--accent-gold)` |
| 深金（#e5a732 #d4a017 #d97706 #b8860b #d38b2a） | `var(--accent-gold-deep)` 或语义为警示时 `var(--semantic-warn)` |
| 亮绿（#5ecfa4 #63d8b4 #4ade80） | `var(--semantic-win-bright)` |
| 标准绿（#3d9b7a #2d8a6c #0d9668） | `var(--semantic-win)` |
| 亮红（#e57878 #ef7d7d） | `var(--semantic-loss-bright)` |
| 标准红 | `var(--semantic-loss)` |
| 亮蓝（#59b5ff #7eb8ff #5ca3ea） | `var(--accent-blue)` |
| 天蓝（#38bdf8 #0284c7 #0369a1） | `var(--accent-sky)` |
| rgba(255,255,255,x) 背景 | 玻璃三档 `--glass-bg-low/mid/high`（0.03/0.05/0.08 取最近） |
| rgba(255,255,255,x) 边框 | `--border-subtle`(0.06) / `--glass-border`(0.09) / `--border-control`(0.16) |
| rgba(255,255,255,x) 文字 | `--text-primary`(0.92) / `--text-secondary`(0.65) / `--text-tertiary`(0.45) |
| 黑色阴影 rgba(0,0,0,x) | `--shadow-sm/md/lg` 或保留（阴影透明度属于局部设计） |

色差过大无法归档的值：保留原值，在报告中列出，不得私造新 token。

### 圆角映射
2/3px→`--radius-xs`；4/5px→`--radius-control`；6px→`--radius-sm`；7/8px→`--radius-md`（浮层用 `--radius-overlay`）；10/12px→`--radius-lg`；16px→`--radius-xl`；99/999px→`--radius-pill`

### 字号映射
8/9→`--font-size-3xs`；10→`2xs`；11→`xs`；12→`sm`；13→`base`；14→`md`；16→`lg`；18→`xl`；24→`2xl`；28→`3xl`

### 间距映射
padding/margin/gap 的 px 归最近 `--space-*`（2/4/6/8/10/12/16/20/24/28）；1px 保留；复合值逐项映射。

### 专项修复
- `About.vue:200` 内联 style 字符串 → scoped class
- `PlayerHistoryGrid.vue:121` Segoe UI 字体栈 → 删除（继承全局 Inter）
- `MettingPlayersCard.vue:153` 直写 Oswald → 使用 `.font-number`

## 验证
- `npm run check` + `npm run test` 全绿
- 明暗两主题逐页视觉走查（Record / MatchDetail / Gaming / Settings），用户微调收尾
