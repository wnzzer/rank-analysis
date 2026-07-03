# 标签体系迭代设计（CurrentChampion 修复 / 引擎扩展 / 语义默认标签 / AI 接入 / 融合视图）

- 日期：2026-07-02
- 状态：已确认（设计已与维护者逐节评审通过）
- 关联：issue #67（手动玩家标记）、PR #80 评审结论（标签统计样本保持 20 场不变）

## 背景与目标

项目现有两套标签体系：

1. **系统计算标签**：`src-tauri/src/command/user_tag_config.rs` 的条件树规则引擎 + `user_tag.rs` 的求值入口，默认标签集偏统计型（连胜/娱乐/峡谷慈善家）。
2. **手动备注**（issue #67）：`src/pinia/playerNotes.ts`，四色档 + 自由文本，纯本地。

本次迭代四个子项，目标是让系统标签覆盖用户真正关心的语义（代练/炸鱼/状态/行为），并打通标签、备注与 AI 分析之间的数据断点。

**不做**（明确排除）：战绩缓存结构改造（50 场预热与 60s TTL 保持现状，后续单独迭代）；AI 多供应商支持；备注云同步。

## 子项 1：CurrentChampion 断点修复

**现状**：`TagCondition::CurrentChampion` 求值时 `EvalContext.current_champion` 硬编码为 `None`（`user_tag_config.rs:370`），该条件恒为 false，「英雄专精/本命英雄」类标签无法生效。

**改动**：

- `TagConfig::evaluate(&self, match_history, current_mode)` → 增加参数 `current_champion: Option<i32>`，注入 `EvalContext`。
- Tauri command `get_user_tag_by_puuid(puuid, mode)` → 增加可选参数 `champion_id: Option<i32>`。
- 调用方：
  - `session.rs:640`（对局中流程）传 `player.champion_id`；
  - `get_user_tag_by_name`（战绩查询页）传 `None`——「当前英雄」条件只在选人/对局中有语义，战绩页不触发是预期行为。

## 子项 2：规则引擎最小扩展（已选方案 A）

> 备选方案 B（零引擎改动，砍掉三类标签）与 C（通用表达式框架）已评审并否决：B 产品缩水一半，C 的 Tags.vue 可视化编辑器复杂度不可控。

### 新增原语

**`MatchRefresh` 新变体**：

```rust
/// 筛选后对局中不同英雄的数量与阈值比较
DistinctChampions { op: Operator, value: f64 },

/// 「满足逐场条件的场次占比」与阈值比较：
/// ratio = count(filtered games where metric <game_op> game_value) / count(filtered games)
Ratio {
    metric: String,
    game_op: Operator,
    game_value: f64,
    op: Operator,
    value: f64,
},
```

**`MatchFilter` 新变体**：

```rust
/// 只取最近 N 场（按对局时间倒序），在其他筛选器之前应用
Recent { count: i32 },
```

窗口对比（如「近 10 场 vs 近 20 场」）用两个不同 `Recent` 的 `History` 条件以 `And` 组合表达，不引入专门的对比原语。

**`extract_game_metric` 新指标**（数据来自 `game_detail.participants`，user_tag 流程已 `enrich_game_detail`，无额外请求）：

- `damageShare`：本人对英雄伤害 / 本方全队对英雄伤害；
- `participation`：参团率 (kills + assists) / 本方全队击杀（全队击杀为 0 时取 0）。

### 前端同步

- `src/types/tagSuggest.ts` 镜像新变体类型；
- `src/components/tags/TagConditionNode.vue` 支持新原语的可视化编辑（下拉新增变体 + 对应字段输入）。

## 子项 3：语义类默认标签（四个）

追加到 `get_default_tags()`，全部 `is_default: true, enabled: true`。阈值用户可在 `/Settings/Tags` 调整。负面标签阈值刻意保守、措辞克制（避免误伤引发社区争议），desc 均注明「仅供参考」。

| id | 名称 | 极性 | 规则 |
|----|------|------|------|
| `default_smurf` | 炸鱼嫌疑 | bad | And[History(排位 + Recent 20, Count ≥ 10), History(排位 + Recent 20, Average win ≥ 0.75), History(排位 + Recent 20, Average kda ≥ 5)] |
| `default_champion_pool_narrow` | 专精 | good | And[History(Recent 20, DistinctChampions ≤ 3), History(Recent 20, Count ≥ 10)] |
| `default_hot_streak_form` | 手热 | good | And[History(排位 + Recent 10, Average win ≥ 0.7), History(排位 + Recent 20, Average win ≤ 0.55), History(排位 + Recent 20, Count ≥ 15)] |
| `default_cold_form` | 低谷 | bad | And[History(排位 + Recent 10, Average win ≤ 0.3), History(排位 + Recent 20, Average win ≥ 0.45), History(排位 + Recent 20, Count ≥ 15)] |
| `default_int_risk` | 伤害贡献低 | bad | History(Recent 20, Ratio: damageShare < 0.05 的场次占比 ≥ 0.3) |

> 注：手热/低谷需近 20 场内有足够场次（Count ≥ 15）避免小样本误报；「专精」与子项 1 的 CurrentChampion 组合后可衍生「本命英雄」玩法，本期不内置该衍生标签。
>
> 「英雄海」（`default_champion_pool_wide`）经维护者评审撤下——按「玩过的不同英雄数」算池宽会被随机英雄模式与浅尝行为污染，需要「每个英雄有足够场次」的更严定义，待引擎支持 per-champion 统计后再迭代。
>
> `default_int_risk` 由「挂机送头风险」改名为「伤害贡献低」：改为事实描述、避免动机指控式命名误伤软辅等低伤害正常定位，同时收紧阈值（单场 damageShare < 0.05、占比 ≥ 0.3）。

## 子项 4：默认标签合并（老用户可见性）

**现状**：`load_config()`（`user_tag_config.rs:826`）只在 `userTags` 配置不存在时写入默认集，老用户永远看不到新增默认标签。

**改动**：`load_config` 读到已有配置后，按 `id` 与 `get_default_tags()` 比对，**只追加用户配置中不存在的默认标签**并回存。用户已有的任何配置（禁用、改阈值、改名）一律不覆盖。用户删除默认标签的场景不存在（`is_default` 标签 UI 上不可删除），故无需「删除墓碑」机制。

## 子项 5：手动备注接入 AI（链路 1 + 3，带开关）

- 新 config key：`aiUsePlayerNotes`（`src/services/configKeys.ts`），默认 `true`；`General.vue` 在自定义 AI Key 附近加开关，文案说明「开启后你的玩家备注会随分析请求发送到 AI 服务」。
- **链路 3（对局中整队/单人分析）**：`src/services/ai/player-insight.ts` 画像组装处附加备注：色档中文名（友好/普通/谨慎/黑名单）+ 备注文本（截断 50 字）。
- **链路 1（战绩复盘）**：`src/services/ai/matchDetail/shared/snapshot.ts` 的 `RecentPlayerProfile` 增加 `note` 可选字段，批量组装（`recentProfile.batch.ts`）时从 `playerNotes` store 读取；stage1/stage2 prompt 中标注该字段为「用户主观历史印象，仅供参考，不作为事实依据」。
- 开关关闭时，两条链路均不读取、不注入备注。

## 子项 6：融合视图（统一渲染 + 一键固化）

- 新组件 `src/components/common/UnifiedTagRow.vue`：系统标签 chip 与备注 chip 混排一行，备注 chip 带图标（如 ✎）区分来源；替换 `PlayerCard.vue`、`UserRecord.vue`、`MatchDetailModal.vue` 三处现有的分离渲染。
- **一键固化**：点击系统标签 chip 弹 popover「存为备注」，预填内容 `tag_name + tag_desc`、推荐色档（good → friendly，bad → careful），可编辑后调用现有 `playerNotes.setNote` 保存。已有备注的玩家固化时追加到原文本（换行分隔），不覆盖色档。
- 不做（本期）：备注管理页显示来源标签、固化时附带战绩快照（评审时已排除「完整双向融合」方案）。

### 实现偏差记录（2026-07-03）

1. **MatchDetailModal 未接入**——经核实该文件从未渲染过系统标签（plan 阶段假设错误），实际替换为 PlayerCard 与 UserRecord 两处；对局详情如需展示系统标签需先为每行玩家拉取 userTag，属新功能另立。
2. **固化 popover 为一键确认而非 inline 可编辑**——编辑入口统一走 PlayerNoteBadge 面板，避免两处编辑器；固化路径有去重与 100 字上限保护。

## 测试

- **Rust 单测**（`user_tag_config.rs` 子模块测试，Windows CI 跑，mac 本地只验 fmt）：
  - `DistinctChampions` / `Ratio` / `Recent` 求值：空历史、边界阈值、组合条件；
  - `damageShare` / `participation`：`game_detail` 缺失时返回 0 不 panic；
  - 默认标签合并：空配置、部分缺失、用户改过的项不被覆盖；
  - `evaluate` 注入 `current_champion` 后 `CurrentChampion` 命中/不命中。
- **前端 vitest**：
  - `tagSuggest.ts` 新类型与 Rust schema 序列化一致性（fixture 校验）；
  - `UnifiedTagRow.vue` 渲染两类 chip、固化交互调用 `setNote` 的参数正确；
  - `aiUsePlayerNotes` 开关关闭时 snapshot/player-insight 不含备注字段。

## 交付切分（4 个 PR，按依赖顺序，均可独立回滚）

1. `fix(user-tag)`: CurrentChampion 注入 + 引擎三原语与两指标 + Rust 单测（子项 1、2 后端部分）
2. `feat(user-tag)`: 语义默认标签 + 合并逻辑 + 前端条件编辑器支持（子项 3、4 + 子项 2 前端部分）
3. `feat(ai)`: 备注接入链路 1/3 + 设置开关（子项 5）
4. `feat(record)`: UnifiedTagRow 融合视图 + 一键固化（子项 6）

每个 PR 走 `.claude/skills/shipping-changes` 流程（`npm run check` 前端部分本地跑，Rust 侧靠 Windows CI）。
