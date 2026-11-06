# 隐藏分估算 设计

日期：2026-11-06
状态：待评审

## 目标

为**当前登录的召唤师自己**估算单双排、灵活组排的隐藏分。做法是记录每局排位的 LP 加减分，再以当前段位为锚点换算出隐藏分。结果显示在战绩页的段位卡片上。

### 不做的事

- 不估算其他玩家（拿不到别人的逐局 LP 变化）。
- 不做独立页面、趋势图。
- 不引入数据库（sqlite 等）。

## 数据来源

### 主路径 B：LP 变化通知

`GET /lol-ranked/v1/current-lp-change-notification`

2026-11-06 国服实测（单双排赢局，晋级局）返回的关键字段：

| 字段 | 示例 | 用途 |
|---|---|---|
| `gameId` | 301056769722 | 和 `eog-stats-block.gameId` 对齐，用于去重 |
| `queueType` | `RANKED_SOLO_5x5` | 区分队列 |
| `leaguePointsDelta` | 19 | 本局 LP 加减分 |
| `tier` / `division` / `leaguePoints` | EMERALD / III / 5 | 变化后的段位 |
| `changeReason` | `GAME_END` | 只接受 `GAME_END` |
| `afkLpPenaltyAmount`、`wasAfkOrLeaver` | 0 / false | 不为 0 或为 true 时剔除 |
| `consolationLpUsed` | 0 | 大于 0 时剔除 |

已知问题：通知里的 `losses`（254）和 `current-ranked-stats` 里的 losses（258）对不上，**不用通知里的胜负场做任何校验**。

`eog-stats-block` 里没有 LP 字段，只用它取本局的 `gameId` 和 `queueType`。

### 兜底路径 A：段位快照差值

- 进入 `ChampSelect` 和 `InProgress` 阶段时，各记一次 `current-ranked-stats` 快照（LP、胜场、负场）；以最后一次为准。
- 进入 `EndOfGame` 后，每 3 秒同时查一次通知和 `current-ranked-stats`，最长 2 分钟。拿到 gameId 匹配的通知就用通知并停止；2 分钟内一直没有，才用快照差值。
- 只有当「胜场 + 负场」**恰好增加 1** 时才记录。delta 用分数轴上的值相减得出。

### 每条记录都要剔除的情况

- 定级赛（`isProvisional` 或 `provisionalGamesRemaining > 0`）。
- 掉段保护：输局且 delta 为 0。
- 同一 `gameId` 已经记录过。
- 不是排位队列（只接受 `RANKED_SOLO_5x5`、`RANKED_FLEX_SR`）。

## 分数轴

把段位线性展开：

- 黑铁 IV 0LP = 0；每个小段 +100；每个大段 400。依次为黑铁、青铜、白银、黄金、铂金、翡翠、钻石。
- 大师 = 2800 + LP；宗师和王者沿用同一条轴，直接加 LP，不再细分（2800 + LP）。
- 反向换算：小于 2800 的值换回「大段 + 小段 + LP」；大于等于 2800 的都显示为「大师以上 + LP」，不去猜宗师 / 王者的门槛。

示例：钻石 II 40LP = 6 × 400 + 2 × 100 + 40 = 2640。

## 估算公式

- 取该队列最近 10 条有效记录，分别算平均赢分 W 和平均输分 L（L 取绝对值）。
- 至少要有 3 条记录，且至少 1 胜 1 负；记录不足 3 条时显示「数据收集中 n/3」；够 3 条但只有赢局或只有输局时显示「数据收集中（需至少 1 胜 1 负）」。
- 偏移量 = (W − L) × k，k = 10（经验常数，做成具名常量并写注释说明来源）。
- 隐藏分 = 当前段位在轴上的值 + 偏移量，再反向换算成等效段位。
- 方向：偏移量大于 +50 显示 ↑；小于 −50 显示 ↓；否则显示「持平」。

## 存储

- 存放在 app 数据目录 `hidden_mmr/<puuid>.json`，按队列分组，每个队列最多保留最近 50 条记录。
- 每条记录包含：`gameId`、`queueType`、`delta`、`tierAfter`、`divisionAfter`、`lpAfter`、`timestamp`、`source`（`notification` / `snapshot`）。
- 写入采用「先写临时文件再 rename」，防止写到一半损坏。读取失败时视为空记录并打 warn 日志，不让整个功能报错。

## 后端模块

`src-tauri/src/hidden_mmr/`（类型和函数放在同一个模块里，按子领域拆）：

- `axis`：段位和分数轴的双向换算（纯函数）。
- `estimate`：根据记录和当前段位算出估算结果（纯函数）。
- `store`：JSON 读写。
- `collector`：订阅 gameflow 阶段变化，负责拍快照、读通知、兜底，以及剔除异常局；写入新记录后发出 `hidden-mmr-updated` 事件。

Tauri command：`get_hidden_mmr(puuid, queueType) -> HiddenMmr`

```ts
type HiddenMmr =
  | { status: 'hidden' }                          // 定级赛 / 没打过 / 非本人
  | { status: 'collecting'; reason: 'too_few' | 'one_sided'; have: number; need: 3 }
  | {
      status: 'ready'
      score: number            // 分数轴上的值
      equivalent: string       // 例如「钻石 IV 40LP」
      offset: number
      direction: 'up' | 'flat' | 'down'
      avgWin: number
      avgLoss: number
      recent: { delta: number; source: 'notification' | 'snapshot' }[]
    }
```

## 前端

- `RankCard.vue` 新增可选 prop `hiddenMmr`，在胜负场那一行下面加一行展示：
  - `ready`：显示 `隐藏分 ≈ <等效段位> · <score> <箭头>`，颜色沿用 good / normal / bad。
  - `collecting`：灰字显示 `隐藏分 数据收集中 n/3`，`one_sided` 时显示 `隐藏分 数据收集中（需至少 1 胜 1 负）`。
  - `hidden`：这一行不显示。
- 用 `n-tooltip` 展示最近的加减分列表、平均赢分和输分、偏移量；最后一行固定为「估算值，非官方 MMR」。
- `UserRecord.vue` 只在查看对象是当前登录的召唤师时才请求数据；收到 `hidden-mmr-updated` 事件后刷新。

## 测试

- Rust：
  - 分数轴双向换算，包括各段位边界和大师以上。
  - 剔除规则：AFK、安慰分、定级赛、掉段保护、重复 gameId、非排位队列。
  - 估算：记录不足、只有赢局 / 只有输局、窗口只取最近 10 条、方向阈值。
  - 收集流程：主路径命中、超时后走兜底、快照的胜负场增加数不等于 1 时丢弃。
  - store：文件损坏时按空记录处理、超过 50 条时截断。
- 前端：`RankCard` 的三种状态；查看别人时不请求数据。
- 真机：单双排、灵活组排各至少打一局，至少有一局输的；记录主路径的覆盖率，并把结果更新到记忆里。

## 风险与待验证

- 主路径目前只有一个样本（赢局）。输局、灵活组排、秒退时有没有通知，下一局开始前通知会不会一直保留，都还没验证。兜底路径就是为这些情况准备的。
- k = 10 只是经验值，不是拳头公开的算法。以后可以根据实际数据调整，界面上已经明确标为「估算」。
- 刚安装时没有历史记录，需要先打几局攒数据。
