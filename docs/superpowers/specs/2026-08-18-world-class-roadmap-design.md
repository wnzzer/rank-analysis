# Rank Analysis 世界级路线图（超越全行业竞品）

> **本文档是 v1.7（对标 LeagueAkari，方向 A-F）之后的新阶段权威计划。**
> v1.7 已把"追平 Akari"做完（详情秒开 / 三段式战绩页 / PUGG 出装 / AI 增强 / 6 tab / SGP 升级）。
> 本计划从"追平单点竞品"升级为"超越全行业竞品 + 建立不可复制的护城河"。
>
> - 计划版本：v1.3（2026-08-18，经三轮同行评审修订，见文末 [修订记录](#16-修订记录)）
> - 目标仓库：rank-analysis（Tauri 2 + Rust + Vue 3 + TS）
> - 调研对象：Blitz.gg / Porofessor / Mobalytics / OP.GG / U.GG / League of Graphs / Facecheck / iTero AI Coach / Teamgap / Outplayed / 开源（Seraphine / PenguLoader / Joi / lcu-and-riotclient-api / Riot-Watcher / Cassiopeia / CommunityDragon）
> - **查代码一律用 codegraph，不要 grep**：
>   ```bash
>   cd rank-analysis && codegraph explore <符号名>
>   codegraph files --filter <目录>
>   codegraph status
>   ```

---

## 目录

1. [定位与总目标](#1-定位与总目标)
2. [竞品杀手级功能矩阵（调研结论）](#2-竞品杀手级功能矩阵)
3. [数据源能力盘点](#3-数据源能力盘点)
4. [护城河总论：三大不可复制支柱](#4-护城河总论)
5. [战场一：可解释表现评分引擎（超越 GPI / iTero）](#5-战场一)
6. [战场二：全阶段 AI 闭环 + 决策回测（超越单阶段竞品）](#6-战场二)
7. [战场三：长期成长资产（画像 / 习惯失误 / 成就）](#7-战场三)
8. [战场四：对局内实时层（下一动作提醒）](#8-战场四)
9. [战场五：一键导入符文 / 召唤师技能（出装后置）](#9-战场五)
10. [战场六：赛前侦查 + 玩家威胁评级](#10-战场六)
11. [数据地基：CDragon 资产 + Riot Web API + 多账号搜索](#11-数据地基)
12. [增长与运营：分享卡片 / 成就 / 数据资产沉淀](#12-增长与运营)
13. [实施里程碑与验收标准](#13-实施里程碑)
14. [风险与合规](#14-风险与合规)
15. [技术决策记录（ADR）](#15-adr)
16. [修订记录](#16-修订记录)

---

## 1. 定位与总目标

**定位升级**：从"国服 AI 复盘工具"升级为"**国服唯一的全阶段数据 + 可解释 AI 教练**"。
核心一句话：**别人赛后才知道、给黑盒分数、只覆盖国际服；我们全阶段闭环、可下钻到事件、独享国服数据。**

**总目标（按优先级）**：

| 优先级 | 目标 | 对应战场 |
|---|---|---|
| P0 | 把已有 17 分制确定性评分升级为"总分→维度→事件级证据"三级可下钻引擎 | 战场一 |
| P0 | AI 阶段化闭环打通：选人建议→对局中执行→赛后验证→自动回测 | 战场二 |
| P1 | **一键导入符文/召唤师技能（quick win 先行，获客钩子，LCU 直写；出装 P3 后置）** | 战场五 |
| P1 | 长期成长资产：习惯性失误画像 + 渐进式改错清单 + 成长曲线 | 战场三 |
| P2 | 赛前侦查 + 玩家威胁评级（对标 Porofessor Player Tags） | 战场六 |
| P2 | CDragon 静态资产本地化（零成本降 CDN 依赖） | 数据地基 |
| P3 | 对局内实时"下一动作"提醒（4a 复用现有 liveGameIntel 链路；4c 先做 1 周 POC） | 战场四 |
| P3 | Riot Web API 官方数据层（personal key M1 并行验证；production key 待原型就绪再申请） | 数据地基 |
| P3 | 增长运营：分享卡片 / 成就 / 周报（顺风局再做，明确 P3） | 增长运营 |

**不变的原则**（沿用 v1.7）：
1. 性能优先：数据先查缓存/内存，再走 IPC/网络。
2. 确定性层与 LLM 层严格分离：数据事实由 Rust 计算，LLM 只做解释叙事。
3. 数据管道复用 `ensure_*` 降级链模式，不重复造轮子。
4. 后端 Rust 承担聚合与缓存，前端只做渲染与交互。

**北极星指标（"世界级"的可验证定义）**：
- **北极星 = 周活跃复盘数**（DAU×周复盘频次）：本地客户端价值必须落到"用户每周愿意打开复盘几次"。
- **埋点定义（纯本地，不联网）**：北极星靠 schema v2 的**本地事件表**观测（`local_events`：复盘页查看次数 / 导出分享次数 / 一键导入次数，SQLite 计数），与成就/周报共用 schema v2，不产生任何网络流量。
- **质量护栏 = 回测采纳率**（采纳建议且下一局采纳建议的玩家占比）与**归因准确率**（战场一 golden test 评测集通过率，见 §5.6）。
- **竞品对照评测**：因 Blitz/Porofessor 不覆盖国服（§2 结论 1），对照分两路——① **自身历史版本对照**（同 5 局回放，比当前版 vs 上一版的提醒质量/归因命中率），默认路径必做；② **国际服对照账号**（经 SGP/Riot API 国际服账号比对竞品公开提醒），触发条件：M5 后国际服链路已通且投入 ≤ 3 天，否则明确降级为仅路径①。防止"自嗨式世界级"且不依赖国服竞品数据。

---

## 2. 竞品杀手级功能矩阵

> 基于实际抓取的官网/商店页/GitHub README 结论。标注"未抓取"= 反爬/403，未编造。

| 功能维度 | Blitz | Porofessor | Mobalytics | OP.GG | U.GG | Facecheck | iTero |
|---|---|---|---|---|---|---|---|
| AI 分析/教练 | 赛后分析（规则） | 赛后成绩单 | 赛后报告+Smart Highlights | ✗ | ✗ | 赛后拆解 | **AI Macro/Drafting Coach** |
| 表现评分系统 | Benchmarking overlay | 标签画像 | **GPI（黑盒）** | 未抓取 | ✗ | ✗ | 500+ stats（黑盒） |
| 对局内实时 overlay | **最强**（计时/大招CD/刷野/装备差） | 有 | 有（powerspike/金币到装备） | 桌面端部分 | ✗ | 有 | 选人为主 |
| 阵容/对位推荐 | P&B + 载入侦查 | 对位胜率 + 侦查 | 赛前 scouting | Counters | Counters | P&B + 侦查 | Drafting Coach |
| 一键导入符文/出装 | **有** | 有（pro builds） | 有 | 桌面端 | ✗ | 有 | 未提 |
| 成长系统（分数/曲线/成就） | ✗ | ✗ | **GPI + LP 曲线** | ✗ | ✗ | ✗ | Account Analyser |
| 玩家威胁评级/标签 | 载入侦查 | **Player Tags（心智符号）** | playstyle badges | ✗ | ✗ | **威胁评级** | Lobby Scouting |
| 社交/变现 | 账号+战绩 | Duo Finder | Profile | Leaderboard / Gigs（真人教学） | ✗ | RP 抽奖 | ✗ |

> **注**：调研对象中的 Outplayed 实为**自动录屏/高光剪辑**工具，非"分析/教练"类竞品，故不入本矩阵；其"高光切片"能力已在 Mobalytics Smart Highlights、Facecheck 高光抓取中体现为同类能力，不单独列为竞品战场。

**关键结论**：
1. **无一覆盖国服**。所有主流工具（Blitz/Mobalytics/OP.GG/Porofessor/Facecheck/iTero）都建立在 Riot 全球 API 或 Overwolf 事件引擎之上，国服（腾讯独立运营、无公开 API）是他们进不来的盲区。**这是第一护城河。**
2. **打分全是黑盒**。Mobalytics GPI、iTero 500+ stats 只给"分数/排名"，用户无法下钻"为什么"。rank-analysis 已有 17 分制确定性打分（`command/score.rs`）与 BP 可解释证据链（`bp_decision/types.rs` 的 `BpEvidence`/`BpRejected`），天然具备做"可下钻打分"的地基。**这是第二护城河。**
3. **阶段割裂、不闭环**。iTero 强在选人、Blitz 强在对局、Mobalytics 强在赛后，无人把"选人→执行→赛后→回测"串起来。**这是第三护城河的方向。**
4. **无对话式 LLM 复盘**。竞品的"AI"本质是规则/统计驱动（Blitz 无 LLM，OP.GG 的 TalkG 是论坛、Gigs 是真人教学）。rank-analysis 的"两阶段 LLM + 确定性打分"是竞品没有的产品形态。
5. **威胁排序**：OP.GG（若入局国服，品牌+数据规模碾压）> Blitz（overlay 生态）> Mobalytics（GPI 可复制）> iTero（最接近 AI 教练）> Porofessor/Facecheck（赛前侦查）> U.GG/League of Graphs（静态数据，可作引用源而非竞品）。

---

## 3. 数据源能力盘点

| 数据源 | 类型 | 需 key | 稳定性 | 能解锁的功能 |
|---|---|---|---|---|
| LCU API（lcu.kebs.dev 文档） | 社区（Riot 非官方） | 否 | 高 | 实时对局状态、自动选/ban、符文/召唤师技能写入、终局统计、库存、聊天 |
| Riot Client API（riotclient.kebs.dev） | 社区 | 否 | 中 | 登录态/地区检测（SGP 跨区辅助） |
| SGP（已接入，跨区） | 社区 | 否 | 中 | 跨区战绩/段位直查（`lcu/api/sgp.rs`） |
| PenguLoader | 社区 | 否 | 中 | 客户端进程内 UI 内嵌、免鉴权 LCU/WS（参考，非依赖） |
| Riot Web API（match-v5/league-v4/spectator-v5/summoner-v4/champion-mastery-v4） | **官方** | **是** | **高** | 跨区历史对局、精确段位/榜单、熟练度、实时观战、周免 |
| DataDragon / CDragon（raw.communitydragon.org） | 社区 | 否 | 高 | 英雄/皮肤/物品/符文/召唤师技能图标与版本数据（本地渲染，零成本） |
| OP.GG | 第三方 | 否 | 低-中（反爬） | 段位、胜率、counter、出装/符文（已接入） |
| U.GG | 第三方 | 否 | 低（反爬，403） | 同维度，备选/交叉校验 |

**Riot 官方 key 政策**（developer.riotgames.com/docs/portal 原文）：
- Development：登录即送，**每 24h 失效**。
- Personal：**20 req/1s，100 req/2min**（按 region 单独计），仅限本人/小圈子，不可公开产品。
- Production：**500 req/10s，30,000 req/10min**，需可用原型 + DevRel 审核，可再提额。
- 审核偏好"帮助玩家进步/追踪成长"，反感"替玩家解游戏/变简单"。

**结论**：稳定数据层 = LCU（实时/本机）+ Riot Web API（官方历史/权威）+ CDragon（静态资产）。OP.GG/U.GG 仅作增强层（反爬、无 SLA、端点易变），需缓存/降级/熔断。

---

## 4. 护城河总论

**三大不可复制支柱**：

1. **国服数据独占**。国外竞品依赖 Riot 全球 API 或 Overwolf，无一覆盖国服。rank-analysis 已通过 LCU + SGP + OP.GG 打通国服战绩/段位/阵容数据，这是他们进不来的结构性壁垒。
2. **可解释确定性打分 + LLM 叙事层的两层架构**。竞品打分是黑盒（GPI/iTero），纯 LLM 会幻觉。rank-analysis 用 Rust 算确定性分数（`score.rs` 17 分制 + `bp_decision` 的 evidence/rejected 可解释模式），LLM 只负责把**已确定的事实链**翻译成自然语言。这个组合需要自建引擎 + 数据积累，无法靠调 API 速成。
3. **全阶段闭环 + 本地长期记忆**。选人/对局中/赛后用同一套数据模型贯穿，并积累跨局"习惯性失误"画像，形成"建议→执行→验证→回测"数据飞轮。本地隐私 + 零服务器成本，是 Overwolf 系竞品在国服无法复制的。

> **护城河是组合，不是单一**。第 1 条（国服数据独占）是结构性优势但**非永久**——若腾讯掌盟/WeGame 或国内团队自研 AI 复盘，该优势会归零。真正不可复制的护城河是**三条叠加**：本地客户端直连 + 确定性引擎 + 长期记忆（数据越用越值钱）。此风险已在 §14 单列"腾讯官方/国内竞品入场"。

---

## 5. 战场一：可解释表现评分引擎

### 5.1 竞品现状
Mobalytics GPI、iTero 500+ stats 都是**黑盒分数**，用户无法下钻到"为什么这局 Fighting 分低"的具体事件；Blitz/Porofessor 只有标签或 benchmarks，无统一评分。

### 5.2 我们要做什么
把已有 17 分制（`command/score.rs`，9 维：KDA/胜负/伤害/承伤/治疗/补刀/经济/参团/视野）升级为**三级可下钻引擎**：
- **L1 总分**（17 分制，已有）
- **L2 维度分**（9 维 breakdown，已有）
- **L3 事件级证据**（新增）：每一维分低，定位到"具体哪几个事件导致"（如视野分低 → "12:40 未插红眼 + 15:00 小龙团前未排眼"），由 timeline 数据 + 规则引擎产出。

### 5.3 超越点
- 竞品：黑盒分数，不可解释、不可复现。
- 我们：**可复现、可解释、可下钻到事件**，且与 LLM 复盘同源（AI 只翻译 L3 证据链，从源头杜绝幻觉）。

### 5.4 护城河
自建打分引擎 + 事件归因数据积累，是工程 + 数据的复合壁垒，竞品靠调 API 无法速成；且只有国服本地客户端能拿到 timeline 级数据。

### 5.5 可执行步骤（后端归属 `src-tauri/src/score/`，前端归属 `features/record`）
1. `codegraph explore score_participants` 复核现有评分链路；确认 LCU `get_game_by_id` 是否已返回 timeline（`lcu/api/game_detail.rs`）。
2. **timeline 来源写死决策分支（M1 关键路径）**：① 首选 LCU `/lol-match-history/v1/games/{gameId}` 的 `frames`；② 不可用退 SGP match-history-query timeline；③ 再退 OP.GG 时间线；④ 全不可用则降级为"L2 + 规则推断（弱化 L3，明确标注『无 timeline，事件为推断』）"。抽取事件（击杀/防御塔/大小龙/视野得分节点）放入 `lcu/api/timeline.rs`。
3. 新增 `src-tauri/src/score/` 目录（或复用现有 `command/score.rs` 扩展），实现 `score_events`：按时间窗把 9 维分数回溯到事件（视野分→红眼/排眼节点，补刀分→漏刀率，参团→团战参团），输出 `Vec<ScoreEvent { dimension, timestamp, description, delta }>`。
4. 定义 serde 结构 `ScoreBreakdownDrilldown { total, breakdown, events }`，前端 `src/types/score.ts` 同构。
5. 前端详情页（`MatchDetailModal.vue` 或新 `ScoreDrilldown.vue`）渲染三级下钻：点总分→维度→事件时间轴，事件可跳转到对局分钟曲线（复用 `minute curve` 组件）。
6. 把 L3 事件链注入 AI 复盘 prompt（`command/ai.rs`），让 LLM 只叙事不编造（**依赖 golden test 达标，见 §5.6**）。
7. 补单元测试：事件归因至少覆盖视野/补刀/参团三类的正向与除零兜底（遵循 `CLAUDE.md` 测试规范，Rust command 80%+ 覆盖）。

### 5.6 验收标准
- 任意一局 10 人可展开三级下钻；视野分 < 满分的玩家能列出 ≥1 条具体事件证据。
- AI 复盘文本中的每一条"低分归因"都能在 L3 事件链中找到对应事实（无幻觉断言）。
- **归因正确性（负向验收，golden test）**：建立人工标注归因评测集（≥20 局，"这局视野差的原因"由人工标注），L3 事件归因的命中率 ≥ 阈值后才允许接入 AI prompt。归因规则本身是启发式，若 golden test 不达标，"LLM 不编造"的前提（归因正确）就不成立。**标注集来源（写死）**：本机历史 20 局，维护者本人标注，双周重跑，无外部标注成本。
- `cargo test` 全绿，`npm run check` 全绿。
- **验收方法**：三级下钻 = 手动场景清单（任意一局 10 人逐维下钻至事件）；无幻觉断言 = golden test 命中率；性能 = 10 人局 drilldown 渲染 p95 < 500ms（mock 数据压测）。

---

## 6. 战场二：全阶段 AI 闭环 + 决策回测

### 6.1 竞品现状
iTero 强在选人（Drafting Coach）、Blitz 强在对局 overlay、Mobalytics 强在赛后；**无人闭环**。选人建议给出后，无人验证"如果按建议会怎样"。

### 6.2 我们要做什么
用同一套数据模型贯穿四个阶段，并在赛后自动回测：
- **选人期**：已有 `useBpDecision` + 阵容最优推荐（`bp_suggest`）+ counter hover。增强：建议附"预期胜率贡献"量化。
- **对局中**：已有 `useGamingAIAnalysis` 面板。增强：接入战场四的"下一动作"。
- **赛后**：已有两阶段 LLM 复盘。增强：自动回测。
- **回测（新增，核心差异化）**：赛后做**描述性对位对比**而非因果反事实——"建议英雄 vs 实际英雄，在当前敌方对位下各自的分段历史胜率/表现分差异"。**明确不做**"替换英雄后本局胜率会变 X%"（单人替换有蝴蝶效应，静态胜率表算出的 delta 是虚假精确）。输出 `DecisionBacktest { suggestion, actual, matchup_delta, confidence, caveats }`，`confidence` 封顶且恒带 caveats（"基于分段平均，非因果推断"）。

> **回测的科学纪律**：① 反事实 delta 是描述性对比，不是因果；② 胜率基准**主链用本地历史**（该英雄+位置+分段在本机历史对局的表现），OP.GG counter 仅做增强（反爬本就有中风险）；③ **记录"采纳→结果"对账数据**（采纳 vs 未采纳各记），防幸存者偏差——不能只记采纳后赢的局。

### 6.3 超越点
竞品 draft coach 不闭环、无法自证有效性。我们"建议→执行→验证→修正"形成数据飞轮，每局都在喂养下一局的建议。

### 6.4 护城河
需要选人、对局、赛后三段数据对齐 + 确定性打分引擎 + 长期账号数据，是后发者时间成本极高的复合能力。

### 6.5 可执行步骤（后端归属 `src-tauri/src/backtest/`，前端归属 `features/record`）
1. `codegraph explore bp_suggest` 与 `codegraph explore bp_decision` 复核选人建议输出结构；在 `bp_decision/types.rs` 增加 `BpEvidence` 之外的对位字段（如 `matchup_delta`，**禁用 `win_rate_delta` 这类"胜率变化"反事实口径**，与 ADR-6 对齐）。
2. 新增 `src-tauri/src/backtest/mod.rs`（非 `command/`）：输入本局 10 人阵容 + 赛前建议 + 本局实际结果，用 `score.rs` + **本地历史**（主链）+ OP.GG counter（增强）计算**描述性对位差异** `matchup_delta`，非反事实胜率。
3. 定义 `BacktestResult { suggestion, actual_lineup, matchup_delta, confidence, caveats }`，`confidence` 封顶且 `caveats` 恒非空（"基于分段平均，非因果"）——封顶值经校准实验确定（初始 0.4 占位，非拍脑袋定案；**校准方法写死：取本机历史 50 局，验证同一英雄-对位组合的对位差异跨时间窗的稳定性/重测信度，按分布分档映射 confidence——校准目标是"对位差异自洽性"，禁止用"与真实胜负的相关性"，后者会滑回因果推断，违反 ADR-6**）；前端 `src/types/backtest.ts` 同构。
4. 赛后 AI 复盘新增"决策回测"区块，话术用"对位历史差异"而非"胜率变化"。用户可选"采纳该建议到下一局"（写入本地建议缓存）。
5. 建立建议缓存 + **对账 ledger**（`src-tauri/src/backtest/store.rs`）：跨局记录 `{ suggestion, adopted: bool, result: match }`，同时记采纳与未采纳，防幸存者偏差；形成个人决策画像。**赛前建议 ↔ 赛后对局的关联键（写死）**：`gameId + 建议生成时间戳 + 英雄`——这是 M2 数据飞轮的前提，键缺失则跳过回测并标"建议未对齐"。
6. 补单元测试：回测在 0 数据/缺本地历史/缺 counter 时降级为"数据不足"而非编造（**阈值写死：本地对位样本 <5 局 或 双方对位样本 <3 局 → "数据不足"**）；对账 ledger 的采纳/未采纳两条路径都覆盖。

### 6.6 验收标准
- 赛前有建议的对局，赛后能看到回测结果（**对位历史差异 + 封顶置信度 + 恒带 caveats** + 数据不足的诚实降级）。
- 回测结果可沉淀到个人决策画像，下一局选人建议引用上局回测；**对账 ledger 能区分"采纳 vs 未采纳"的结果分布**，不存在只记成功案例的偏差。
- **验收方法**：单元测试（0 数据 / 样本不足降级 + ledger 双路径）；校准实验（50 局对位差异稳定性分档）；手动场景清单（赛前有建议 → 赛后回测 → 关联键命中对账）。

---

## 7. 战场三：长期成长资产

### 7.1 竞品现状
Mobalytics 的 GPI + LP 曲线是留存之王；iTero 的 Account Analyser 追踪 500+ stats。但它们**无跨局"习惯性失误"识别**——不知道你"连续 5 局都在 15 分钟前后掉视野"。

### 7.2 我们要做什么
- **习惯性失误档案**：用本地长期记忆（已有 `meet_db`/SQLite + 玩家画像）累积 N 局，自动识别重复性失误（每局 15min 掉视野 / 漏刀率高于分段均值 / 盲目入侵野区），生成"习惯标签"。
- **渐进式改错清单**：生成可勾选、可追踪的目标（"本周目标：排眼数 +X / 15min 前视野分 ≥ 分段均值"），并逐局追踪进度。
- **成长曲线**：已有 `growth report` + `minute curve`，整合为"表现分随时间/英雄/位置的成长轨迹"。

### 7.3 超越点
iTero 的 playstyle 画像只服务于选人；我们把它做成"可勾选、可追踪的改错闭环"，用户能看到自己在变强。

### 7.4 护城河
本地长期数据沉淀，后发者时间成本高；且成长资产是留存核心，形成"数据越用越值钱"的复利。

### 7.5 可执行步骤（后端归属 `src-tauri/src/insight/`，前端归属 `features/record` 或新增 `features/growth`）
1. **先做 storage schema v2 设计（任务而非"确认"）**：`codegraph explore meet` 与 `codegraph explore user_tag` 复核现有 SQLite 表；设计统一扩展点承载跨局序列（习惯画像 / 决策缓存 / 成就 / 周报），避免各建各表。产出 `docs/superpowers/specs/<date>-storage-schema-v2-design.md`。
2. 新增 `src-tauri/src/insight/mod.rs`（非 `command/`）：按 puuid + 英雄 + 位置聚合近 N 局 L2 维度分，识别"低于分段均值且持续出现的维度"。
3. 新增习惯标签模型 `HabitTag { dimension, avg_vs_peer, streak, first_seen, last_seen }`，写入 schema v2 画像存储。
4. 前端 `features/growth`：展示习惯标签、改错清单（含勾选与进度）、表现分成长曲线。
5. 改错清单绑定战场二回测：每局赛后更新目标进度，下一局选人/对局中提醒优先引用当前目标。
6. 补单元测试：聚合在 0 局/无基准数据时降级为空，不产出虚假习惯标签。

### 7.6 验收标准
- 累计 ≥5 局后能生成至少一个可验证的习惯标签（带 streak 与近因）。
- 改错清单可勾选、进度可跨局追踪；成长曲线随新对局更新。

---

## 8. 战场四：对局内实时层（下一动作提醒）

### 8.1 竞品现状
Blitz/Porofessor/Facecheck 的对局内 overlay 是**技术壁垒**（需接游戏事件流，靠 Overwolf SDK）；但它们的提醒是**规则/meta 模板**（计时器、counter、builds），不是"结合你当前对局状态的个性化实时建议"。

### 8.2 我们要做什么（分阶段）
- **阶段 4a（本机可做）**：基于 LCU 实时数据 + SGP live 数据，做"下一动作"提醒——下一件装备、回城时机、资源刷新前 30s 站位提醒。**reason 首版全模板化**（确定性数据 + 模板文案，满足 < 2s），LLM 文案只在赛后/非实时场景做；**事件源首版用轮询 diff（2s 间隔）**满足验收，真事件流后置。
- **阶段 4b（overlay 呈现）**：浮动窗口/副屏展示。Tauri 做 overlay 需评估（国服无 Overwolf，需自研透明置顶窗口 + 低开销）。
- **阶段 4c（游戏事件流）**：探索国服游戏内事件接入（WeGame 或本地进程事件），风险最高，后置。

### 8.3 超越点
竞品 overlay 只有计时器和 meta 建议；我们做"结合当前对局"的下一动作（基础版），进阶"结合个人习惯标签"（增强版，依赖 M3），且有因果解释（呼应战场一的可解释性）。

### 8.4 护城河
本地 Rust 直连 LCU 事件流 + 低延迟 + 个性化，Overwolf 系竞品在国服无法落地。

### 8.5 可执行步骤（先做 4a；后端归属 `src-tauri/src/live/`，前端归属 `features/gaming`）

**已有可复用模块**（M3 后）：

| 模块 | 可复用内容 | 本次复用方式 |
|------|-----------|-------------|
| `game_state_monitor`（已订阅 gameflow/champ-select） | 实时推送 `GamePhase` 变更（ChampSelect / InProgress / PreEndOfGame / EndOfGame） | 4a 的 NextAction 引擎按 phase 切换行为，无需额外订阅 |
| `lcu/api/champion_select.rs` | 已解 session 结构（`SelectSession` / `Action` / `OnePlayer`） | 4a 需要知道当前英雄/队伍/分路，直接读 session 快照 |
| `lcu/api/live_game.rs` | `LiveGameSnapshot`（`all_players` 含 `gold` / `level` / `items` / `champion`） | 4a 的基础输入（金币差/等级差/当前装备），轮询 diff 2s |
| `insight/mod.rs` | `aggregate_habit_tags` 习惯标签 | 4a 增强版 reason 追加"连续 N 局漏视野"等模板拼接 |
| `rune_import.rs` | `most_common_perk_page` / `most_common_spells` 聚合模式 | 4a 可引用"为何推荐此装备/符文"（复用同一数据源） |
| 前端 `liveGameIntel.ts` | `goldGap` / `buildMatch` / `teamfightClusters` / `liveIntelText` | 4a 前端推送卡片直接复用既有聚合结果 |

1. **先复用现有链路，不重造地基**：`codegraph explore live_game`（`lcu/api/live_game.rs` 已存在）、`codegraph explore game_state_monitor`（已订阅 gameflow/champ-select）；前端 `features/gaming/services/liveGameIntel.ts` 已有确定性聚合（`goldGap` / `buildMatch` / `teamfightClusters` / `liveIntelText`），直接复用为事实来源。
2. 新增 `src-tauri/src/live/mod.rs`（非 `command/`）：加 **NextAction 推荐引擎**——**基础版仅依赖快照 + PUGG 出装，不依赖习惯标签**（M1 后即可）；产出 `NextAction { kind, champion_id, item_id, reason, urgency, valid_until }`，**reason 首版全模板化**（确定性数据 + 模板文案，满足 < 2s），LLM 文案后置到赛后场景。
3. 前端 `features/gaming` 对局中面板接入 NextAction 推送（节流：30s 一次 + 关键事件触发）；**事件源首版用轮询 diff（2s 间隔）**满足验收，真事件流后置。
4. （**增强版，M3 后**）NextAction 引入个人习惯标签（§7），reason 追加"结合你连续 N 局漏视野"这类个性化（仍走模板拼接，不实时调 LLM）。
5. 4b 阶段评估透明置顶窗口方案（`tao`/`wry` 能力），若可行新增 `overlay` 窗口。
6. 4c 阶段：**1 周时间盒 POC** 验证国服游戏内事件流可行性（WeGame 或本地进程事件），产出 go/no-go 结论；未过即砍，不无限投入，不阻塞 4a/4b。

### 8.6 验收标准（4a 基础版）
- 对局中能按关键节点推送"下一动作"（含 reason 与 valid_until），延迟 < 2s（reason 模板化 + 2s 轮询 diff 满足）。
- 数据不足时降级为"无建议"而非编造。
- 个性化增强版（M3 后）：reason 引用个人习惯标签，且仍保持 < 2s（模板拼接，不实时调 LLM）。
- **验收方法**：延迟 = mock 快照压测 p95 < 2s；推送正确性 = 手动场景清单（资源刷新前 30s / 回城时机 / 关键事件）；降级 = 空快照单测断言"无建议"。

---

## 9. 战场五：一键导入符文 / 召唤师技能（出装后置）

### 9.1 竞品现状
Blitz/Porofessor/Facecheck 的"一键导入"是最强获客钩子；实现需打通 Riot 客户端/LCU。

### 9.2 我们要做什么
- 已有 PUGG 出装 + OP.GG 符文数据。用 LCU 直写，**首版范围 = 符文 + 召唤师技能（出装 P3 后置）**：
  - **符文**：`/lol-perks/v1/pages`（创建/修改符文页并设为当前）
  - **召唤师技能**：champ-select 阶段 `/lol-champ-select/v1/session` 的 spell 选择
  - **出装（P3 后置，技术验证项）**：LCU 出装集端点为 `/lol-item-sets/v1/item-sets`（国服可用性待验证，验证通过才做，不写进 P1 验收）
- "导入当前 meta 符文"按钮，一键写入客户端。

### 9.3 超越点
竞品基于 Overwolf/全球 API；我们基于国服 LCU 直写，零延迟、无需第三方。

### 9.4 护城河
获客钩子（拉新）+ 国服 LCU 直写（竞品进不来）。

### 9.5 可执行步骤（已实现于 M3；后端 `lcu/api/perks.rs` + `rune_import.rs` + `command/import.rs`，前端 `features/gaming`）

> **实现状态**：M3 Wave 1 已完成。符文页数据源从 OP.GG 改为本地 `collected_games` 聚合（见 §17.4 关键偏离），出装后置 P3。

1. `codegraph explore perks` 复核 `lcu/api/perks.rs` 现状；`codegraph explore automation` 复核自动选/ban 已有写入能力。
2. 扩展 `lcu/api/perks.rs`：读当前符文页列表 + 创建/覆盖符文页 + 设默认（**低风险**，客户端自带能力）。
3. 新增 `command/import.rs`（数据管道）：`most_common_perk_page` 从 `collected_games` 的 `game_detail.participants[].perks` 聚合本机该英雄最近 20 局最流行完整符文页 → LCU 写入（页名 `RA-{championId}`）；`most_common_spells` 聚合召唤师技能对 → champ-select PATCH。
4. 前端出装/符文推荐卡加"一键导入"按钮（复用 `ChampionIntelCard` / PUGG 展示位）。
5. 补单元测试：符文页序列化与写入参数正确性（可 mock LCU 响应）。

### 9.6 验收标准（首版 = 符文 + 召唤师技能，出装不纳入本里程碑）
- 选人/英雄详情可一键导入符文（创建或覆盖符文页），客户端立即可见。
- 召唤师技能在 champ-select 可一键选择。
- 出装导入**不纳入本里程碑验收**（`/lol-item-sets` 国服可用性待验证，见 §9.2）。

---

## 10. 战场六：赛前侦查 + 玩家威胁评级

### 10.1 竞品现状
Porofessor 的 Player Tags 是心智符号（识别"对面谁是软肋/大腿"）；Facecheck 主打威胁评级；iTero 做 Lobby Scouting（对线侵略性、中后期偏好）。

### 10.2 我们要做什么
- 已有 notes/tags + AI 标签建议 + 玩家画像（`command/user_tag.rs`）。强化为**赛前威胁评级**：
  - 载入/选人阶段对双方 10 人给出威胁等级 + 强弱项标签 + 对线侵略性/玩法风格。
  - 数据源：本机战绩 + SGP + 玩家画像。

### 10.3 超越点
竞品基于全球聚合数据；我们基于国服 + 本地长期记忆（你遇到过这个玩家、他什么风格），个性化更强。

### 10.4 护城河
国服数据 + 本地相遇记录（"你和他打过 N 局"）是竞品没有的维度。

### 10.5 可执行步骤（后端归属 `src-tauri/src/scouting/`，前端归属 `features/gaming`）

**已有可复用模块**（M3 后）：

| 模块 | 可复用内容 | 本次复用方式 |
|------|-----------|-------------|
| `backtest/samples.rs` | `normalize_position`（分路归一化）、`my_participant` 身份匹配模式 | 聚合玩家分路风格时复用同一口径 |
| `insight/mod.rs` | `aggregate_habit_tags` 的跨局聚合 + dim_value 维度提取模式 | 威胁评级同样沿用"本机视野 vs 对方聚合"的差值计算 |
| `meet_db` | `all_collected_games()` 全量收集 + `query_summary` 相遇统计 | 直接查"本机与对方相遇局数/对位结果" |
| `user_tag` | 存量标签体系（`get_user_tag_by_name` / `get_user_tag_by_puuid`） | 威胁评级卡片复用已有标签展示组件 |
| `command/score.rs` | `score_participants` 17 分制确定性评分 | 威胁评级中"对方近期表现分"维度 |
| `opgg` | `get_lane_counters` / `get_champion_meta` | 对方英雄胜率/对位数据作为辅助维度 |

**威胁评级数据模型**：

```rust
/// 赛前单名玩家威胁评级（与 Rust 结构对齐，serde camelCase）
struct ThreatRating {
    threat_level: ThreatLevel,  // Low / Medium / High / Critical
    style_tags: Vec<String>,    // "侵略性强" / "稳健发育" / "团战核心" / "单带偏好"
    encounter_count: u32,       // 本机与对方相遇局数
    lane_aggression: f64,       // 对线侵略性（对位击杀/换血频率 vs 分段均值）
    recent_performance: f64,    // 近 20 局表现分均值
    main_champion_win_rate: Option<f64>,  // 常用英雄胜率
    caveats: Vec<String>,       // 数据不足时恒带说明
}
```

1. `codegraph explore user_tag` 复核标签存储；确认 `meet_db::query_summary` 是否已记录相遇局数/对位结果（`meet_matches` 表含 `is_my_team` / `win` / `kills/deaths/assists`，可直接统计）。
2. `codegraph explore meet_db` 确认 `all_collected_games()` 是否可跨 puuid 聚合（当前按 `(region, name)` 分组，需扩展为按 puuid 聚合对位数据）。
3. 新增 `src-tauri/src/scouting/mod.rs`（非 `command/`）：
   - **主聚合函数** `assess_team_threats(my_puuid: &str, enemy_puuids: &[String]) -> Vec<ThreatRating>`：遍历 `all_collected_games()` 提取每个敌方玩家的跨局表现（近 20 局表现分均值、对线风格、常用英雄胜率），融合 `meet_db` 相遇记录（相遇局数 + 对位结果）。
   - **风格标签引擎**：基于 `dim_value` 跨局聚合（复用 `insight` 的维度提取模式），产出 style_tags（侵略性 / 稳健 / 团战 / 单带）。
   - **降级纪律**：单个玩家数据不足 5 局 → `threat_level = Low` 且 `caveats` 标注"数据不足"；无相遇记录 → `encounter_count = 0` 且 `caveats` 标注"未交手"。
4. 新增 `command/scouting.rs`：`get_threat_ratings(session_id)` 从当前 champ-select/gameflow session 取 10 人 puuid 列表，调用聚合引擎，返回 `Vec<ThreatRating>`。
5. 前端选人/载入界面展示威胁评级（复用 `PlayerCard` / `CounterHover` 的展示模式，新增 `ThreatBadge` 组件）。
6. 补单元测试：无历史数据的玩家降级为 `Low` + caveats；相遇局数统计正确；风格标签产出在 ≥5 局后有效。

**与 M3 习惯标签的差异**：习惯标签是"本机 vs 同局 peer"（自我诊断），威胁评级是"对方 vs 本机历史"（敌情侦查）——两者复用同一聚合引擎但方向相反。

### 10.6 验收标准
- 选人/载入阶段展示双方 10 人威胁评级 + 风格标签，有相遇记录的玩家显示"交手 N 局"。

---

## 11. 数据地基：CDragon 资产 + Riot Web API + 多账号搜索

### 11.1 竞品现状 / 价值
- CDragon 是零成本静态资产源（英雄/皮肤/符文/召唤师技能/物品图标 + 版本数据），可替代 DataDragon。
- Riot Web API 是唯一合规官方数据通道，production key 本身是壁垒。
- OP.GG 多账号搜索是高频拉新场景。

### 11.2 可执行步骤（后端归属 `src-tauri/src/riot/`、`command/asset.rs` 扩展，前端归属 `features/record`）
1. `codegraph explore asset` 复核 `lcu/api/asset.rs` / `command/asset.rs` 现状；确认图标来源是否依赖外部 CDN。
2. 扩展 `command/asset.rs`（或 `fandom`）：CDragon 资产缓存（`raw.communitydragon.org/latest/...`，固定 patch 版本），本地渲染英雄/物品/符文图标，降级链 内存→磁盘→HTTP。
3. 新增 `src-tauri/src/riot/mod.rs`（非 `command/`）：封装 Riot Web API（`X-Riot-Token`，match-v5/league-v4/spectator-v5/summoner-v4/champion-mastery-v4），自建**可配置令牌桶限流器**（默认 personal 配额 20/1s、100/2min，切 production 500/10s 仅改配置，不硬编码）+ 429 Retry-After 处理；个人 key 存本地配置（`config.rs`），不落库不上传。
4. 新增 `command/match_history.rs` 扩展：多账号搜索/对比（复用 SGP 跨区 + Riot API）。
5. spectator-v5 接入观战数据，为战场四 4c 做铺垫。

> **Riot key 时间线（纠正"串行等 M5"）**：personal key **M1 就并行申请并跑通 match-v5 验证**（登录即得，零门槛）；production key **无法在原型就绪前提交**（Riot 政策要求"可运行成品原型 + DevRel 审核"），故 M1 只做定位材料准备，提交在原型可演示后触发。

### 11.3 验收标准
- CDragon 资产本地化后，图标离线可用（断网仍能渲染）。
- Riot key 配置后能查国际服 match-v5/league-v4；限流器按 Retry-After 退避。
- 多账号搜索返回多玩家对比结果。

---

## 12. 增长与运营：分享卡片 / 成就 / 数据资产沉淀

### 12.1 竞品现状
OP.GG 靠 Leaderboard 沉淀；Facecheck 靠 RP 抽奖裂变；Mobalytics 靠 GPI 留存。

### 12.2 我们要做什么
- **分享卡片**：一局复盘/成长曲线一键生成图片（战绩 + AI 结论 + 评分），用于社交传播。
- **成就/等级系统**：把"改错清单完成度/表现分提升/复盘次数"转化为本地成就与等级，形成"数据资产沉淀"。
- **轻量运营**：周报（本周表现分/改错进度/习惯标签变化），本地生成推送。

### 12.3 可执行步骤（**明确 P3 顺风局再做**；后端归属 `src-tauri/src/achievement/`，前端归属 `features/growth`）
1. 前端新增分享卡片生成（`html2canvas` 或后端渲染），导出 PNG。
2. 新增 `src-tauri/src/achievement/mod.rs`：本地成就规则引擎（阈值 + 事件），复用 schema v2 SQLite。
3. 新增周报聚合（`src-tauri/src/insight/` 扩展），本地生成。

### 12.4 验收标准
- 可导出复盘/成长分享卡片 PNG；成就随行为解锁；周报可查看。

---

## 13. 实施里程碑

| 里程碑 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| M1（P0） | 战场一 L3 事件级下钻 + golden test 归因评测集 + 战场二回测骨架（**主路径**）；Riot personal key 并行验证 + storage schema v2 设计（**并行支线，不阻塞主路径验收**） | 已有 score.rs/bp_decision | 三级下钻 + 回测对位差异 + 归因命中率达标 + personal key 跑通 match-v5 |
| M2（P0） | 战场二全阶段闭环打通（含对账 ledger） | M1 | 建议→回测→采纳/未采纳对账数据飞轮 |
| M3（P1） | **战场五一键导入（quick win 先行）** + 战场三成长资产 | 符文端点技术验证 + schema v2 | 一键符文 + 习惯标签 |
| M4（P2） | 战场六赛前威胁评级 + 数据地基 CDragon | 用户标签 + meet_db + insight 聚合模式 | 威胁评级 + 离线图标；前端 vitest 全量（1365→1375+）、Rust 测试 529→535+、lint 0 errors |
| M5a（P3） | 战场四 4a 下一动作**基础版**（复用 liveGameIntel + game_state_monitor 已订阅 gameflow + champion_select.rs 已解 session 结构，reason 模板化，轮询 diff） | M1 | 实时提醒延迟 < 2s |
| M5a′（P3） | 战场四 4a **个性化增强**（引入习惯标签，reason 追加"连续 N 局漏视野"等模板拼接） | M3 | reason 引用个人历史，仍 < 2s（模板拼接） |
| M5b（P3） | 战场四 4b overlay 窗口评估（纯 UI 技术验证，与 4a 数据层无关，M1 后即可并行评估） | M1 后并行，独立 | go/no-go 结论 |
| M5c（P3） | Riot production key 申请 + 增长运营（分享/成就/周报） | 原型可演示 | production key 提交 + 分享卡片 PNG |
| M5d（P3） | 战场四 4c 游戏事件流 **1 周 POC** | 独立 | go/no-go，未过即砍 |

**每里程碑收口 `npm run check` + `cargo test` 全绿，遵循 `.claude/skills/shipping-changes/SKILL.md` 提交。**
**北极星观测点**：M1 后本地事件埋点表（schema v2）上线并记录基线；M3 后基线对比（一键导入数 / 复盘数）；M5 后产出首版竞品对照表。

---

## 14. 风险与合规

| 风险 | 等级 | 缓解 |
|---|---|---|
| LCU 是 Riot 非官方接口，改版会变 | 中 | 用 lcu.kebs.dev 自动生成文档对齐；集中封装在 `lcu/`，改动只影响一处 |
| OP.GG/U.GG 反爬、端点易变、可能封 IP | 中 | 仅作增强层；缓存 + 降级 + 熔断；不依赖为主链 |
| Riot Web API key 合规（公开产品需 production key） | 中 | personal key M1 并行验证；公开分发前申请 production key，定位"帮助玩家进步/追踪成长" |
| **符文页直写（`/lol-perks`）** | **低** | 客户端自带能力，非脚本操作；风险主要是接口变/无效，非封号 |
| **champ-select 脚本操作（自动选/ban）** | **高** | 触碰国服 ACE 反作弊，封号是用户最怕的；`automation.rs` 维持"辅助非托管"定位，默认关闭、明确风险提示、避免"替玩家解游戏"话术 |
| 对局内 overlay/事件流（战场四 4c）技术风险高 | 高 | 4a 本机数据先行；4c 用 1 周 POC 决定去留 |
| **腾讯官方/国内竞品入场（掌盟/WeGame/国内团队自研 AI 复盘）** | **高** | 护城河必须靠三支柱组合（本地直连 + 确定性引擎 + 长期记忆），不押注单一国服数据优势 |
| 国服无官方 API，数据可持续性 | 中 | LCU + SGP + OP.GG 多源冗余；知识库/数据降级链保证可用 |
| **LLM 成本（对话式复盘云 API）** | 中 | 沿用 v1.7 既定的 DashScope/qwen-flash 流式方案；新增功能需单列模型选型 + 成本段，避免按 token 计费在复盘/回测场景失控 |
| **分享卡片隐私（P3 导出 PNG 含战绩/ID）** | 低 | 分享卡片默认打码召唤师 ID（可开关）；纯本地生成，不落盘上传 |

---

## 15. 技术决策记录（ADR）

- **ADR-1（确定性/LLM 分离）**：数据事实由 Rust 确定性计算，LLM 仅做叙事层，从源头杜绝幻觉（延续 `score.rs` 既有纪律）。
- **ADR-2（数据源分层）**：LCU（实时/本机）+ Riot Web API（官方/权威）+ CDragon（静态/零成本）为主链；OP.GG/U.GG 仅增强层，一律走缓存 + 降级 + 熔断。
- **ADR-3（评分可下钻）**：确定性评分必须支持"总分→维度→事件"三级下钻，作为 AI 复盘的唯一事实来源。
- **ADR-4（本地长期记忆）**：成长资产/习惯画像/成就全本地存储（SQLite），不依赖服务器，隐私 + 零成本，同时是竞品难复制的数据沉淀壁垒。
- **ADR-5（阶段化推进）**：对局内实时层按 4a→4b→4c 分阶段，先本机可做，overlay/事件流高风险后置（4c 用 1 周 POC 决定去留），避免阻塞 P0/P1。
- **ADR-6（回测只做描述性对比，不做因果推断）**：回测输出"对位历史差异"而非"反事实胜率变化"，`confidence` 封顶且恒带 caveats（基于分段平均，非因果）；胜率基准主链用本地历史，OP.GG 仅增强；记录采纳/未采纳对账 ledger 防幸存者偏差。
- **ADR-7（归因正确性是"不编造"的前提）**：L3 事件归因须经人工标注 golden test（≥20 局）验证命中率达标后才接入 AI prompt，否则"LLM 不编造"不成立。
- **ADR-8（storage schema v2 统一扩展点）**：习惯画像 / 决策缓存 / 成就 / 周报统一走 schema v2 设计与迁移策略，不各建各表。
- **ADR-9（执行确定性：降级链 + 实时层）**：timeline 来源四级降级（LCU → SGP → OP.GG → L2 规则推断）写死，L3 断粮有兜底；4a reason 首版全模板化 + 事件源轮询 diff（2s），LLM 文案只在赛后；Riot 限流器用可配置令牌桶，不硬编码配额；北极星埋点纯本地（`local_events` 表），零网络流量。

---

## 16. 修订记录

- **v1.1（2026-08-18）**：依据同行评审修订。① 回测从"反事实胜率变化"重构为"描述性对位对比"（ADR-6），加置信度封顶 + 本地历史主链 + 采纳/未采纳对账 ledger 防幸存者偏差；② 里程碑拆分 M5a/M5b/M5c/M5d，Riot personal key 前移 M1 并行（production key 因政策需原型就绪后提交）；③ 战场五一键导入提为 quick win 先行，并加符文端点国服可用性技术验证；④ 4a 改为复用现有 `liveGameIntel.ts` + `lcu/api/live_game.rs`（不再重造地基），4c 加 1 周 POC 时间盒；⑤ 各战场补齐前后端归属模块（`score/`、`backtest/`、`insight/`、`live/`、`scouting/`、`riot/`、`achievement/`）+ storage schema v2 设计任务；⑥ 风险分级拆分符文直写（低）与 champ-select 脚本（高，ACE）；⑦ 补北极星指标 + golden test 归因评测集 + 竞品对照评测；⑧ 修正两处内部不一致（Outplayed 未入矩阵、增长运营未入优先级表，均补齐）；⑨ 补腾讯官方/国内竞品入场、LLM 成本风险行。

- **v1.2（2026-08-18）**：依据第二轮同行评审修订（ADR-9）。① 竞品对照评测改两路——自身历史版本对照 + 国际服对照账号（因竞品不覆盖国服，原"同 5 局比 Blitz/Porofessor"不可执行）；② 4a 拆"基础版（依赖 M1，reason 模板化 + 轮询 diff）/ 个性化增强版（依赖 M3）"，修 M5a 依赖错误；③ 修 §6.5 残留反事实口径 `win_rate_delta` → `matchup_delta`；④ timeline 来源写死四级降级决策分支（LCU → SGP → OP.GG → L2 规则推断）；⑤ Riot 限流器改可配置令牌桶（不硬编码 personal 配额）；⑥ 4a 延迟矛盾修复：reason 首版全模板化、事件源轮询 diff，LLM 文案后置赛后；⑦ 北极星补纯本地埋点定义（`local_events` 表）+ 每里程碑观测点；⑧ 出装导入对齐：首版只做符文+召唤师技能，出装 `/lol-item-sets` 标注技术验证项并后置 P3，修验收死角。

- **v1.3（2026-08-18）**：依据第三轮同行评审修订（执行可验证性）。① 各战场验收补"验收方法"（单元测试 / golden test / 手动场景清单 / p95 压测），golden test 标注集来源写死（本机历史 20 局、维护者本人标注、双周重跑）；② §5.5.6 注入 AI prompt 标注依赖 golden test 达标（修与 ADR-7 的时序歧义）；③ 回测补"数据不足"阈值（本地对位样本 <5 或双方 <3）+ 置信度校准方法（历史 50 局对位差异稳定性/重测信度，禁用"与胜负相关性"以免滑回因果）；④ §6.5.5 补"赛前建议 ↔ 赛后对局"关联键（`gameId + 时间戳 + 英雄`），缺键则标"建议未对齐"跳过回测；⑤ M5b overlay 评估改"与 4a 无关、M1 后并行"；⑥ §1 竞品对照国际服路径加触发条件（M5 后链路已通且投入 ≤ 3 天），否则明确降级为仅历史版本对照；⑦ M1 标注主路径（L3 + 回测骨架）与并行支线（personal key / schema v2），防支线拖主路径；⑧ 风险表补分享卡片隐私行（默认打码 ID，纯本地生成）。

- **v1.4（2026-08-19）**：M1/M2/M3 实现完成，补 §17 实现状态追踪 + 基于落地经验完善 M4/M5 细节。① 补 §17 实现状态表（M1/M2/M3 交付物、关键偏离、测试覆盖、代码规模）；② M4 §10.5 补"复用已落地模块"表（`meet_db` 全量收集、`insight` 聚合模式、`backtest/samples` 身份匹配与分路归一化、`user_tag` 存量标签）+ `ThreatRating` 数据模型定义；③ M5a §8.5 补"复用已落地模块"表（`game_state_monitor` 已订阅 gameflow、`champion_select.rs` 已解 session 结构、`live_game.rs` 已解 snapshot、`insight` 习惯标签、`rune_import` 聚合模式、前端 `liveGameIntel.ts`）；④ 里程碑表 §13 M4 补验收收口项（前端 vitest 1365→1375+、Rust 529→535+、lint 0 errors）；⑤ M5a 依赖列补具体模块名；⑥ §7.5/§9.5 标注实现状态（M3 已完成）及实际偏离（OP.GG 符文→本地聚合）。

---

## 17. 实现状态追踪

> 本节随里程碑推进持续更新，记录实际交付与设计偏离。

### 17.1 里程碑总览

| 里程碑 | 状态 | 交付日期 | 关键偏离 |
|--------|------|---------|---------|
| M1（P0：L3 下钻 + 回测骨架） | 完成 | 2026-08-18 | 无重大偏离；Riot personal key 框架就绪，key 未填入（用户侧） |
| M2（P0：回测闭环 + 对账 ledger） | 完成 | 2026-08-18 | 无重大偏离；收集即沉淀 + 待对账数可见 + 回测块测试 |
| M3（P1：一键导入 + 习惯标签） | 完成 | 2026-08-19 | 符文页数据源从 OP.GG → 改为**本地 collected_games 聚合**（OP.GG 无完整符文页数据）；出装后置 P3 已验证 |
| M4（P2：赛前威胁评级 + CDragon） | 完成 | 2026-08-19 | 威胁评级首版在 M4 前已落地；本轮修复排位敌方 puuid 匿名滤空 + CDragon 预下载/版本化（见 §17.6） |
| M5a（P3：下一动作基础版） | 待做 | — | — |
| M5a′（P3：下一动作个性化增强） | 待做 | — | — |
| M5b（P3：overlay 窗口评估） | 待做 | — | — |
| M5c（P3：production key + 增长） | 待做 | — | — |
| M5d（P3：游戏事件流 POC） | 待做 | — | — |

### 17.2 M1（战场一 L3 + 战场二回测骨架）交付清单

**后端**：
- `score/events.rs`：timeline 事件提取（damage dips / vision drops / CS gaps / teamfight participation / death clusters），每事件含 `{ dimension, timestamp, description, delta }`
- `score/drilldown.rs`：L1→L2→L3 三级下钻，`ScoreDrilldown { total, breakdown, events }`
- `command/score.rs`：`get_score_drilldown(game_id)` + `compute_player_scores(game_id)` 命令
- `backtest/mod.rs`：描述性对位对比引擎 `DecisionBacktest { suggestion, actual, matchup_delta, confidence, caveats }`，`confidence` 封顶 0.4、恒带 caveats
- `backtest/samples.rs`：本地样本提取（从 `collected_games` 的 `game_detail.participants` 按 puuid 匹配 + 分路归一化 `normalize_position`），enemy 对位优先 MIN_MATCHUP_SAMPLES=3
- `backtest/store.rs`：`backtest.db`（`decision_ledger` + `pending_suggestions` + `local_samples` 三表），`AdoptionStats { adopted_total, adopted_wins, not_adopted_total, not_adopted_wins }`
- `riot/` 模块：Riot Web API 封装（match-v5/league-v4/summoner-v4），`TokenBucketRateLimiter` 可配置令牌桶，personal key 存 `config.rs` 的 `settings.riot.apiKey`
- `docs/superpowers/specs/2026-08-18-storage-schema-v2-design.md`（schema v2 设计定稿，落地后置）

**前端**：
- `MatchDetailScoreTab.vue`：三级下钻（总分→维度→事件时间轴），事件可跳转对局分钟曲线
- `MatchDetailBacktestTab.vue`：决策回测区块（对位历史差异 + 置信度 + caveats + 数据不足降级）
- `services/backtest.ts`：`DecisionBacktest` 接口 + `getDecisionBacktest(gameId)` / `getAdoptionStats()`
- `services/ai/matchDetail/__tests__/prompts.spec.ts`：决策回测块 4 测试（有数据注入含胜率差/表现分差/置信度 -12.0%；insufficient 如实说明无置信度；未对齐不注入；isMe+禁止胜负归因）

**测试**：Rust 单元测试覆盖（events 提取 + drilldown 降级 + backtest 0 数据/样本不足降级 + store CRUD）；golden test 评测集基准（20 局手工标注，双周重跑）。

### 17.3 M2（战场二全阶段闭环）交付清单

**后端**：
- `command/backtest.rs`：`get_decision_backtest(game_id)` 赛后回测 + `get_adoption_stats()` 采纳/未采纳统计
- `command/meet.rs`：`save_collected_games` 后 `tauri::async_runtime::spawn` → `Summoner::get_my_summoner().await` → `samples::refresh_local_samples(&s.puuid)`（收集即沉淀，失败静默 warn）
- `backtest/samples.rs`：`refresh_local_samples` 顺带 `store::prune_stale_pending(now - 7 天)`（`PENDING_TTL_MS = 7*24*60*60*1000`）
- `backtest/store.rs`：`AdoptionStats` 加 `pending_total: i64`（待对账建议数）
- 对账纪律落实：pending 只写 Pick、去重 `(position, suggestion_champion_id)`、对账窗口 ≤15min、`adopted = 实际==建议`、关联键 `gameId+suggestedAtMs+建议英雄`、ISO 时区后缀必须显式（缺后缀视为格式错误）

**前端**：
- `MatchDetailBacktestTab.vue`：统计卡显示「待对账建议 N 条——打开赛后详情页会自动对账」+ `.match-detail-backtest-pending` 样式
- `backtest.ts`：`AdoptionStats` 接口加 `pendingTotal`

**测试**：`backtest.spec.ts` `AdoptionStats` payload 含 `pendingTotal: 3`；`store.rs` 单测 `adoption_stats_split_by_adopted` 断言 pending_total=2，`empty_ledger_has_none_win_rates` 断言 0。

### 17.4 M3（战场五一键导入 + 战场三习惯标签）交付清单

**Wave 1——一键导入（符文 + 召唤师技能）**：

> **关键偏离**：OP.GG 模块无符文数据，PUGG 聚合只有 rune_main/rune_sub/keystone 频率（非完整页）。**符文页数据源改为本地 `collected_games` 的 `game_detail.participants[].perks`**（完整 `styles[2] + stat_perks`），`most_common_perk_page` 聚合本机该英雄最近 20 局最流行完整页，纯本地无外部依赖。

- `lcu/api/perks.rs` 扩展：`PerkPage` 加 `primary_style_id/sub_style_id/selected_perk_ids`；新增 `NewPerkPage`、`PerkStatPerks`、`create_perk_page`（POST）`update_perk_page`（PUT）
- `rune_import.rs`（新）：`RunePageBuild`、`most_common_perk_page`（本地聚合，`AGGREGATE_LIMIT=20`）、`most_common_spells`（`Participant.spell1_id/spell2_id`）、`my_participant` 严格按 puuid 匹配
- `command/import.rs`（新）：`import_rune_page(champion_id)`（聚合→页名 `RA-{cid}`→创建或覆盖→设当前）、`import_summoner_spells`（champ-select 找 `my_pick_action`→PATCH spells）
- `lcu/api/champion_select.rs`：`patch_session_spells(action_id, spell1_id, spell2_id)`
- 前端：`importRunes.ts` 服务 + `ChampionIntelCard.vue` 一键导入按钮（符文/技能）+ 内联反馈

**Wave 2——习惯标签（战场三）**：

- `insight/mod.rs`（新）：`aggregate_habit_tags` 纯函数，6 个 L2 维度（vision/cs/deaths/kills/assists/damage）vs 同局同位置 peer 均值，`deaths` 维度取反（peer_mean - my），`MIN_GAMES=5`，`streak` 从最近往回数连续落后局数
- `insight/store.rs`（新）：`insight.db`（`habit_tags` + `habit_goals` 表），`upsert_habit_tags`（幂等覆盖）、`query_habit_tags`、`add_habit_goal`/`toggle_habit_goal`/`query_habit_goals`
- `command/insight.rs`（新）：`get_habit_tags`（async，`all_collected_games` → 聚合 → 幂等落库 → 返回）、`list_habit_goals`/`add_habit_goal_cmd`/`toggle_habit_goal_cmd`
- 前端：`insight.ts` 服务（`HabitTag`/`HabitGoal` 接口 + invoke 封装）、`Growth.vue` 页面（标签卡 + 改错清单勾选）、`/Growth` 路由 + 侧边导航「成长」入口

**测试**：`rune_import.rs` 5 单测（聚合/跳过/窗口/英雄不匹/技能对）；`command/import.rs` 4 单测；`insight/mod.rs` 5 单测（聚合/streak/不足 5 局/无 peer 整局跳过/deaths 取反）；`insight/store.rs` 2 单测（幂等/roundtrip）；`importRunes.spec.ts` 4 测试；`insight.spec.ts` 6 测试；前端全量 1365 测试全部通过。

### 17.5 当前代码规模

| 指标 | M1 前 | M3 后 |
|------|-------|-------|
| 前端 vitest | ~1300 | 1365 |
| Rust unit tests | ~510 | 529 |
| 后端模块 | score/, backtest/, riot/ | + rune_import.rs, insight/, command/import.rs, command/insight.rs |
| 前端页面 | Record, Gaming, Settings, Loading | + Growth |
| 本地数据库 | meet.db, backtest.db | + insight.db |

### 17.6 M4（战场六赛前威胁评级 + CDragon 数据地基）交付清单

> **关键偏离**：威胁评级首版（scouting 引擎 + 前端 EnemyThreatCard）在 M4 正式排期前已随日常开发落地；本轮收口补齐两处实质性缺陷：① 排位下 LCU 对敌方下发**混淆 puuid**，原 `get_threat_ratings` 按 `!puuid.is_empty()` 过滤会把敌方全部滤空——现按 `command::session` 同口径 `deobfuscate_puuid` 还原（还原失败宁可跳过不编造）；② CDragon 图标无版本概念、无预下载——现按 `CDRAGON_PATCH` 常量做磁盘缓存版本段隔离 + 启动后台批量预热。

**后端**：
- `scouting/mod.rs`（首版已有，沿用）：`assess_team_threats` 跨局聚合（`all_games_for_player` 按 puuid 从 `collected_games` 提取最近 20 局）、`generate_style_tags`（侵略性强/稳健发育/团战核心/单带偏好/视野控制/高KDA，`MIN_GAMES_FOR_RATING=5` 起效）、`compute_aggression`、降级纪律（数据不足→Low+caveats、未交手→caveats）
- `command/scouting.rs`：`get_threat_ratings` 增加 `resolve_enemy_puuid` 混淆还原（真实 puuid → 混淆还原 → 跳过），3 单测
- `cdragon/mod.rs`：`CDRAGON_PATCH` 版本常量（URL + 磁盘目录双生效）、共享 HTTP 客户端、`prefetch_icons` 批量预下载（并发 8、磁盘命中跳过、失败计数不阻断）、profile 类型 `.jpg` 路径修复，5 单测
- `lcu/api/asset.rs`：`init_once` 后台 spawn `prefetch_cdragon_icons`——从元数据缓存生成 champion/perk/spell 清单预热落盘（item 2000+ 按需不预热；LCU 离线清单为空则跳过）

**前端**：
- `EnemyThreatCard.vue` + `scouting.ts` + `Gaming.vue`（首版已有，沿用）：选人阶段 watch phase 拉取威胁评级，卡片展示最高威胁指示条 + 逐玩家威胁徽章/分路/交手局数/表现分/胜率/侵略性/风格标签/caveats
- 新增测试：`scouting.spec.ts` 6 测试（invoke 调用/空结果/错误透传/标签与颜色常量覆盖）、`EnemyThreatCard.spec.ts` 10 测试（空数组不渲染/最高威胁头/逐行渲染/交手局数条件/统计/标签/caveats/Low 弱化类/胜率 null 回落）

**测试**：前端 vitest 1365 → **1381**（+16）；Rust 新增 cdragon 5 + scouting 3 单测；`cargo fmt --check` 通过、lint 0 errors（143 既有 warning）、vue-tsc 0 错误。验收达标：威胁评级展示 + CDragon 断网可渲染（磁盘预热 + 版本隔离）。
