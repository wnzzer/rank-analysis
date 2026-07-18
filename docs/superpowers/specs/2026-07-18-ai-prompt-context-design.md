# AI prompt 全面信息补全：对局中整队/单人 + 赛后单人复盘 — 设计

日期：2026-07-18
状态：已口头批准（范围 1+2+3，赛后整局不动），本文档为实现依据
前置：#116（assignedPosition 透传）、#117（多杀字段）已合并

## 审计结论

- `team.ts`（对局中整队）：无本局分路/预组队/遇见过/版本改动/敌方 OP.GG 情报，
  无反幻觉纪律区，system prompt 为弱版本。
- `team-player.ts`（对局中单人）：连本局英雄与分路都未告知模型，无版本改动与纪律区。
- 赛后单人复盘：`analyzeMatchDetailWithAIStream` 忽略 mode/participantId，
  单人 tab 实际输出整局复盘，缓存 key 不区分——功能缺口而非调优问题。

## 1. team.ts 大修

数据注入（玩家行/独立区块）：
- 本局分路：后端 `SessionSummoner.assigned_position` 在 InProgress 阶段回填
  gameflow 的 `selected_position`（选人期已有 assignedPosition；两源合一，
  大小写由前端 toUpperCase 归一）。对局中双方分路均为权威数据。
- 预组队区块：按 `preGroupMarkers.name` 分组列出双方预组队成员——开局最强情报。
- 遇见过区块：`meetGames` 摘要（次数、最近同队/对阵及胜负）。
- 版本改动区块：复用选人 prompt 的 `buildPatchNotesBlock`（抽到
  `prompts/shared/patchNotes.ts` 共用，champSelect.ts 同步改 import）。
- 敌方 OP.GG 情报区块：T 级/版本胜率/克制提示（`getChampionMeta`/`findCounterHints`，
  抽共用小助手到 `prompts/shared/opggIntel.ts`）。
- 纪律区：移植选人 prompt 硬规则并按对局中语义调整——敌我前缀、禁职能标签、
  指标名纪律、机制引用唯一例外（版本改动）、分路只认材料（双方均权威）。
- `buildTeamAnalysisPrompt` 变 async；system prompt 升级为 DEFAULT_SYSTEM_PROMPT
  （index.ts 的 analyzeGameWithAIStream 改）。

## 2. team-player.ts 补齐

- 注入：本局英雄、本局分路、该英雄本版本改动。
- 纪律区：指标名纪律、机制引用唯一例外、禁职能标签、禁编造。
- 变 async（版本改动查询）。

## 3. 赛后单人复盘补实现

- 新增 `matchDetail/prompts/stage2-player.ts`：输入同一 Stage1 归因 + snapshot +
  目标 participantId。材料含：目标玩家完整快照行（全指标+multiKills+recentProfile）、
  同 teamPosition 的对位玩家快照行（数字对比）、目标的 verdict（无则说明）、
  全员名册（敌我锚定）。模板：一句话定档 / 数据面板解读 / 对位对比 / 责任归因 /
  改进建议(2-3条)。纪律沿用 stage2 硬规则（名册照抄/禁材料外比较/语气红线）。
- `analyzeMatchDetail` 增加 `mode: 'overview'|'player'` 与 `participantId`：
  Stage1 与缓存完全共享；Stage2 按 mode 选 prompt，缓存 key 单人模式追加
  `_p{participantId}`。
- `services/ai/index.ts` 的 analyzeMatchDetailWithAIStream 停止忽略 options，
  透传 mode/participantId。
- 无对位玩家（对面同位缺失/斗魂）时对位区块写"无同位对位数据"。

## 测试

- Rust：InProgress classic `selected_position` 回填 `assigned_position` 的透传测试。
- team.spec / team-player.spec：各新区块与纪律关键词、async 化后的现有断言迁移。
- stage2-player.spec：目标行/对位行/名册/无对位降级/纪律关键词。
- index.spec（matchDetail）：player 模式走 stage2-player、缓存 key 区分、
  Stage1 缓存共享。
- 验收：真实 prompt 喂 qwen-flash/plus 各 1-2 轮人工判读（新功能 sanity，非 A/B）。

## 不做

- 赛后整局 stage1/stage2 内容改动（刚验证过，保持稳定基线）。
- player-insight 的 mainPosition 抽取质量问题（timeline.lane 噪音）——另立议题。
