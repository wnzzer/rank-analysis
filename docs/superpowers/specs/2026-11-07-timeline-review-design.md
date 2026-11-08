# 赛后复盘接入对局时间线：清洗方案 + A/B 评测 — 设计

日期：2026-11-07
状态：已口头批准（范围 = 整局锐评 + 单人复盘；评测 = 自动硬指标 + 用户盲评；架构 = 事实卡片为主、原始事件窗口作实验组）

## 背景

- 本地 LCU `lol-match-history/v1/game-timelines/{gameId}` 只有每分钟帧 + 击杀/野怪/推塔三类事件，
  无出装、加点、插眼。现有复盘 prompt 因此全面禁止"过程性描述"，`targeted` 因子恒禁用。
- 2026-11-07 实测：SGP 网关 `match-history-query/v1/products/lol/{PLATFORM}_{gameId}/DETAILS`
  （鉴权同 SUMMARY：Bearer = LCU `entitlements/v1/token` 的 accessToken）返回完整 match-v5 时间线：
  `ITEM_PURCHASED/SOLD/UNDO/DESTROYED`、`SKILL_LEVEL_UP`、`WARD_PLACED/KILL`、`LEVEL_UP`、
  `TURRET_PLATE_DESTROYED`、`CHAMPION_SPECIAL_KILL`、`DRAGON_SOUL_GIVEN`、击杀事件带
  `victimDamageDealt` 伤害明细与赏金；每分钟帧另有 `championStats`、`damageStats`。
  单双排一局 610KB，海斗（2400）一局 1.6MB；海斗无增强符文选取事件。`TIMELINE` 是非法 infoType（400）。
- 既有教训（10-25 实测）：模型做数字/排名/对位计算错误率极高，必须 TS 预计算、模型只挑选与措辞、
  validator 按快照回写。本设计沿用该原则。

## 目标与非目标

目标：让整局锐评能讲清胜负转折，让单人复盘能指出"第几分钟、在哪、因为什么"并给出挂钩具体时刻的改进建议；
不提高编造率。

非目标：段位/隐藏分估算；回放抽帧；增强符文选取时序（数据不存在）；换模型（仅作 A/B 追加组）。

## 1. 数据层（Rust）

### 拉取

- `lcu/api/sgp.rs` 新增 `fetch_game_timeline(platform_id: &str, game_id: i64) -> Result<SlimTimeline, String>`；
  `command/sgp.rs` 暴露 `get_match_timeline(platform_id, game_id)`。
- 主机取 `constant::game::get_sgp_host(platform_id)`；`platform_id` 来自 LCU `Game.platformId`，可拉跨区对局。
- 超时 8s。

### 裁剪（typed serde，未声明字段自动丢弃，目标 ≈30KB/局）

| 保留 | 丢弃 |
|---|---|
| 每分钟帧：`totalGold` `xp` `level` `minionsKilled` `jungleMinionsKilled` `position` `damageStats.totalDamageDoneToChampions` | `championStats`、其余 `damageStats` 细分、`goldPerSecond`、`timeEnemySpentControlled` |
| `CHAMPION_KILL`：`killerId` `victimId` `assistingParticipantIds` `position` `timestamp` `bounty` `shutdownBounty`；`victimDamageReceived`/`victimDamageDealt` 在 Rust 端按 `participantId` 聚合为 `{participantId, total, topSpellName}` | 逐条伤害明细原文 |
| `CHAMPION_SPECIAL_KILL` `ELITE_MONSTER_KILL` `BUILDING_KILL` `TURRET_PLATE_DESTROYED` `GAME_END` | `PAUSE_END` `OBJECTIVE_BOUNTY_PRESTART` `DRAGON_SOUL_GIVEN`（国服 teamId 恒 0）|
| `ITEM_PURCHASED` `ITEM_SOLD` `ITEM_UNDO` `SKILL_LEVEL_UP` `WARD_PLACED` `WARD_KILL` | `ITEM_DESTROYED`（合成/消耗噪声）`LEVEL_UP`（帧可推） |
| `json.participants`（participantId ↔ puuid） | `metadata` 其余字段 |

### 缓存

对局不可变：写入缓存目录 `paths::cache_subdir("timelines")/{platform}_{gameId}.json`（与图标缓存同约定），上限 300 文件，按 mtime LRU 淘汰。

### 降级

以下任一情况返回 `Err`，TS 端走无时间线路径（prompt 与现状逐字一致）：
SGP 404/超保留期、token 失效/非 2xx、未知大区、超时、反序列化失败。

### 映射

DETAILS 的 participantId 与 LCU participantId **按 puuid 对齐**，不按顺序假设。实现第一步用真机数据核对一致性；
对不上的玩家不产卡片（不中断整局）。

## 2. 事实卡片（TS，`services/ai/shared/timeline/`）

纯函数：`buildTimelineCards(slim, snapshot, itemsDict) -> Card[]`。物品字典取 LCU
`/lol-game-data/assets/v1/items.json`（不走 cdragon，国内直连过慢）。

```ts
interface TimelineCard {
  /** 类别前缀 + 序号，如 D3 / I2 / F1 */
  id: string
  kind: 'lane' | 'death' | 'item' | 'skill' | 'vision' | 'fight' | 'turn'
  /** 卡片涉及的玩家 participantId（LCU 编号） */
  subjects: number[]
  /** 事件分钟（浮点，用于排序与 mm:ss 渲染） */
  minute: number
  /** 一行中文事实，模型只能转述 */
  text: string
  /** 卡片内全部数字，并入白名单 */
  numbers: number[]
}
```

| 前缀 | 类别 | 内容 | 模式 |
|---|---|---|---|
| L | 对线 | 5/10/14 分钟对位金币/经验/补刀差；镀层数；单杀；首死时间 | `hasLanes` |
| D | 死亡 | 时间、区域、击杀者+助攻、伤害来源占比（前 2）、死前最近队友距离（近似）、死后 60s 内己方丢失的龙/先锋/虚空/塔、送出终结赏金 | 全部 |
| I | 出装 | 每件传说装成型时间（剔除被 UNDO 的购买），第一件传说装与对位（有分路）或全场首件传说装中位数（无分路）的时间差；鞋子时间；卖装 | 全部 |
| S | 加点 | 主/副升级顺序；R 是否 6/11/16 级即点 | 全部 |
| V | 视野 | 每 10 分钟插眼/排眼数、真眼数 | `hasLanes` |
| F | 团战 | 时间 20s 且距离 2500 码内的击杀聚类；时间、区域、参战者、人头交换、团后 90s 内资源；每人是否在场（帧近似） | 全部 |
| T | 转折 | 两队经济差逐分钟曲线中变化幅度最大的 2~3 个区间，关联到 F/资源事件 | 全部 |

规则：

- **区域**：召唤师峡谷坐标分区（两龙坑、两河道、四野区、三路 × 一/二/高地塔区、基地），大乱斗按桥段四分；
  分区表为常量 + 单测。
- **近似值**：凡由每分钟帧推算的（距离、是否在场）卡片文本写"约"，不进数字白名单的"精确"语义。
- **大乱斗/海斗**：无 L、V；F 为重点。
- **选卡**：整局锐评 = 全部 T + F + 每位玩家最多 2 张（按重要度：D 有后果 > I 差距大 > 其他）；
  单人复盘 = 本人全部卡片 + 全部 F（F 卡含缺席名单，对建议有用）。目标 15~30 张，额外 1.5k~3k token。

## 3. Prompt 接入与防幻觉

### 快照

`MatchSnapshot.timeline?: { cards: TimelineCard[] }`。缺省即现状。

### Stage 1（归因）

- `EvidenceMetric` 增可选 `cardId`。validator：卡片存在、`subjects` 含该玩家、`value` 与卡片数字一致；
  卡片不存在、主体不含该玩家、或 value 不在卡片数字里 → 摘除该条证据（卡片含多个数字，无法确定回写哪个）。
- `targeted` 资格由 TS 预计算：本人 D 卡中 ≥60% 为 ≥3 人参与击杀，且至少 3 次死亡。无资格时模型输出的 `targeted` 被摘除。
- `winReason` 有时间线时须引用 ≥1 张 T 或 F 卡（validator 软校验：未引用只打点不重试——重试失败会让整份复盘不可用；引用比例进 A/B 指标）。

### Stage 2（锐评 / 单人复盘）

- "禁止一切过程性描述"改为：**过程性描述必须带卡片引用 `[Dn]`**；无引用的过程描述仍视为编造。
- 单人复盘新增「关键时刻」节（3~5 条，按时间排序）；「改进建议」每条必须挂卡。
- 无时间线时 prompt 不变。

### 后处理与渲染

- 卡片 `numbers` 与 `mm:ss` 时间并入 `extractNumbers` 白名单；`stripUngroundedSentences` 照旧。
- 新增引用校验：引用不存在卡片 id 的句子整句剔除。
- 渲染：`[D3]` 变为角标，悬停显示卡片 `text`。

## 4. A/B 评测

### 实验组

| 组 | 内容 |
|---|---|
| V0 | 现状（无时间线） |
| V1 | 事实卡片 |
| V2 | V1 + 单人复盘附本人每次死亡/团战 ±30s 的精简原始事件行 |

全部 qwen-flash。V1 胜出后追加 V1′ = V1 + Stage 1 改 qwen-plus，单独衡量换模型收益。

### 语料

固定 30 局（用户本人战绩）：单双排 15（胜负各半、长短局、碾压/翻盘）、大乱斗 5、海斗 5、灵活/匹配 5。
每局 × {整局, 本人单人} × 3 组 × 2 run = 360 次调用。
LCU Game JSON + SGP DETAILS 冻结到 `scripts/ai-eval/fixtures/`，**gitignore**（含他人 ID）。

### 运行器

`scripts/ai-eval/run.ts`（tsx），直接调用仓库内真实 `buildMatchSnapshot` / `buildTimelineCards` / prompt 构建函数，
请求走 `tests/bench-ai-models.mjs` 同款 worker；输出 `results/{variant}.jsonl`（含 prompt、原始输出、过滤后输出、耗时、token）。

### 自动硬指标（`scripts/ai-eval/metrics.ts`）

| 指标 | 定义 | 门槛 |
|---|---|---|
| 编造数字率 | 过滤前输出中不在白名单的数字 / 全部数字 | V1、V2 ≤ V0 |
| 引用错误率 | 引用卡片不存在 / 主体不符 / 数字与卡片不符 的引用占比 | ≤ 2% |
| 无引用过程句 | 含过程词表（死于、团战、拿龙、被抓、第 N 分钟、mm:ss 等）且无引用的句子数 | ≤ 1 句/篇 |
| 具体度 | 每篇引用的不同卡片数；挂卡建议占比 | 观测 |
| 稳定性 | Stage 1 JSON 解析失败率；两 run 间被点名玩家与 label 的一致率 | 解析失败率 ≤ V0 |
| 成本 | P50/P90 延迟、输入 token | P50 增幅 ≤ 50% |

### 用户盲评

- 30 局中抽 12 局 × {整局, 单人} = 24 对；每对 V0 vs（V1/V2 中自动指标更优者），左右随机。
- `scripts/ai-eval/blind.ts` 生成单文件 HTML：每对选「A 更好用 / B 更好用 / 差不多」，可选标注"最有用的一句""写错的一句"；
  结果下载为 json，`metrics.ts` 合并揭盲。

### 判定

新版盲评胜率 ≥ 65%（差不多计半票）**且**硬指标全部达标 → 上线。V1 与 V2 胜率差 < 10 个百分点时选 V1（更省 token）。

## 5. 上线与验收

- 设置项「复盘使用时间线」，默认开；拉取失败自动降级，并在报告顶部提示"本局时间线不可用，已按终局数据复盘"。
- 单测：裁剪后的单双排 + 海斗各 1 局 fixture（脱敏后入库）驱动每个卡片提取器，断言具体数值；
  区域分区、UNDO 剔除、团战聚类、validator `cardId`/`targeted`、引用校验各自覆盖分支。工具函数覆盖率 ≥ 90%。
- Rust：裁剪结构反序列化测试（脱敏 fixture）、缓存 LRU 测试。
- 真机：dev 模式经 MCP bridge 抽 5 局，人工核对「关键时刻」每条与卡片原文/回放一致。

## 风险

- SGP 保留期未知：老局拉不到 → 降级路径必须完整；评测语料尽早冻结。
- DETAILS ↔ LCU participantId 映射未经多局验证 → 实现首步核对。
- 帧粒度 1 分钟：距离/在场为近似，卡片措辞与指标都按"约"处理，不作为硬结论来源。
