# BP 智能推荐 + OPGG 段位选择 设计文档

日期：2026-08-02
分支：feat/bp-decision-preview（或从其切出新分支）

## 背景与目标

自动化页的 ban/pick 目前是「规则列表 + 兜底池」，兜底池（`settings.auto.pickChampionSlice` / `banChampionSlice`）需要用户手动挑英雄。本功能提供一键智能推荐：

1. **常用英雄 → 英雄池**：近期场次最多的英雄推进 pick 兜底池。
2. **常输给的英雄 → ban 池**：败局中敌方阵容高频出现的英雄推进 ban 兜底池（语义：ban 掉经常打赢我的英雄）。
3. **版本 T0 → 按熟练度分流**：OPGG T0/T1 英雄，我玩过且胜率≥50% 的建议 pick，不玩的建议 ban（留给对面就是威胁）。
4. **OPGG 段位可选**：`tier` 参数从硬编码 `emerald_plus` 改为用户可配置，全局生效（推荐、BP 决策 evidence、克制提示、AI prompt 情报同源受益）。

### 已确认的事实依据

- OPGG API `tier` 参数实测有效：`gold_plus / platinum_plus / emerald_plus / diamond_plus / master_plus / all` 均返回 200 且数据（胜率、样本量）随段位真实变化。
- 「常输给谁」无需额外网络请求：现有 match history 的 `game.game_detail.participants` + `participant_identities` 已含全部 10 人名单（`is_my_team`、`champion_id`、`stats.win`），`user_tag.rs::get_one_game_players` 即是先例。
- 选人期敌方 `assignedPosition` 恒为空（平台限制），本功能不依赖敌方位置。
- 国服 lane/role 字段不完全可信（memory: lcu-match-data-gaps），故主玩分路仅作默认值，UI 允许手动切换。

## 非目标

- 不使用 AI（三类候选均为确定性聚合；标签推荐用 AI 是因为要归纳输赢共同点，此处不需要）。
- 不改动规则列表（pickRules/banRules），只写兜底池。
- 不做后台自动维护池子；只在用户打开面板并逐项采用时写入。
- 不推断敌方分路。

## 交互设计（对齐 AISuggestModal 的「采纳」模式）

自动化页加「智能推荐」按钮 → 打开 `BpSuggestModal`：

- 三个分区卡片流：「常用英雄 → 英雄池」「常输给的英雄 → ban 池」「版本 T0（按熟练度分流）」。
- 每张卡：英雄头像 + 名字 + 依据文案（如「12 场 · 胜率 58%」「8 场败局中出现 5 次」「T0 · 上单 · 胜率 52.3%」）+ 主按钮（「加入英雄池」或「加入 ban 池」）。T0 卡额外提供反向次按钮（手动改去向）。
- 采用后卡片灰态「已加入」；`already_in_pool=true` 的候选初始即灰态。
- 右上角「重新生成」强制刷新。
- 分路下拉：默认统计出的主玩分路，可手动切换；pick 向候选按所选分路过滤，ban 向不限分路。
- 段位下拉：放「智能推荐」按钮旁（自动化页），改变 `settings.opgg.tier` 并触发 `update_opgg_data`。

### 边态

- 战绩样本 < 10 场：空态「近期对局太少（N 局），打几局再来」。
- OPGG 拉取失败：仅 T0 分区显示不可用 + 重试；常用/常输分区照常展示。
- 段位切换后重拉失败：降级用 stale 缓存（沿用现有降级链），UI 提示 stale。

## 后端设计

### 新命令 `get_bp_suggest`（`src-tauri/src/command/bp_suggest.rs`）

输入：`position: Option<String>`。`None` = 自动模式，用统计出的主玩分路并据此过滤 pick 向；显式传空字符串 `""` = 用户选「全部分路」，不过滤 pick 向（即使统计出的主玩分路非空也不生效）。
数据源：当前登录用户近 30 场 match history（排位 420/440 优先，不足 10 场放宽全模式；遵守冷缓存约束首请求 0-49）+ `ensure_opgg_snapshot("ranked")`。

返回（snake_case，前端同构 `src/types/bpSuggest.ts`）：

```rust
pub struct BpSuggestResult {
    pub main_position: String,      // 统计出的主玩分路（top/jungle/middle/bottom/utility，未知为 ""）
    pub sample_games: i32,          // 参与统计的场次
    pub opgg_ok: bool,              // false 时 hot_t0 为空，前端展示降级态
    pub frequent: Vec<BpSuggestItem>,
    pub nemesis: Vec<BpSuggestItem>,
    pub hot_t0: Vec<BpSuggestItem>,
}

pub struct BpSuggestItem {
    pub champion_id: i32,
    pub suggested_pool: SuggestedPool,   // Pick | Ban
    pub already_in_pool: bool,           // 已在对应 slice 中
    pub evidence: BpSuggestEvidence,     // 全 Option 字段：games/win_rate/losses_against/loss_games/opgg_tier/opgg_rank/position/opgg_win_rate
}
```

### 聚合规则（纯函数，输入 games 切片 + snapshot + 现有两个 slice）

- **frequent**：自己（participants[0]）按 champion_id 聚合；`games >= 3` 才入选；按场次降序 top 8；`suggested_pool = Pick`。
- **nemesis**：仅败局；敌方（`!is_my_team`）champion_id 聚合出现次数；`>= 2` 次才入选；按次数降序 top 8；`suggested_pool = Ban`；排除已在 frequent 的英雄（自己主玩的不建议 ban）。
- **hot_t0**：snapshot 中 `tier == 1` 的英雄（OP.GG tier 1 即最强档；tier 0 表示该英雄无该分路数据，不能用 `<=` 把它误判为强势）。「会玩」判据基于**原始按英雄聚合统计**（不受 frequent top8 截断影响）：该英雄我打过 ≥ 3 场且胜率 ≥ 50%。pick 向：`is_main_position` 且（所选分路为空字符串「全部分路」，或 position == 所选分路），且「会玩」→ Pick；其余（「不会玩」的，全分路、按 ban_rate 降序）→ Ban。合计 top 8。与 frequent/nemesis 重复的 champion_id 去重（保留 T0 徽章信息合并进 evidence 亦可，首版直接去重跳过）。
- **主玩分路统计**：Rust 侧战绩结构（`model.rs::Participant/Stats`）没有声明任何 lane/position 字段，且国服 lane 数据本就不可信——改用 **常用英雄的 OPGG 主分路加权众数**：对我打过 ≥2 场的每个英雄，取其 OPGG `is_main_position` 分路，按我的场次加权投票，得票最高的分路即 `main_position`。OPGG 不可用或无票时 `main_position = ""`，前端下拉默认「全部」（不过滤）。
- `already_in_pool`：Pick 向对照 `pickChampionSlice`，Ban 向对照 `banChampionSlice`。

### OPGG 段位配置

- 新配置键 `settings.opgg.tier`，默认 `"emerald_plus"`；合法值白名单 `gold_plus / platinum_plus / emerald_plus / diamond_plus / master_plus / all`，非法值回退默认。
- `opgg/api.rs::mode_url` 改为接受 tier 参数（仅 ranked 拼接）；`OpggSnapshot` 增加 `tier: String` 字段。
- 缓存命中校验：内存/磁盘快照的 `tier` 与当前配置不符 → 视为 miss 走 HTTP；磁盘文件名保持 `opgg_cache_ranked.json` 不变（靠内容里的 tier 字段判断，避免文件散落）。旧缓存无 tier 字段 → serde default 空串 → 天然 miss，一次性平滑迁移。
- aram 模式不受影响（无 tier 参数）。

## 前端设计

- `src/types/bpSuggest.ts`：与 Rust 同构类型。
- `src/components/automation/BpSuggestModal.vue`：结构/状态机对齐 `AISuggestModal.vue`（loading / insufficient / error / ok；分区卡片；逐卡采用；灰态）。
- 采用动作：读对应 slice → 去重 append → `putConfigByIpc('settings.auto.pickChampionSlice' | 'banChampionSlice', ...)` → 本地灰态。与 Automation.vue 现有池子状态保持同步（modal 由 Automation.vue 挂载，采用后 emit 让父组件刷新本地 ref）。
- `Automation.vue`：加「智能推荐」按钮 + 段位下拉（`NSelect`，值写 `settings.opgg.tier`，变更后 invoke `update_opgg_data` 强制刷新）。

## 测试

- Rust（`bp_suggest` 模块内 `#[cfg(test)]`）：
  - frequent/nemesis 聚合（阈值、排序、排除 frequent、败局过滤）
  - hot_t0 分流（会玩→pick / 不玩→ban、分路过滤、去重）
  - 主玩分路众数与全空回退
  - `already_in_pool` 标记
  - tier 缓存校验（tier 不匹配视为 miss、旧缓存无 tier 字段视为 miss、非法配置回退默认）
- 前端（Vitest）：
  - `BpSuggestModal.spec.ts`：采用写回 slice（去重）、灰态切换、OPGG 降级态、样本不足空态
  - 段位下拉写配置 + 触发刷新

## 实施拆分建议

1. OPGG 段位配置（后端 tier 贯通 + 缓存校验 + 测试）——独立可交付。
2. 后端 `get_bp_suggest` 聚合 + 测试。
3. 前端类型 + `BpSuggestModal` + `Automation.vue` 接线 + 测试。
