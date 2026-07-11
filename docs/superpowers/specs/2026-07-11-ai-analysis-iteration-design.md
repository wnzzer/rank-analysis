# AI 分析迭代设计：版本情报 + 关联信号 + 选人阶段敌方展示

日期：2026-07-11
状态：待实施
分支建议：`feat/ai-tactical-intel`（独立于 `feat/full-config-backup-sync`）

## 1. 背景与目标

现有 AI 分析（对局整队分析 / 单场复盘）喂给模型的数据全部来自本地 LCU，
模型对**当前版本**的理解只能依赖训练时的过时记忆，导致版本强弱判断不可靠。
同时选人阶段敌方队伍被后端故意丢弃（`session.rs` ChampSelect 分支
`team_two.clear()`），选人期间既看不到对面英雄，AI 按钮也被禁用。

本次迭代的目标：

1. **版本情报**：接入 OP.GG 实时数据（英雄 T级/胜率/Ban率/对线克制），注入 AI prompt 并在对局页展示。
2. **知识库**：建立远程可更新的排位/大乱斗/海克斯乱斗知识合集与版本增强削弱摘要，不发版即可更新。
3. **关联信号引擎**：代码确定性计算跨位置联动信号（打野摆烂、辅助连败等），AI 只负责解读表达。
4. **选人阶段迭代**：展示敌方已选英雄（含意向/锁定动画），选人期即可做阵容基础分析。

**非目标**（本次不做）：

- AI 标签建议链路不动。
- 不做独立的知识库浏览页面。
- 不做多数据源切换（lolalytics 备源等），仅 OP.GG 单源 + 降级。
- 海克斯乱斗无 OP.GG 统计，仅靠知识库文案覆盖。

## 2. 需求决策记录

| 决策点 | 结论 |
|---|---|
| 实时数据源 | OP.GG 内部 API（无官方 API，做好容错降级；数据基于外服，UI 需标注） |
| 知识库分发 | 远程拉取（GitHub raw/OSS）+ 本地缓存 + 仓库内置兜底副本 |
| 关联规则计算 | 前端确定性规则引擎算信号，AI 表达；阈值/文案由知识库远程下发 |
| UI 范围 | 喂 AI + 对局页展示（T级/胜率/强势期/版本改动徽章） |
| 覆盖 AI 链路 | 对局页整队分析 + 战绩单场复盘（标签建议不动） |
| 选人布局 | 镜像双栏：我方玩家卡不变，敌方栏为「英雄情报卡」，带选人三态动画 |
| 对局中展示 | PlayerCard 内嵌小标签（T级徽章 + 胜率 + 改动图标，hover 详情） |
| 「海斗」含义 | 海克斯乱斗模式知识 |

## 3. 架构总览（方案 A：后端数据层 + 前端组装）

```
┌─ Rust ────────────────────────────────┐   ┌─ 前端 ──────────────────────────┐
│ opgg/       OP.GG 客户端+磁盘缓存      │   │ services/intel/   数据访问封装    │
│ knowledge/  远程知识库+内置兜底         │──▶│ services/ai/shared/signals.ts   │
│ command/{opgg,knowledge}.rs 命令层     │   │   关联信号引擎（纯函数）           │
│ session.rs  选人阶段敌方填充（不再清空） │   │ prompts/*  注入版本情报/信号/知识  │
└───────────────────────────────────────┘   │ Gaming 页  敌方英雄情报卡+徽章     │
                                            └─────────────────────────────────┘
```

与现有 `fandom` 模块（拉取 + 缓存 + TTL + 命令）完全同构。

## 4. Rust 数据层

### 4.1 `src-tauri/src/opgg/` 模块

- `api.rs`：OP.GG 内部 JSON 接口客户端（`lol-api-champion.op.gg`），
  拉取各模式（ranked/aram）英雄统计与 counter 数据。请求带浏览器 UA。
- `data.rs`：
  ```rust
  pub struct ChampionMeta {
      pub champion_id: i32,
      pub position: String,       // 主分路
      pub tier: i32,              // 1=T1(OP)… 数值越小越强
      pub win_rate: f64,
      pub pick_rate: f64,
      pub ban_rate: f64,
  }
  pub struct LaneCounter {        // 对位克制
      pub champion_id: i32,
      pub opponent_id: i32,
      pub position: String,
      pub win_rate: f64,          // champion 对 opponent 的对线胜率
      pub sample: i64,
  }
  ```
- 缓存策略：按 `patch` 号 key **持久化到磁盘**（app data 目录），TTL 12h；
  拉取失败时返回过期缓存，无缓存返回空。
- `command/opgg.rs`：
  - `update_opgg_data()` —— 启动时 + 手动刷新触发
  - `get_champion_meta(champion_id, position?) -> Option<ChampionMeta>`
  - `get_lane_counters(champion_ids: Vec<i32>) -> Vec<LaneCounter>`（批量，服务本局 10 英雄）
  - `get_opgg_status() -> { patch, updated_at, stale }`（供 UI 标注数据版本）

### 4.2 `src-tauri/src/knowledge/` 模块

- 远程 URL 可配置（默认 GitHub raw），启动拉取 → 写本地缓存文件；
  失败依次回退：本地缓存 → 仓库内置兜底副本（`include_str!` 打包进二进制）。
- `command/knowledge.rs`：`update_knowledge()`、`get_knowledge() -> KnowledgeBase`、
  `get_knowledge_status()`。
- TTL 6h；客户端校验 `schemaVersion`（仅支持已知版本，未知版本回退兜底副本）。

### 4.3 知识库内容生产流水线

源文件（人类友好）在仓库 `knowledge/` 目录，构建脚本编译成单份 JSON：

```
knowledge/
├── patches/26.13.md      # 版本增强/削弱（AI 辅助从官方公告生成草稿，人工校对）
├── champions/*.md        # 每英雄：强势期、对线要点（可选，渐进补充）
├── modes/ranked.md       # 排位知识合集
├── modes/brawl.md        # 海克斯乱斗知识合集
├── modes/aram.md         # 大乱斗知识合集
└── rules/signals.yaml    # 关联信号规则：阈值 + 文案模板
scripts/build-knowledge.ts  # 编译为 knowledge.json（带 schemaVersion + patch）
```

产物 schema：

```jsonc
{
  "schemaVersion": 1,
  "patch": "26.13",
  "updatedAt": "2026-07-11T00:00:00Z",
  "patchNotes":   { "<championId>": { "change": "buff|nerf|adjust", "summary": "Q伤害 70→85…" } },
  "championNotes":{ "<championId>": { "powerSpike": "6/11/16", "tips": "…" } },
  "modeKnowledge":{ "ranked": ["…"], "brawl": ["…"], "aram": ["…"] },
  "signalRules":  [ /* 见 6.1 */ ]
}
```

CI（GitHub Actions）在 `knowledge/**` 变更时自动构建并发布到 raw 分发点。
每个新版本的维护流程：官方公告 → AI 生成 `patches/x.md` 草稿 → 人工校对 → push。

## 5. 选人阶段敌方展示

### 5.1 后端（`session.rs` + `champion_select.rs`）

- `champion_select.rs::OnePlayer` 补充解析 `cellId`（映射 action → 玩家格）。
- `session.rs` ChampSelect 分支：不再 `team_two.clear()`，改为用
  `select_session.their_team` 填充敌方（championId + cellId，puuid 为空——
  排位选人 LCU 匿名化，拿不到敌方身份，属预期）。
- puuid 为空的玩家沿用现有 placeholder 逻辑：跳过战绩/段位拉取，`is_loading: false`。
- **回归防线**：保留并扩展现有「选人阶段禁止 selections 回填旧局数据」测试，
  新增 their_team 填充路径的测试（敌方仅 championId、我不出现在敌方等断言）。
- 向前端额外透出选人行动状态：`SessionSummoner` 增加
  `pick_state: "none" | "intent" | "picking" | "locked"`（由 `actions` 推导：
  未完成 action 的 championId = 意向，`isInProgress` = 正在选，`completed` = 锁定）。

### 5.2 前端（Gaming 页）

镜像双栏布局（用户已选定）：我方栏现有玩家卡不变；敌方栏渲染**英雄情报卡**：

- 内容：英雄头像/名字、T级徽章、版本胜率、版本改动标记（↑增强绿 / ↓削弱红，hover 详情）、
  强势期 chip、对我方对位英雄的克制关系（如「克制你的剑魔 46:54」，
  对位映射用 OP.GG 主分路推断，标注"仅供参考"）。
- **选人三态动画**（用户补充需求）：
  - `intent`（对面亮出未锁）：半透明 + 呼吸光效
  - `picking`（当前行动格）：边框高亮脉冲
  - `locked`（锁定）：定格入场动画（scale + fade）
  - 数据驱动：现有 WebSocket 监听器已订阅选人事件并重新触发 `get_session_data`，
    前端 watch `pick_state` 变化触发 CSS transition，无需新增订阅通道。
- 未锁定格子显示 `❓ 尚未锁定` 占位。
- 顶部加一条数据版本横幅：`版本 26.13 · OP.GG 数据已更新 / 数据滞后提示`。
- ✨AI 按钮选人阶段**解禁**，走「阵容分析」轻量 prompt 变体（见 7.3）。

### 5.3 对局中（InProgress）

PlayerCard 内嵌小标签（用户已选定）：英雄头像旁加 T级徽章 + 胜率 + 改动小图标，
hover 弹出详情（改动全文、强势期、counter），不改变现有卡片布局密度。

## 6. 关联信号引擎（前端）

### 6.1 规则来源：知识库 `signalRules`

```yaml
- id: jungle-low-participation
  scope: teammate            # teammate | enemy | self
  position: JUNGLE
  when: { kp10: { lt: 0.45 } }
  text: "打野{name}近期参团率仅{kp10}，注意自己带节奏"
  severity: warn             # info | warn | danger
- id: bot-duo-tilt
  scope: teammate
  position: UTILITY
  when: { lossStreak: { gte: 4 } }
  text: "辅助{name}正在{lossStreak}连败，AD位注意对线保守"
```

`when` 支持的指标由代码定义白名单（kp10、lossStreak、winRate10、isOffRole、
championMastery、counterWinRate…），运算符 `lt/lte/gt/gte/eq`，可 `all/any` 组合。
远程改阈值/文案即可调整判定口径，不发版。

### 6.2 实现：`src/services/ai/shared/signals.ts`

- 纯函数：`evaluateSignals(input: SignalInput, rules: SignalRule[]) => Signal[]`
- `SignalInput` 聚合自现有 sessionData、recentProfile（`recentProfile.batch.ts` 已有）、
  OP.GG meta/counter。
- 输出 `Signal { id, subjectPuuid, positionPair?, text, severity, evidence }`。
- 未知指标/畸形规则静默跳过（远程规则不可信输入按防御式处理）。
- Vitest 单测覆盖每类运算符与边界值（目标 90%+，属工具函数标准）。

## 7. Prompt 注入

### 7.1 注入块（`team.ts` 与 `stage1-attribution.ts` 共用构建器）

新增 `src/services/ai/shared/intelContext.ts`：`buildIntelContext(champIds, queueId)`
→ 输出以下文本块，**只含本局英雄相关条目**（控制 token）：

```
【版本情报 · 26.13 · 数据来源OP.GG(外服)】
- 剑姬(上单): T1, 胜率52.3%, 本版本↑增强(Q伤害70→85)
- …（本局 10 英雄）
【对线克制】
- 上单: 剑姬 对 剑魔 对线胜率54%（样本1.2w）
【关联信号】（程序基于近期战绩计算的事实，请直接解读，不要重新计算）
- [warn] 打野XX近10场参团率38%，低于45%阈值
【模式知识 · 排位】
- …（按 queueId 选取，最多 N 条）
```

### 7.2 改动点

- `buildTeamAnalysisPrompt`（team.ts）：追加 intel 块 + 输出模板新增「版本视角」小节。
- `buildStage1Prompt`（stage1-attribution.ts）：追加 intel 块；归因规则允许引用
  信号作为 `mitigatingFactors` / `evidenceMetrics` 补充。
- system prompt 补一句：版本数据以【版本情报】为准，禁止使用训练记忆里的版本认知。

### 7.3 选人阶段「阵容分析」变体

无敌方玩家战绩时的轻量 prompt：只喂双方英雄 + 版本情报 + 克制关系 + 我方玩家画像，
输出「阵容强弱对比 / 关键对线 / BP 或分路建议」，约 200 字。

## 8. 设置页（General.vue）

新增「战术情报」区：

- OP.GG 数据拉取开关（默认开；关闭则 UI 徽章隐藏、prompt 不含版本块）
- 知识库/OP.GG 数据版本与更新时间展示 + 手动刷新按钮

## 9. 错误处理

| 故障 | 行为 |
|---|---|
| OP.GG 接口失效/改版 | 用过期磁盘缓存并标注 stale；无缓存则 UI 隐藏徽章，AI 不注入版本块 |
| 知识库拉取失败 | 本地缓存 → 内置兜底副本，UI 标注知识库版本 |
| OP.GG patch ≠ 客户端 patch | UI 横幅与 prompt 中都标注数据版本号 |
| 远程规则畸形 | 单条静默跳过并 log，不影响其余信号 |
| 选人阶段 their_team 为空（LCU 异常） | 敌方栏整体显示占位，与现状等价 |

## 10. 测试

- **Rust**：OP.GG 响应解析（fixture JSON）、磁盘缓存 TTL/降级链、knowledge
  schemaVersion 校验与兜底、`session.rs` their_team 填充回归（扩展现有
  `champselect_must_not_refill_enemy_from_stale_selections` 系列）。
- **前端**：signals.ts 规则引擎单测（运算符/边界/畸形规则）、intelContext
  构建快照测试（含空数据降级）、pick_state 推导单测。
- **端到端**：Windows 真机 dev 模式 + MCP bridge 验证选人阶段敌方渐进出现与动画。

## 11. 实施切分建议（后续 writing-plans 展开）

1. Rust `opgg` 模块 + 命令 + 缓存（可独立合入，UI 未接前无副作用）
2. Rust `knowledge` 模块 + 仓库 `knowledge/` 源文件 + 构建脚本 + CI
3. 选人阶段 their_team 填充 + pick_state（后端）
4. 前端敌方英雄情报卡 + 三态动画 + 数据横幅
5. signals.ts 信号引擎 + 单测
6. prompt 注入（team / stage1 / 选人变体）+ 设置页「战术情报」区
