# Rank Analysis · 设计语言规范 v3 「奥术金工 Hextech Forge」

> D1 定稿（2026-08-21）。配套 token 文件：[`tokens.css`](./tokens.css)（单一来源，本文件不重复罗列色值）。
> 适用范围：主窗口、record-* 子窗口、overlay 窗口。原型阶段（D2）直接消费 tokens.css。

---

## 1. 设计立场

**一件为召唤师打造的暗色测量仪器。**

三条不变式（所有页面与组件的设计裁决标准）：

1. **金色即结论**：品牌金只出现在"当前最重要的一个答案"上（VerdictBanner、激活态、关键数值）。金色永不表达胜负——胜负永远属于绿/红语义。
2. **切角即身份**：切角卡片（左上+右下斜切）是全应用唯一的容器语法。看到切角 = 这是 Rank Analysis。
3. **密度分层**：任何信息组件只有 normal / compact 两档，由容器 `data-density` 下发，组件不自判。

---

## 2. 色彩系统

### 2.1 角色分工

| 角色 | Token | 用途 | 禁忌 |
|------|-------|------|------|
| 品牌·金 | `--brand` / `--brand-strong` / `--brand-soft` / `--brand-gradient` | 结论词、激活导航、主 CTA、充能环、关键强调 | 不得用于胜负数据、大面积底色 |
| 信息·青 | `--info` 系列 | 链接、OP.GG 数据源标识、可切换控件 | — |
| 胜利 | `--win` 系列 | 胜局、正向 delta、已连接 | — |
| 失败 | `--loss` 系列 | 败局、负向 delta、危险动作 hover | — |
| 警示 | `--warn` 系列 | 风险提示 tag、toast warning | 不与金混用同一元素 |
| 表面 | `--bg-base/surface/raised` | 三层深度：画布 < 卡片 < 浮层 | 卡片禁用纯黑 |

### 2.2 双主题

- **金工暗器（默认深色）**：蓝黑三层表面 + 金；允许辉光（`--glow-*`）。
- **羊皮纸金工（浅色）**：暖纸三层 + 深金；**辉光全部置 none**（白底光晕读作污渍），阴影改暖灰 `rgba(60,50,30,*)`。
- 判定规则：换主题只换 token 值，不改任何组件样式；若某组件需要主题分支样式，视为 token 缺失，回 D1 补。

### 2.3 对比度基线

| 层级 | 要求 |
|------|------|
| 正文（secondary 及以上） | ≥ 4.5:1 |
| 辅注（tertiary，仅限非关键信息） | ≥ 3.5:1，字号 ≥ 11px |
| 金色文字 | 仅用于 ≥14px Bold 或配 `--text-on-brand` 底 |

---

## 3. 字体排印

- 界面栈：系统栈（`--font-stack`）；**数字一律 `.num`（Bahnschrift Condensed 气质）**：KDA、胜率、LP、倒计时、金额。
- 字阶（下限 10px，废除 9px）：

| Token | 用途 |
|-------|------|
| display 34 / 3xl 26 | VerdictBanner 结论词（指挥舱模式）、主页问候 |
| 2xl 22 / xl 18 | 页标题、卡片大数值 |
| lg 16 / md 14 / base 13 | 正文与小标题 |
| sm 12 / xs 11 / 2xs 10 | 辅注、标签、时间戳 |

- 大写小标签（如 `// CURRENT_VERDICT` 式的区块眉题）：`xs + weight 600 + tracking-label`，颜色 tertiary。**每屏最多 2 处**，防止 HUD 化过度。

---

## 4. 形状与材质

### 4.1 切角几何

| Token | 参数 | 用途 |
|-------|------|------|
| `--clip-corner-md` | 14px 斜切 | CornerCard（情报舱、大卡） |
| `--clip-corner-sm` | 8px 斜切 | 小卡、PlayerCard、输入框组 |
| `--clip-notch` | 单角 6px | 按钮、chip、tier 选择器 |

规则：
- 一个屏幕内切角尺寸只能有一种档位（md 或 sm），按钮/chip 的 notch 不受此限；
- 切角容器**不加圆角**；未切角的辅助容器（表格、下拉面板）用 `--radius-md`；
- clip-path 会裁掉 box-shadow → 需要「浮起」的切角卡用外包裹层投影（见 CornerCard 规格）。

### 4.2 材质

- **微噪点**：CornerCard 内叠 `--noise-img`（opacity 0.03，pointer-events:none），给暗面"金属磨砂"质感；浅色主题 opacity 减半。
- **描边优先**：分离靠 1px 描边（subtle/strong）而非重投影；浮层才用 shadow-3。
- **辉光**：仅三种合法形态——激活导航 diamond、ChargeRing 进行中、VerdictBanner 结论词 text-shadow。其余一律禁止。

---

## 5. 动效规范

| 场景 | 时长/曲线 | 说明 |
|------|-----------|------|
| 页面切换 | dur-normal + ease-standard，Y 向 8px 淡入淡出 | 沿用现 page 过渡参数 |
| 结论更新 | 数值滚动 dur-fast + 结论词 crossfade dur-normal | VerdictBanner 专用 |
| 扫光 | 3.2s ease-in-out 循环，仅 VerdictBanner | moodboard A 已验证 |
| 充能环 | conic 百分比随剩余秒数线性更新，最后 5s 变 loss 色 | ChargeRing |
| 列表入场 | stagger 40ms + Y 8px | 战绩/标签网格 |
| ban 弹入 | dur-fast + ease-spring | 保留现有好细节 |
| 悬停 | 仅底色/描边变化；**标题栏、表格行、列表行禁 scale** | Windows 原生手感 |
| reduced-motion | 全部归零 | token 层已处理 |

---

## 6. 图标语言

- 线性图标：1.5px 描边、圆角端点、16/18px 两档（@vicons ionicons 现库延续，不再引新库）。
- **菱形母题**：导航激活指示、列表 marker、logo 元素统一用旋转 45° 方块（呼应切角），替代圆点。
- 品牌 logo：盾形轮廓 + 内部上升折线 + 金描边（D2 原型出 16/24/48 三档 SVG）。

---

## 7. 组件视觉规范（`components/ui/`）

> 每个组件给出解剖图、变体、状态。实现期以本节为验收依据。

### 7.1 CornerCard —— 万物容器

```
╱─────────────────────────────╲   ╱ = 14px 斜切
│ ▸ 区块眉题（可选）            │
│ 标题行…………………头部动作区      │
│ ─────────────────────────── │
│ Body（padding 16/20）        │
╲─────────────────────────────╲
```

- 变体：`emphasis`（border-hairline→brand-border + brand-soft 渐变头）、`plain`；
- 结构：外层 wrapper 承担 shadow-1/hover:shadow-2，内层 clip；
- 折叠态：header 可点，chevron 旋转，状态记忆由使用方持久化。

### 7.2 VerdictBanner —— 结论带（核心组件）

```
┌──╲                                                          ┌──╲
│ ◔17s │ 建议 选 杰斯（display 金渐变字）    推荐依据 梯度 T1 ▾ │
│ 充能环│ 一句话理由（sm secondary，超长截断+tooltip）           │
└──╲                                                          └──╲
```

- 尺寸：deck（环52/结论34，指挥舱与 Gaming 常态）/ compact（环28/结论18，Overlay）；
- 状态：`decision`（金）/ `fallback`（去金：结论词降为 primary 白，理由前缀「兜底」小标，弱化视觉引导用户存规则——沿用现有 BpDecisionBar 分级意图）/ `idle`（无决策：环空转 + "等待锁定…"）；
- 动效：结论更新走 §5 结论更新规格。

### 7.3 ChargeRing —— 充能环

- conic-gradient + radial mask；尺寸 52/40/28；色：进行中 brand、成功 win、告急(≤5s) loss；
- 复用场景：BP 倒计时、收集进度、重新分析进度。

### 7.4 PageHeader

```
kicker(xs label 金)          [actions]
Title(2xl bold) · meta(sm tertiary)
```
- 高度自适应，底 padding 16；主操作 ≤2 个（1 primary + 1 ghost），溢出进 ⋯ 菜单。

### 7.5 Toolbar

- 三分区：`filters`(左) / `view`(中弹性) / `data`(右)；
- 溢出策略：<900px 时 filters 收进「筛选 ⏷」popover，data 收进「更多 ⋯」；
- 内嵌分页变体：`‹ 3/12 ›` 放 view 区右端（废除 sticky 浮动分页）。

### 7.6 StatChip

`label(2xs tertiary) value(.num md bold tone色)`；tone: neutral/win/loss/info/brand；紧凑双 chip 可横排共享分隔线。

### 7.7 EmptyState

线性图标(32px, ink-500) + 标题(base bold) + 说明(sm secondary) + 动作槽；切角小卡内居中；禁止裸文案空态。

### 7.8 DangerButton

ghost 基座；hover 才染 loss（底 loss-soft + 字 loss）；必须搭配二次确认（popconfirm 或滑动确认条）；只允许出现在状态舱菜单与设置页，禁止常驻标题栏。

### 7.9 KeyHint

`⌘K` 形态：kbd 底 raised + border-strong + .num xs；跟随触发它的控件右侧或 tooltip 内。

### 7.10 CommandPalette

z-modal 居中 640px；输入框 + 分组结果（最近/页面/玩家/动作）；方向键 roving + Enter 执行；Esc 关闭。视觉：raised 底 + corner-md + shadow-3。

### 7.11 NavRail 舰桥项

```
◆ 战绩        ← active：左侧 3px 金 diamond + brand-soft 底 + glow-brand
```
- 收起态 64px 只显 icon（active diamond 仍在）；展开 200px 显 icon+label(xs)；
- 分区眉题（分析/库/系统）仅在展开态出现。

### 7.12 DataTable（设置/规则表）

- 行高 36、斑马纹禁用、hover bg-hover；表头 xs label 大写 tertiary；
- 启停 Switch 沿用 naive 但 overrides 对齐 token。

---

## 8. Naive UI 对接要点

- `buildThemeOverrides()` 重写为**只读 semantic token**（isDark 仅做 getComputedStyle 失败时的 fallback）；
- 组件几何覆盖：Button→notch 切角（用 CSS 覆盖 border-radius 为 0 + clip-path）、Card/Modal/Popover→radius-lg、Tag→pill；
- 全局禁令（写入 CODE_QUALITY.md）：组件内 hex/rgba、ad-hoc z-index、!important（naive 深选择器白名单除外）、9px 字号。

---

## 9. 旧 → 新迁移映射速查

| 旧 | 新 |
|----|----|
| `--semantic-win/-loss/-warn` | `--win/-loss/-warn` |
| `--accent-gold*`（品牌化用法） | `--brand*`（注意：原 gold 用于 MVP 徽章等处改 `--brand-strong`） |
| `--accent-blue/--accent-sky` | `--info` |
| `--glass-bg-low/mid/high` | `--bg-hover/--bg-active`（装饰性玻璃层废除） |
| `--transition-fast/normal/slow`、`--ease-out-expo` | `--dur-*` / `--ease-standard` |
| `--font-size-3xs`(9px) | `--font-size-2xs`(10px) 起 |
| z-index 散值 (100/9999…) | `--z-content/sticky/dock/modal/toast` |
| 圆点 marker | 菱形 marker（45° 方块） |

---

## 10. D2 原型验收清单（预告）

原型（`design/prototype/d2-forges.html`）须覆盖并逐条通过：

1. 主页（已连接/未连接两态）
2. Record 宽屏双栏 + 窄屏回退
3. Gaming 常态 + 指挥舱（倒计时走秒、fallback 态各一）
4. 赛后复盘详情栏
5. Growth / Library / Settings / Overlay
6. 主题切换（金工暗 ⇄ 羊皮纸亮）× 密度切换（normal/compact）

通过标准：§1 三不变式无一违反；两主题均无破相；走查会评审冻结后开工 P0。
