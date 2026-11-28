# 对局分析核心迁移到 Rust（子项目 1）设计

日期：2026-11-28

## 背景

项目取向是「重 Rust 轻 Node」，但复盘的计算逻辑——快照组装、时间线卡片、阵亡归责、指标、评分、标签——目前都在 TS（`src/services/ai/shared/`，约 3300 行），基准构建 / 消融 / 评测脚本又直接 import 这些 TS 代码，整条链被迫留在 Node。

迁移拆成三个子项目，各自走设计 → 计划 → 实施：

1. **本文：Rust 分析核心 + 对拍**。把计算逻辑移植到 Rust，与 TS 逐局对拍；不切换调用方，线上行为不变。
2. **切换调用方、删除 TS**：新增 command，前端改为消费 Rust 结果，删掉 TS 计算代码与对拍脚本。
3. **基准管线迁 Rust**：采集 / 构建 / 消融 / 评测改为 Rust 离线程序，删掉 Node 脚本。依赖本子项目的 SGP 适配层。

## 范围

做：

- `src-tauri/src/match_analysis/`：中立输入结构与两个适配层（LCU / SGP）、模式判定、分路、对位事实、时间线卡片、阵亡归责、指标、评分、标签
- 移植全部相关 TS 单元测试
- 整局黄金对拍基础设施与预期差异登记表

不做：

- 新 command、前端改动、删除 TS（子项目 2）
- 基准管线（子项目 3）
- AI 提示词拼装与证据接地校验（`matchDetail/`，之后单独评估）
- 胜率模型（已在 `win_prob/`，不动）

## 移植原则：允许边移植边修，但每处修复必须登记

- 每处有意的行为改变登记为一条**预期差异**：编号、字段路径匹配规则、TS 行为、Rust 行为、原因、对应测试名
- 对拍只放行命中登记表的差异；登记表外的任何不一致都视为移植错误
- 影响总分或标签的登记项，必须附 106 条线上玩家标注的复测结果，队内口径一致率不得低于现状 51%（复测脚本见 `scratchpad/ablation/`）

## 架构

### 模块结构

按子领域拆，类型与函数同模块：

```
src-tauri/src/match_analysis/
  mod.rs              对外入口 analyze(&MatchInput) -> MatchAnalysis 与对外类型
  input.rs            MatchInput 中立结构 + 适配层：
                        from_lcu(LCU 对局, Option<SlimTimeline>, 名称表) —— app
                        from_sgp(SGP SUMMARY, Option<SlimTimeline>, 名称表) —— 子项目 3
  js.rs               复刻 JS 行为的数值辅助：js_round、js_to_fixed
  mode.rs             模式判定（TS modeContext.ts）
  position.rs         分路：SGP 真值 → 选秀槽位 → 推断（TS positionAssign.ts / positionInfer.ts / snapshot.ts 的真值部分）
  lane_facts.rs       终局对位差值、位置基准（TS laneFacts.ts）
  parity.rs           预期差异登记表（只给对拍程序与测试用）
  timeline/
    mod.rs            卡片生成、编号、数字提取、筛选（TS timeline/index.ts）
    labels.rs         方位 / 区域 / 野怪 / 建筑 / 技能槽中文（TS timeline/labels.ts）
    geometry.rs       时间格式、距离、插值位置、取帧（TS timeline/geometry.ts）
    team_context.rs   队伍上下文（TS timeline/teamContext.ts）
    lane.rs death.rs fight.rs item.rs skill.rs vision.rs turn.rs   七类卡片（TS timeline/cards/*）
  scoring/
    death_attribution.rs   阵亡归责
    metrics.rs             终局与时间线指标
    sub_scores.rs          分项分与权重（TS subScores.ts + weights.ts）
    baseline.rs            基准与阈值查询、z 归一化（TS baseline.ts / thresholds.ts / normalize.ts / data.ts）
    labels.rs              标签与减责证据
    score.rs               打分主流程（TS scorePlayers.ts / match.ts 的打分部分）
```

基准与阈值数据保持原位置 `src/data/baseline/{baseline,thresholds}.json`，Rust 用 `include_str!` 读入；子项目 3 由 Rust 管线生成时再决定是否挪位置。

### 输入 `MatchInput`

- 对局元信息：gameId、队列、gameMode、地图、时长（秒）
- 每名玩家：participantId、teamId、win、championId、英雄中文名、召唤师技能（id 与名称）、KDA、对英雄伤害、经济、补刀、视野分、对建筑 / 野怪伤害、控制时长、LCU 的 lane / role、puuid、是否本人，以及 TS 快照用到的其余终局字段（以 `snapshot.ts` 读取的字段为准逐项列入）
- 可选时间线：`SlimTimeline`（participantId 已是 LCU 口径）
- SGP 真值分路（来自 `SlimParticipant.team_position`）

**LCU 适配层**负责 TS `remapTimeline` 的工作：按 puuid 把 SGP participantId 映射为 LCU participantId（puuid 重复或缺失的不信任，映射为 0 并丢弃对应帧数据，与 TS 一致）。

**名称不查表**：英雄名、召唤师技能名由适配层从调用方传入的名称表填入，核心计算不依赖外部状态，保证测试与对拍确定性。

### 输出 `MatchAnalysis`

对应 TS 的 `MatchSnapshot` + `PlayerScore[]`：

- 玩家：分路及其来源（真值 / 槽位 / 推断）、对位差值、位置基准等快照字段
- 队伍汇总
- `timeline: Option<…>`：卡片、队伍上下文、阵亡归责、时间线指标
- `scores`：每人分项分、总分、分位带、贡献、减责证据、标签、阵亡列表

字段名与 TS 一致（serde camelCase），子项目 2 切换时前端类型可直接对应。

## 对拍

### 第 1 层：单元测试移植

TS 现有相关单测（`scoring/__tests__`、`timeline` 卡片、`positionAssign` / `positionInfer`、`laneFacts`、`modeContext` 等）逐条翻成 Rust 测试，期望值不变；仅登记过的修复点可改期望值，并在测试中注明登记编号。

### 第 2 层：整局黄金对拍

- **TS 黄金生成**：临时 vitest 脚本 `rank-analysis-app/scripts/parity/`（子项目 2 删除），对每局输入跑现有 TS 组装与评分，输出 `{ input, output }` JSON
- **语料**：

  | 语料 | 来源 | 入库 |
  |---|---|---|
  | 回归局 A、B | 现有 fixture（`scoring/__tests__/fixtures/regression-{a,b}.json`） | 是，`cargo test` 常跑 |
  | 本人最近 50 局（LCU 对局 + 时间线） | 本机现拉 | 否（含 puuid / 召唤师名） |
  | 基准语料抽 300 局（SGP 路径，只对评分部分） | `scripts/baseline/raw` | 否 |

- **Rust 比对**：`cargo run --example parity_check -- <目录>`，逐局比较 `analyze` 输出与黄金输出：数值 |差| ≤ 1e-9；字符串（卡片文字、标签、减责理由）完全一致；列表顺序一致。按字段路径汇总差异，登记表外有差异则非零退出
- **完成标准**：两层全绿；登记表每条有理由、有测试，影响分数 / 标签的有复测数据

## 已知风险与对策

| 风险 | 对策 |
|---|---|
| 取整差异：JS `Math.round(-0.5) = -0`，Rust `round` = −1；JS `toFixed` 平分向大取，Rust 按精确十进制 | `js.rs` 提供 `js_round` / `js_to_fixed`，展示文字与取整一律用它们，边界值单测 |
| 排序稳定性 | JS `sort` 稳定；Rust 一律 `sort_by`（稳定），禁止 `sort_unstable`；比较器相等时的先后与 TS 一致 |
| 浮点运算顺序 | 累加顺序、先和后均等与 TS 逐行一致 |
| 名称数据 | 适配层传入，核心不查表 |
| 体量（Rust 约 4000~5000 行 + 测试） | 分三期、每期一个 PR，按任务审查 |

## 分期

| 期 | 内容 | 对拍覆盖 |
|---|---|---|
| P1 | `input`（两个适配层）、`js`、`mode`、`position`、`lane_facts`；对拍基础设施（TS 黄金生成、`parity_check`、`parity.rs`） | 快照的玩家 / 分路 / 对位部分 |
| P2 | `timeline/` 全部 | 卡片全文、队伍上下文 |
| P3 | `scoring/` 全部 | 分数、标签、阵亡归责、时间线指标 |

每期合并后：Rust 代码与测试全绿、线上行为不变。P3 合并即子项目 1 完成。实施计划按期分别编写，P1 合并后再写 P2 的计划，以吸收前一期的经验。

## 已登记差异

经用户 2026-11-28 批准，P1 通过登记表修复以下 TS 疑似问题（TS 代码不改，子项目 2 切换调用方时随之生效）。登记表在 `src-tauri/src/match_analysis/parity.rs` 的 `EXPECTED_DIFFS`；每条可限定队列（`queues`），只放行指定队列局里的差异。

| 编号 | 字段路径 | 队列 | TS 行为 | Rust 行为 | 影响评分 | 测试 |
|---|---|---|---|---|---|---|
| P1-F1 | `modeContext.{kind,description,hasLanes,championAssignment}`、`players[*]` 与 `teams[*].players[*]` 的 `teamPosition` / `vsLaneOpponent` | 400 | 400 不在 `RANKED_QUEUE_IDS`，兜底成大乱斗：无分路、无对位差值 | 400 归入有分路排位类，分路走选秀槽位 | 是，标注复测：P3 | `mode::should_classify_400_as_ranked_with_lanes`、`snapshot::should_assign_slot_positions_for_normal_draft_400` |
| P1-F2 | `players[*].isMe`、`teams[*].players[*].isMe` | 全部 | 按显示名比较，改名 / 撞车误判 | `MatchInput.me_puuid` 与玩家 puuid 都非空时按 puuid，否则退回显示名 | 否（只影响 P3 点评名单本人置顶） | `input::should_mark_me_by_puuid_when_renamed`、`input::should_fall_back_to_display_name_when_player_puuid_missing` |
| P1-F3 | `players[*].controlWardsPlaced`、`teams[*].players[*].controlWardsPlaced` | 全部 | 读已废弃的 `sightWardsBoughtInGame`（恒 0） | 读 `visionWardsBoughtInGame`（真眼购买数） | 否（评分真眼指标取时间线） | `snapshot::should_read_control_wards_from_vision_wards_bought` |
| P1-F4 | `players[*].name`、`teams[*].players[*].name` 及两处 `vsLaneOpponent.opponentName` | 全部 | 拼 `gameName#tagLine`，缺字段出 `undefined`，缺 `player` 抛错 | `gameName#tagLine` → `gameName` → `summonerName` → `未知玩家`；缺整条身份仍为 `玩家<pid>`；本人键同规则 | 否 | `input::should_build_display_name_with_fallbacks`、`input::should_name_missing_player_and_missing_identity`、`input::should_mark_me_when_tag_line_missing` |

说明：

- **对拍中的 `me_puuid`**：黄金不含调用方参数，`check_golden` 取 TS 标 `isMe` 的玩家的 puuid 作 `me_puuid`，因此 P1-F2 只在改名 / 撞车局出差异，由单测覆盖。
- **P1-F3 依据**：回归局 A/B 共 20 人 `sightWardsBoughtInGame` 全为 0；`visionWardsBoughtInGame` 有 16 人非 0，20 人中 16 人与时间线 `ITEM_PURCHASED` itemId 2055（真眼）次数相等，不等的 4 人都是辅助位、LCU 数更大。app 的 `Game` 不带该字段，app 路径仍为 null（`Game` 不动）。
- **未修：斗魂「2v2」描述（原计划 P1-F5）**：本机 LCU `lol-game-queues/v1/queues/1700` 返回 `numPlayersPerTeam=16`、`maximumParticipantListSize=16`、`numberOfTeamsInLobby=1`，是整局人数而非小队人数，不能证明 1700 不是 2 人一队（16 = 8×2，与 2v2 相容），按约定不改。另：同一份队列表里在开的 1750（「斗魂竞技场 3x6」，18 人）走 `gameMode == CHERRY` 分支同样拿到「2v2」描述，留待后续按 queueId 区分。
