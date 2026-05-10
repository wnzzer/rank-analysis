# 斗魂竞技场（多小队模式）适配 — 设计

> 状态：设计稿，待实施
> 日期：2026-05-10
> 作者：wnzzer

## 1. 背景

现有对局页 `Gaming.vue` 与详情页 `MatchDetailModal.vue` 均按 5v5 二元队伍（我方 / 敌方）设计。在斗魂竞技场（CHERRY，queueId=1700）下：

- 对局页"敌方"列空白，14 名对手不可见。
- 详情页 16 名玩家被合并成 2 团 8 人显示。
- 名次（1~8）信息丢失。

需要支持斗魂的 **8 队 × 2 人** 模式，并保持对未来类似多队模式（例如假想的 5 队 × 3 人）的兼容性。

## 2. 数据接口验证（已通过 `examples/probe_arena.rs` 实地拉取真实 JSON）

### 2.1 `lol-gameflow/v1/session`（对局页源）

| 字段 | 5v5 | CHERRY |
|---|---|---|
| `gameData.queue.gameMode` | `CLASSIC` 等 | **`CHERRY`** |
| `gameData.queue.id` | 420/430/450 | **1700** |
| `gameData.queue.numPlayersPerTeam` | 5 | **16** |
| `gameData.teamOne.length` | 5 | **16** |
| `gameData.teamTwo.length` | 5 | **0** |

CHERRY 下 LCU 把全部 16 人塞进 `teamOne`，`teamTwo` 为空。
`OnePlayer` 多了 `teamParticipantId` 字段（值 1~12+，**非连续**），同 ID 是同小队两人——**但仅作弱信号**，最终小队号以详情字段为准。

### 2.2 `lol-match-history/v1/games/{id}` 与战绩列表（详情/列表源）

每个 `participants[i].stats` 都包含：

```jsonc
{
  "playerSubteamId": 1,      // 1~8（CHERRY）；0（非 CHERRY）
  "subteamPlacement": 3       // 1~8 名次（CHERRY）；0（非 CHERRY）
}
```

`teamId` 在 CHERRY 下虽然仍是 100/200，但**与小队无关**，不可用于分组。

### 2.3 当前后端漏字段

- `src-tauri/src/lcu/api/model.rs::Stats` —— 缺 `player_subteam_id` / `subteam_placement`。
- `src-tauri/src/lcu/api/session.rs::OnePlayer` —— 缺 `team_participant_id`（可选，非关键）。

## 3. 设计目标

1. 对局页 / 详情页在 CHERRY 模式下**正确**显示 8 个小队、各 2 人，名次可见。
2. 5v5 既有体验**零回归**。
3. 数据模型与组件结构**对未来 3v3v3v3 类多队模式开放**——不再硬编码 `teamOne` / `teamTwo`。
4. 后端 / 前端类型契约**单一来源**，不出现"双轨字段"。

## 4. 数据契约：统一为多小队模型

将"两队"概念升级为"一组小队（subteams）"。5v5 即 2 个 subteam，CHERRY 即 8 个 subteam。

### 4.1 后端 Rust（`session.rs`）

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub phase: String,
    #[serde(rename = "type")]
    pub queue_type: String,
    pub type_cn: String,
    pub queue_id: i32,
    pub game_mode: String,           // 新增："CLASSIC" / "CHERRY" / ...
    pub is_multi_team: bool,         // 新增：true = 多小队模式（CHERRY 等）
    pub my_subteam_id: i32,          // 新增：当前用户所在的 subteamId（CHERRY=1~8；CLASSIC=1 即 team_one、2 即 team_two）
    pub subteams: Vec<Subteam>,      // 新增：统一表达
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subteam {
    pub subteam_id: i32,             // 1~N（CLASSIC: 1/2；CHERRY: 1~8）
    pub players: Vec<SessionSummoner>,
}
```

**为什么不保留 `team_one` / `team_two` 兼容**：保留会形成"5v5 用旧字段、CHERRY 用新字段"的双轨，AI 服务、组件 props、事件监听都得双跑分支。一次性迁到 `subteams` 模型，5v5 退化为 `subteams.length === 2`，逻辑统一。

**Stats 补字段**（`lcu/api/model.rs`）：

```rust
#[serde(rename = "playerSubteamId", default)] pub player_subteam_id: i32,
#[serde(rename = "subteamPlacement", default)] pub subteam_placement: i32,
```

### 4.2 前端 TS（`types/domain/gaming.ts` & `match.ts`）

```ts
export interface Subteam {
  subteamId: number
  players: SessionSummoner[]
}

export interface SessionData {
  phase: string
  type: string
  typeCn: string
  queueId: number
  gameMode: string
  isMultiTeam: boolean
  mySubteamId: number
  subteams: Subteam[]
}
```

`ParticipantStats` 加：

```ts
playerSubteamId: number    // CHERRY 1~8；其它 0
subteamPlacement: number   // CHERRY 1~8；其它 0
```

### 4.3 事件流变化

旧：`session-player-update-team-one` / `session-player-update-team-two`。
新：合并为单一 `session-player-update`，payload 携带 `subteamId`：

```rust
struct PlayerUpdate {
    subteam_id: i32,
    index: usize,
    total: usize,
    player: SessionSummoner,
}
```

`useSessionSync` 用 `subteamId` 找到对应 subteam 写入。

## 5. 后端处理逻辑（`command/session.rs`）

### 5.1 主流程改造

```text
拉 session →
  if gameMode == "CHERRY":
      走 CHERRY 分支（分小队）
  else:
      走 CLASSIC 分支（保持现状，最后包成 subteams[2]）
→ 推 basic-info → 并行获取每个 subteam 的玩家详情 → 推 player-update → 完成
```

### 5.2 CHERRY 分支

1. 不做 `need_swap`（teamTwo 必空）。
2. 不做位置排序（CHERRY 全是 `NONE`）。
3. 用每个玩家在**最近一场对局详情**里的 `playerSubteamId` 作为权威小队号。
   - 第一阶段（basic-info 推送时）：尚无对局详情，回退用 `teamParticipantId` 的等价类（同 ID 视为同小队），以"临时 subteamId"建组——只供占位 UI 即时渲染。
   - 第二阶段（详情拉到后）：用 `playerSubteamId` 重组，emit `session-subteams-resolved` 事件，前端按权威 ID 重排。
4. `my_subteam_id`：扫描 `subteams` 找到包含 my puuid 的小队 id。

> **Q: 为什么不用 `teamParticipantId` 直接当小队号？**
> 实测它跨小队不连续（出现 1/3/4/5/6/7/8/9/10/11/12 等），且会漏掉单人对局阶段的对手数据。`playerSubteamId` 是引擎权威字段，对应"队伍1~8"的 UI 概念，要靠它做最终落定。

### 5.3 CLASSIC 分支（无功能改动）

照旧逻辑产出 `team_one` / `team_two`，最后包装：

```rust
SessionData {
  is_multi_team: false,
  my_subteam_id: 1,
  subteams: vec![
    Subteam { subteam_id: 1, players: team_one },
    Subteam { subteam_id: 2, players: team_two },
  ],
  ...
}
```

预组队检测 `add_pre_group_markers` 改造：从遍历 `team_one` / `team_two` 改为遍历 `subteams`。CHERRY 下"同 subteam 两人"本身就是预组队，但不再用 `preGroupMarkers` 标，改用 subteam 框头自然展示——避免重复标。`add_pre_group_markers` 仅在 `is_multi_team == false` 时执行。

## 6. 前端 UI

### 6.1 对局页 `Gaming.vue`

新增组件 `<SubteamGrid>`：

```text
┌──────────── Gaming Page ─────────────────────────┐
│  CLASSIC 模式：                                  │
│    [我方 Subteam (5)]   [敌方 Subteam (5)]       │
│                                                  │
│  CHERRY 模式（4 列 × 2 行 网格）：               │
│    ┌─队伍1─┐ ┌─队伍2─┐ ┌─队伍3─┐ ┌─队伍4─┐    │
│    │ P1 P2 │ │ P3 P4 │ │ P5 P6 │ │ P7 P8 │    │
│    └───────┘ └───────┘ └───────┘ └───────┘    │
│    ┌─队伍5★┐ ┌─队伍6─┐ ┌─队伍7─┐ ┌─队伍8─┐    │
│    │ P9 P10│ │P11 P12│ │P13 P14│ │P15 P16│    │
│    └───────┘ └───────┘ └───────┘ └───────┘    │
│       ★ = 我所在的小队（绿框 + "我方"标识）    │
└──────────────────────────────────────────────────┘
```

#### 6.1.1 SubteamCard 组件

- 输入：`subteam: Subteam`、`isMine: boolean`
- 框头：`队伍 {{ subteamId }}` + 我方时加 `<n-tag type="primary">我方</n-tag>` 高亮（沿用现有 `team-label-blue` 配色）
- 框身：垂直摆 2 张 PlayerCard
- 自适应：CHERRY 下 PlayerCard 改用紧凑变体（详见 6.1.2），其它模式保持现状

#### 6.1.2 PlayerCard 紧凑变体

CHERRY 下卡片宽度变窄（约 25vw），需要：

- `right-section`（PlayerStatsCard）改为可折叠或并到底部小字
- `PlayerHistoryGrid` 缩为 2 列 × 2 行（4 局）
- 不显示"近期数据"右侧栏（KDA/胜率改用顶部 inline 标签）

新增 prop `density: 'normal' | 'compact'`，PlayerCard 内部按 density 切样式。CLASSIC 模式继续传 `normal`，CHERRY 模式传 `compact`。

### 6.2 详情页 `MatchDetailModal.vue` / `useMatchDetailPlayers.ts`

`teamSections` 计算改造：

```ts
const isCherry = computed(() => game.value?.gameMode === 'CHERRY')

const groups = computed(() => {
  if (isCherry.value) {
    // 按 playerSubteamId 分组，subteamPlacement 排序
    const map = new Map<number, DetailPlayer[]>()
    for (const p of detailPlayers.value) {
      const sid = p.stats.playerSubteamId
      if (!map.has(sid)) map.set(sid, [])
      map.get(sid)!.push(p)
    }
    return [...map.entries()]
      .map(([subteamId, players]) => ({
        groupId: subteamId,
        players,
        title: `队伍${subteamId}`,
        placement: players[0]?.stats.subteamPlacement ?? 0,
        won: players[0]?.stats.win ?? false,  // 直接复用引擎给的 win 字段，不自定义阈值
        ...
      }))
      .sort((a, b) => a.placement - b.placement)
  } else {
    // 现有 teamId 分组逻辑
    ...
  }
})
```

CHERRY 下小队头多一个名次徽标：`第 X 名 / 8`，颜色按名次区间映射（1~2 金、3~4 银、5~6 铜、7~8 灰）。

### 6.3 战绩列表卡片 `RecordCard.vue`

最低改动：CHERRY 局右侧"胜利/失败"换成"第 X 名"角标，颜色同上。

## 7. AI 分析适配（`services/ai/snapshot.ts`）

`analyzeGameWithAIStream` 当前以 `teamOne` / `teamTwo` 为模型构造 prompt。改造：

```ts
if (sessionData.isMultiTeam) {
  // 用 subteams 数组 + mySubteamId 重新组织 prompt：
  // "我方小队（队伍 X）的两名玩家、其它 7 个对手小队的玩家分组列出"
} else {
  // 旧逻辑
}
```

## 8. 边界情况

| 场景 | 处理 |
|---|---|
| 玩家中途离队（subteam 只剩 1 人） | UI 第二格显示"已离开" 占位 |
| 选英雄阶段（CHERRY 是否走 ChampSelect 待实测；本次探针在 PreEndOfGame 阶段，未触达 champ-select 端点） | 实施时先实测：若有，按 `teamParticipantId` 临时分组；若无，对局页直接走 `phase != "InProgress"` 的 loading 占位 |
| 隐藏战绩 | 已有 `isHiddenRecord` 占位逻辑保留 |
| `playerSubteamId == 0` 出现在 CHERRY 详情 | 视为数据异常，并入 `subteamId=0` "未分组" 兜底，UI 显示警告 tag，不阻塞渲染 |
| 假想未来 3v3v3v3 模式 | 数据模型不变，UI 自适应 `subteams.length` 动态网格（3 列 × 2 行 / 5 列 × 1 行） |

## 9. 测试计划

### 9.1 后端单元测试（`command/session.rs`）

- `should_build_subteams_from_classic_session`：CLASSIC session → 2 subteams，my_subteam_id 正确
- `should_build_subteams_from_cherry_session`：CHERRY session 16 人 → 按 playerSubteamId 分 8 组
- `should_handle_cherry_with_partial_subteam`：某 subteam 仅 1 人时不崩
- `should_skip_pre_group_markers_in_cherry`：CHERRY 模式不跑预组队检测

### 9.2 前端单元测试

- `useMatchDetailPlayers.spec.ts`：CHERRY game → 8 组 subteam，按 placement 升序
- `useSessionSync.spec.ts`：处理 player-update 事件按 subteamId 写入

### 9.3 手测脚本

- 真实环境跑斗魂排队 → 验证对局页选英雄阶段渲染
- 进入对局 → 验证 8 个 subteam 正确分组、自我高亮
- 对局结束 → 验证名次显示
- 切到 5v5 排位 → 验证零回归

## 10. 实施顺序（粗略）

1. 数据契约：Rust `Stats` + `SessionData` + `OnePlayer`，TS 类型同步
2. 后端 `command/session.rs` 重构（CLASSIC 分支保等价、CHERRY 新分支）
3. 前端 `useSessionSync` 适配新事件流
4. PlayerCard 紧凑变体
5. SubteamCard / SubteamGrid 组件 + Gaming.vue 接入
6. `useMatchDetailPlayers` CHERRY 分组
7. RecordCard 名次角标
8. AI snapshot 适配
9. 单测
10. 手测 + 文档（CLAUDE.md 增加 multi-team 规约）

## 11. 不在本次范围

- 斗魂海克斯天赋（augment）UI 已有的 `usesAugments` 逻辑沿用，不改动。
- 斗魂排位（queueId=1710 等）单独记分逻辑，下次迭代再做。
- 详情页"整局 AI 分析"在 CHERRY 模式下的 prompt 模板调整，下次迭代。
