---
title: Pick/Ban 规则引擎 + AI 标签建议 — 设计文档
date: 2026-05-01
status: approved
---

# Pick/Ban 规则引擎 + AI 标签建议

## 摘要

本设计在现有自动化与标签系统上加两个能力：

1. **Pick/Ban 规则引擎**：在现有简单优先级列表之上叠加一层 `IF condition THEN pick/ban 英雄` 的规则集；条件用扁平 AND 列表，规则按用户拖拽顺序匹配；每条 pick 规则可单独选择"锁定 / 仅 hover"。规则没命中时回退到老的优先级列表，向后完全兼容。
2. **AI 标签建议**：在 Tags 规则管理页加 `AI 推荐` 按钮，AI 分析当前用户最近 20 局对局，从赢局共同点提取"好标签"、输局共同点提取"坏标签"，直接产出可一键采用的 `TagConfig`（含完整条件树）。标签名约束 2-5 字儒雅风格。

两个特性共享现有 AI proxy（Cloudflare Worker）、现有 LCU match-history 缓存、现有 TagConfig schema，不引入新基础设施。

---

## 特性 1：Pick/Ban 规则引擎

### 目标

让用户用 `IF 条件 THEN 选/Ban 英雄` 的方式表达自动化策略，覆盖"打中路时遇到刺客 ban 劫"、"自家有亚索时辅助选锤石"等当前简单列表无法表达的场景；同时保持老用户配置零成本兼容。

### 核心决策

| # | 议题 | 选择 |
|---|------|------|
| Q1 | 与现有简单列表的关系 | **B 分层叠加**：规则优先；没命中回退老列表 |
| Q2 | 条件组合方式 | **B 扁平 AND 列表**：一条规则的所有条件必须全满足；OR 通过多写一条规则表达 |
| Q3 | pick / ban 规则存储 | **A 两套独立列表**：`pickRules` + `banRules`，UI 两个 section |
| Q4 | "只预选不锁定"粒度 | **A 每条 pick 规则一个 `lock` 开关**；老 fallback 列表保持锁定行为 |
| 隐含 | 多规则匹配 | 用户拖拽顺序，**第一条命中即用** |
| 隐含 | 目标英雄不可用时 | **跳到下一条规则**（最大努力执行） |
| 隐含 | NOT 条件 | v1 直接支持（独立的 `*NotContains` 变体，不引入树结构） |

### 数据模型

新建 `lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs`：

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PickBanRule<A> {
    pub id: String,                         // uuid
    pub name: String,                       // 用户起的标识
    pub enabled: bool,
    pub conditions: Vec<RuleCondition>,     // 扁平 AND
    pub action: A,                          // PickAction or BanAction
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum RuleCondition {
    Position { value: Position },
    AllyChampionsContains { ids: Vec<i64> },
    AllyChampionsNotContains { ids: Vec<i64> },
    EnemyChampionsContains { ids: Vec<i64> },
    EnemyChampionsNotContains { ids: Vec<i64> },
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub enum Position { Top, Jungle, Middle, Bottom, Utility }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PickAction { pub champion_id: i64, pub lock: bool }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BanAction { pub champion_id: i64 }

pub type PickRule = PickBanRule<PickAction>;
pub type BanRule  = PickBanRule<BanAction>;
```

**存储**：扩展现有 YAML 配置，新增两个键，不动旧键：

```yaml
settings:
  auto:
    pickChampionSlice: [...]   # 现有，保留作为兜底
    banChampionSlice: [...]    # 现有，保留作为兜底
    pickRules: [PickRule, ...] # 新增
    banRules:  [BanRule,  ...] # 新增
```

### 后端运行时

新建 `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`，纯函数式：

```rust
pub fn evaluate_pick<'a>(
    session: &ChampionSelectSession,
    my_position: Option<Position>,
    rules: &'a [PickRule],
) -> Option<&'a PickAction>;

pub fn evaluate_ban<'a>(
    session: &ChampionSelectSession,
    my_position: Option<Position>,
    rules: &'a [BanRule],
) -> Option<&'a BanAction>;
```

**评估流程**：

1. 按 `rules` 顺序遍历
2. `rule.enabled == false` → 跳过
3. 逐个 `RuleCondition` 求值，任一不匹配 → 跳过此规则
4. 全部匹配 → 检查 `action.champion_id` 是否仍可执行（未被 ban / 未被队友选 / 未被自己已操作）
5. 可执行 → 返回该 action；否则跳到下一条规则
6. 无规则命中 → 返回 `None`

**接入现有 `automation.rs`**（伪代码）：

```rust
// start_select_champion
let session = get_champion_select_session().await?;
let my_pos  = detect_my_position(&session, &my_puuid);
let rules: Vec<PickRule> = config::get("settings.auto.pickRules").unwrap_or_default();

if let Some(action) = rule_engine::evaluate_pick(&session, my_pos, &rules) {
    patch_session_action(action_id, action.champion_id, "pick", action.lock).await?;
    return;
}
// 规则没命中 → 现有 pickChampionSlice 兜底逻辑原封不动
fallback_to_pick_slice(...).await?;
```

`start_ban_champion` 同型接入 `evaluate_ban` + `banRules`。

**条件求值规则**：

| Condition | 实现 |
|-----------|------|
| `Position` | `my_position == Some(cond.value)` —— 大乱斗 (`assignedPosition == ""`) → `my_position == None` → 永远不匹配 |
| `AllyChampionsContains { ids }` | `session.myTeam.iter().any(|p| p.championId != 0 && ids.contains(&p.championId))` —— hover 和 lock 都计入 |
| `AllyChampionsNotContains { ids }` | 上面取反 |
| `EnemyChampions*` | 同上但作用于 `session.theirTeam`（ban 阶段对面 championId 通常都是 0，自然不匹配） |

**位置识别**：LCU `/lol-champ-select/v1/session` 的 `myTeam[]` 每个 entry 有 `assignedPosition` 字段（`top/jungle/middle/bottom/utility/""`）；按 puuid 找到自己 → 映射到 `Position` enum，空字符串返回 `None`。

**配置变更立即生效**：现有 callback system 已经监听 config 变化，规则改动无须额外接线。

### 前端 UX

#### 规则编辑器：扩展 `views/settings/Automation.vue`

布局：

```
┌─ 自动 Pick ────────────────────────────────┐
│ 规则（按顺序匹配，第一条命中即用）           │
│ ┌────────────────────────────────────────┐ │
│ │ ☑ 中路防刺客   中路 + 对面有劫 → ban 劫 [✏️][🗑]│
│ │ ☑ 自家亚索辅助锤石  ...              [✏️][🗑]│
│ │ [+ 添加规则]                            │ │
│ └────────────────────────────────────────┘ │
│ 兜底（规则都没命中时按顺序选）                │
│ ┌────────────────────────────────────────┐ │
│ │ [现有的简单优先级列表 UI 不变]          │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

`自动 Ban` 区同型。

规则行 collapse 显示一行纯文字摘要（"中路 + 自家亚索 → 选 卡尔玛 [锁]"），点 ✏️ 进编辑器。

#### 新组件 `components/automation/RuleEditModal.vue`

不复用 `TagConditionNode.vue`（递归树过重）。结构：

```
名称：    [input]
启用：    [switch]

条件 (全部满足)：
  [类型▾]  [值]                  [🗑]
  [类型▾]  [值]                  [🗑]
  [+ 添加条件]

行动：
  目标英雄： [n-select 带头像 + 搜索，复用现有 Automation.vue 的 renderLabel]
  执行后锁定：[switch]            ← 仅 pick 规则显示

[取消] [保存]
```

条件类型 dropdown（5 项）：
- 我的位置 = `Top|Jungle|Middle|Bottom|Utility`
- 自家英雄 包含 = `[multi-select 英雄]`
- 自家英雄 不包含 = `[multi-select 英雄]`
- 对面英雄 包含 = `[multi-select 英雄]`
- 对面英雄 不包含 = `[multi-select 英雄]`

**保存按钮在 `conditions.length === 0` 时禁用**，提示"至少加一个条件"。

### 边界情况

| 场景 | 行为 |
|------|------|
| 配置为空（无规则） | 走兜底列表，无日志噪音 |
| 规则的 `action.champion_id` 是无效英雄 ID | 评估时跳过，`log::warn!` 记录 |
| 规则 `conditions` 为空（手改 yaml 绕过 UI） | 永真，命中第一条；前端 UI 已禁止保存空条件 |
| `Position` 条件互相矛盾 | 永假，无害 |
| pick 规则被 ban 阶段误调用（或反之） | 不会发生 —— 两个任务分别只读各自规则集 |
| LCU `assignedPosition == ""`（普通匹配 / 大乱斗） | `Position` 条件永远不匹配（按设计） |
| 规则评估出错（panic） | `evaluate_*` 返回 `Result<Option<&Action>, EvalError>`，caller 吞错 + warn + 走兜底，不让自动化任务崩溃 |
| 用户拖动 / 启用 / 编辑保存 | 现有 callback 系统重启自动化任务，规则即时生效 |

### 测试

新建 `lol-record-analysis-tauri/src-tauri/src/rule_engine_tests.rs`：

- 条件单测：`Position` 匹配 / 不匹配 / 空字符串；`AllyContains` hover 和 lock 都算；`Enemy*` 在 ban 阶段；`*NotContains` 取反逻辑
- 规则评估单测：第一条命中 / 跳过 disabled / 跳过目标不可用 / 全不匹配返回 None / 空规则集返回 None / 无效 champion_id 跳过
- ban vs pick：分开评估互不干扰；`PickAction.lock` 字段透传

`ChampionSelectSession` 在测试里手搓最小 mock JSON 反序列化。

---

## 特性 2：AI 标签建议

### 目标

用户在 Tags 规则管理页里点 `AI 推荐` → AI 看用户近 20 局，赢局共同点 → 好标签、输局共同点 → 坏标签 → 直接生成完整 `TagConfig`（含条件树）→ 用户点"采用"即写入规则库。

### 核心决策

| # | 议题 | 选择 |
|---|------|------|
| Q5 | 工作流 | **A**：在 Tags 规则管理页 AI 协助创建可复用的判定规则；分析当前用户的对局 |
| Q6 | AI 输出范围 | **B**：AI 直接产出完整 `TagConfig`（名字 + 描述 + 条件树），一键采用 |
| 隐含 | 标签名约束 | 2-5 字儒雅古风（如"中路雕将"、"暮气沉沉"），避免俗套 |
| 隐含 | 好/坏数量 | 各 2-3 个 |
| 隐含 | "好/坏" 是 UI 分组用，不写进 TagConfig schema |
| 隐含 | 调用位置 | **前端**，复用现有 Cloudflare Worker proxy |
| 隐含 | full TagCondition schema 全量塞 prompt | 接受 |
| 隐含 | "已采用" 卡片状态在会话内跨次打开保留 | 是 |
| 隐含 | v1 不做敏感词审核 | 是 |

### 数据模型

无新结构。AI 输出严格遵循现有 `TagConfig` schema。仅在前端 sessionStorage 加会话级缓存：

```ts
// services/ai/tagSuggestCache.ts
key:   `ai_tag_suggest_${puuid}`         // puuid = 当前用户
value: {
  good: TagSuggestion[],
  bad:  TagSuggestion[],
  generatedAt: string,                   // ISO timestamp
  droppedCount: number                   // 校验失败被过滤的条目数
}
type TagSuggestion = TagConfig & { adopted?: boolean }
```

### AI 调用与提示词

#### 调用位置：前端

不走 Rust。理由：项目现有 AI 调用全在前端 `services/ai/`，proxy `https://ai.nuliyangguang.top` 已配；Rust 端的 `command/ai.rs` 是废 stub；AI 是 IO 等待，前端 + sessionStorage 最自然。

新建：
- `lol-record-analysis-tauri/src/services/ai/prompts/tag-suggest.ts`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest.ts`

#### 输入数据：每局抽取的特征

复用现有 `extractPlayerDeepDive()`：

```ts
type GameFeature = {
  win: boolean
  championId: number
  championName: string         // 中文名
  position: 'TOP'|'JUNGLE'|'MIDDLE'|'BOTTOM'|'UTILITY'|'NONE'
  queueId: number
  queueName: string            // "单双排" / "灵活组排" / "匹配" / "大乱斗"
  kda: { k: number, d: number, a: number, ratio: number }
  killParticipation: number    // 0..1
  damageShare: number          // 0..1 队伍占比
  goldShare: number
  visionScore: number
  csPerMin: number
  durationMin: number
}
```

20 局拆为 `wins: GameFeature[]` + `losses: GameFeature[]` 喂 AI。

#### Prompt 结构

System：

```
你是英雄联盟数据分析助手。任务：分析用户近 20 场对局，找赢局和输局的共同模式，
提取为可复用的玩家标签规则（TagConfig 结构）。

约束：
- 标签名 2-5 字，儒雅古风（参考"中路雕将"、"暮气沉沉"），避免俗套（如"carry王"、"演员"）
- 好标签 2-3 个，源自"赢局"共同点
- 坏标签 2-3 个，源自"输局"共同点
- 单条规则的特征必须在样本里 ≥3 局命中，避免过拟合
- description 10-30 字一句话
- condition 严格符合 TagConfig schema，不允许多余字段

TagConfig schema 与示例：
[全量粘贴现有的 TagCondition 枚举定义 + 1-2 条默认标签做 few-shot]

输出严格 JSON，无多余 markdown：
{
  "good": [{"name": ..., "description": ..., "condition": ...}, ...],
  "bad":  [...]
}
```

User：

```
赢局 (N=8):  [JSON array of GameFeature]
输局 (N=12): [JSON array of GameFeature]
```

#### 输出验证（关键）

因选 B（一键采用），前端必须严格校验后才能展示：

```ts
function validateSuggestion(raw: unknown): {
  good: TagSuggestion[]
  bad: TagSuggestion[]
  droppedCount: number
} {
  // 1. JSON.parse（先剥 ```json 包裹）
  // 2. 顶层 { good: [], bad: [] } 检查
  // 3. 逐条校验：
  //    - name 长度 2-5 中文字符
  //    - description 非空
  //    - condition 走 TagCondition 校验函数（实现里复用 Tags.vue 既有的解析逻辑；
  //      若该项目尚无独立校验函数，作为前置工作在本特性里补一个轻量 validator）
  // 4. 不通过的条目静默过滤，记 droppedCount
  // 5. good 和 bad 都空 → 抛错由 UI 兜底
}
```

UI 在 modal 顶部小字提示"AI 产出 6 条建议，2 条无效已过滤"——透明但不打断。全无效 → "这次没产出有效建议" + "重新生成"。

#### 缓存

- 进 modal：有缓存直接展示，无缓存才发请求
- "🔄 重新生成"：清缓存 + 重发
- "采用" 成功：缓存里那条标 `adopted: true`，卡片置灰显示"已采用"
- sessionStorage 失败（隐私模式 / 配额满） → 静默降级到内存 Map

### 前端 UX

`views/settings/Tags.vue` 顶部按钮区加 `AI 推荐`（带 ✨ 图标，紧邻"新建标签"，`n-button type="primary"`）。

弹出 `AISuggestModal.vue`：

```
┌─ AI 看了你最近 20 把 ─────────────────────┐
│  AI 产出 6 条建议，2 条无效已过滤  [🔄 重新生成]
│ 好标签 (赢局共同点)                       │
│ ┌──────────────┐ ┌──────────────┐        │
│ │ 中路雕将     │ │ 团战收割     │ ...    │
│ │ 描述一行     │ │ 描述一行     │        │
│ │ [采用]       │ │ [采用]       │        │
│ └──────────────┘ └──────────────┘        │
│                                           │
│ 坏标签 (输局共同点)                       │
│ ┌──────────────┐ ┌──────────────┐        │
│ │ 兵线漂泊     │ │ 暮气沉沉     │        │
│ │ 描述一行     │ │ 描述一行     │        │
│ │ [采用]       │ │ [采用]       │        │
│ └──────────────┘ └──────────────┘        │
└───────────────────────────────────────────┘
```

- "采用" → 调现有 `save_user_tag_config` Tauri command；按钮立即 disable 直到 promise resolve；成功后卡片置灰显示"已采用"
- 关闭 modal → 列表自动刷新
- 重开 modal → 直接展示缓存（含已采用状态）；"重新生成"才会清缓存重新调 AI

### 边界情况

| 场景 | 行为 |
|------|------|
| 用户对局 < 5 局 | 不调 AI，modal 显示"近期对局太少（N 局），打几局再来" |
| 用户对局 5–20 局 | 正常调 AI，prompt N 改成实际值 |
| 全胜 / 全败 | prompt 里照实告诉 AI；UI 那一类显示"无（最近没有 X 局）" |
| AI 请求失败（网络 / proxy 5xx） | "AI 暂时不可用，稍后重试" + 重试按钮；console 详细记录 |
| AI 返回非 JSON | 先剥 ```json 包裹；抽不出 → "AI 输出格式异常，点重新生成" |
| AI 返回 JSON 但 schema 不合法 | 见 §AI 验证；逐条过滤；全无效 → 显示空状态 |
| 标签名超长 | 校验长度过滤；v1 不做敏感词 |
| 用户连点"采用" | 按钮立即 disable 至 promise resolve，避免双击重复保存 |
| 已采用的标签被用户从 Tags 列表删掉，再开 modal | 卡片仍灰；"重新生成"才会刷新 |
| sessionStorage 不可用 | 降级到内存 Map |

### 测试

新建 `lol-record-analysis-tauri/src/services/ai/__tests__/tagSuggest.spec.ts` (Vitest)：

- `validateSuggestion`：name 长度过滤 / 缺 condition / TagCondition variant 非法 / 部分有效保留 / 全无效抛错 / droppedCount 准确
- `extractGameFeatures`：KP 计算 / 0 队伍击杀防 NaN / queueId → queueName / position 字符串 → enum
- `buildTagSuggestPrompt`：拆分 wins/losses / 含严格 JSON 指令 / 内嵌 schema / N=0 边界
- `tagSuggest cache`：按 puuid 缓存 / forceRefresh bypass / 标记 adopted / 跨打开保留状态 / sessionStorage throw 时降级

组件测试 `AISuggestModal.spec.ts`（Vitest + Vue Test Utils）：缓存命中不发请求 / 重新生成清缓存 / 采用调 mock command 后卡片置灰 / 全无效空状态。

`RuleEditModal.spec.ts`：保存按钮在 conditions 空时 disabled / 添加删除条件 / ban 规则不显示 lock / 序列化为正确 `PickRule` 结构。

### 不在 v1 测试范围

- E2E 自动化（项目当前没有 E2E 框架）
- LCU 真机集成测试（需游戏客户端，CI 跑不了）
- AI 输出多样性测试（每次 AI 返回不一样，无固定 fixture）

---

## 公共考虑

- **i18n**：rule 名称、AI 标签名允许中文；错误提示走现有 i18n 机制（如有；没有就硬编码中文）
- **日志**：规则评估匹配/不匹配 → `log::debug!`（release 不刷屏）；AI 请求成功失败 → `log::info!` / `log::warn!`
- **可观测性**：v1 不加用户行为埋点；v2 视需要再加

---

## 手动测试计划（PR 描述里 checklist）

- [ ] 创建 pick 规则（中路 + 自家亚索 → 选 卡尔玛 锁定），开局测命中
- [ ] 把上面那条改成 hover-only，再开局测只 hover 不锁
- [ ] 删掉所有规则，验证兜底列表仍按老逻辑工作
- [ ] 创建 ban 规则（自家亚索 → ban 蕾欧娜），ban 阶段测命中
- [ ] AI 推荐：开 modal、采用一条好标签、回 Tags 页确认新规则在用
- [ ] AI 推荐：点重新生成，确认重新发请求
- [ ] AI 推荐：连续点同一张卡的"采用"两次，确认不会重复保存
- [ ] AI 推荐：手改 sessionStorage 注入坏 JSON，开 modal 看 fallback
- [ ] 大乱斗里开自动 pick + 设了 Position 规则，确认规则不命中走兜底

---

## 文件清单（新增 / 改动）

**新增**：
- `lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs`
- `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`
- `lol-record-analysis-tauri/src-tauri/src/rule_engine_tests.rs`
- `lol-record-analysis-tauri/src/components/automation/RuleEditModal.vue`
- `lol-record-analysis-tauri/src/components/automation/RuleEditModal.spec.ts`
- `lol-record-analysis-tauri/src/components/tags/AISuggestModal.vue`
- `lol-record-analysis-tauri/src/components/tags/AISuggestModal.spec.ts`
- `lol-record-analysis-tauri/src/services/ai/prompts/tag-suggest.ts`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest.ts`
- `lol-record-analysis-tauri/src/services/ai/__tests__/tagSuggest.spec.ts`

**改动**：
- `lol-record-analysis-tauri/src-tauri/src/automation.rs`（接入 `rule_engine::evaluate_*`）
- `lol-record-analysis-tauri/src-tauri/src/lib.rs` 或 `main.rs`（注册新模块）
- `lol-record-analysis-tauri/src/views/settings/Automation.vue`（嵌入规则列表 + 兜底列表）
- `lol-record-analysis-tauri/src/views/settings/Tags.vue`（加 AI 推荐按钮）
