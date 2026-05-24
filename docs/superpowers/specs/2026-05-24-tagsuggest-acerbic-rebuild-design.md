# tagSuggest 锐评重构 — 设计

> 状态：设计稿，待实施
> 日期：2026-05-24
> 作者：wnzzer

## 1. 背景

`services/ai/tagSuggest/` 模块负责基于当前用户近 20 场对局调用 AI 生成"好/坏"玩家标签规则（TagCondition），用户可在 `Tags.vue` 中采纳，采纳后对所有玩家生效。

### 现状问题

- **标签词汇高度同质化**：模型反复输出"送葬"、"咆哮王"、"独行侠"等少数几个词。根因是 `services/ai/tagSuggest/prompt.ts` 的 SYSTEM_PROMPT 内：
  - 第 13 行约束举例就直接出现"排位送葬人"
  - 第 15 行褒义候选只列 4 个词（刺客 / 咆哮王 / 独行侠 / 送葬人）
  - 第 129-141 行 ✅ 良好示例之一就是 `"name": "海克斯送葬"`
  这是典型 few-shot exemplar bias —— LLM 对 system prompt 里反复出现的具体词有强模仿倾向。

- **输入数据维度过窄**：`featureExtract.ts` 每场只喂 7 个字段（win / championId / queueId / queueName / durationMin / kda / damage / gold）。模型能区分玩家风格的维度极少，命名自然在"高 KDA / 高伤害"等少数主题上反复打转。

- **AI 三重负担**：单次调用让 AI 同时输出"name + desc + 完整 TagCondition 规则"。规则正确性挤压创作空间，命名沦为模板填空。

- **缺反重复机制**：连续多次生成产出几乎相同的词。

### 目标

- 锐评感（一针见血、有梗）成为命名核心指标
- 同一 puuid 连续生成 3 次内不出现重复名
- AI 不再写 TagCondition schema，专注创意命名
- 命名安全边界从"严禁贬义词贴好标签"放宽到"仅保留不人身攻击底线"

### 用户硬约束

- 不允许人身攻击：辱骂词、地域黑、生理攻击等永久禁用
- 标签持久化为规则后会贴给所有玩家（自己 / 对手 / 队友），命名仍需有"被贴上能笑出来"的体面
- 模式语义严守：`name` / `desc` 里的模式词必须与实际 `queue.ids` 解析出的 `queueName` 完全一致

## 2. 范围

### 涉及文件（新建 / 修改 / 不动）

**新建**：
- `src/services/ai/shared/twoStage.ts` — 共享双阶段调用编排器（与 matchDetail 改造共用）
- `src/services/ai/tagSuggest/prompts/stage1-profile.ts` — Stage 1 风格摘要 prompt
- `src/services/ai/tagSuggest/prompts/stage2-naming.ts` — Stage 2 锐评命名 prompt
- `src/services/ai/tagSuggest/vocab/good.ts` — 好标签备选词库（80-200 词，分组）
- `src/services/ai/tagSuggest/vocab/bad.ts` — 坏标签备选词库（同上）
- `src/services/ai/tagSuggest/vocab/sampler.ts` — 每次调用随机抽 30-50 个词的采样器
- `src/services/ai/tagSuggest/vocab/deduplicator.ts` — 反重复禁用名管理（puuid 维度，最近 3 次 LRU）
- `src/services/ai/tagSuggest/conditionBuilder.ts` — 根据 candidate 字段拼出 TagCondition
- `src/services/ai/tagSuggest/types.ts` — Stage 1 / Stage 2 输出类型

**修改**：
- `src/services/ai/tagSuggest/featureExtract.ts` — 字段从 7 扩到 15+
- `src/services/ai/tagSuggest/validator.ts` — schema 升级到 Stage 2 输出格式
- `src/services/ai/tagSuggest/index.ts` — 编排改为两阶段；写禁用名到 dedup 缓存
- `src/services/ai/tagSuggest/__tests__/prompt.spec.ts` — 拆分为 stage1 / stage2 测试
- `src/services/ai/tagSuggest/__tests__/validator.spec.ts` — 跟 schema 同步

**废弃**：
- `src/services/ai/tagSuggest/prompt.ts`（被 `prompts/stage1-profile.ts` 与 `prompts/stage2-naming.ts` 替代，删除）

**不动**：
- `src/components/tags/AISuggestModal.vue` 与其 spec（消费的 `TagSuggestResult` 结构保持不变）
- `src/services/ai/stream.ts`（底层 SSE 不动）
- Tauri 后端 `command/ai.rs` 与 LCU 客户端

## 3. 设计

### 3.1 featureExtract 字段扩充

```typescript
// 现状（7 字段）
interface GameFeature {
  win, championId, queueId, queueName, durationMin, kda, damage, gold
}

// 改造后（15+ 字段）
interface GameFeature {
  // ─── 现有保留 ───
  win: boolean
  championId: number
  queueId: number
  queueName: string
  durationMin: number
  kda: { k, d, a, ratio }
  damage: number
  gold: number

  // ─── 新增（基础） ───
  cs: number                      // totalMinionsKilled + neutralMinionsKilled
  killParticipation: number       // (k + a) / 队伍总击杀
  damageShare: number             // 个人伤害 / 队伍总伤害
  damageTakenShare: number        // 个人承伤 / 队伍总承伤
  wardScore: number               // 视野得分
  multiKillsMax: 0 | 2 | 3 | 4 | 5   // 单局最高多杀次数

  // ─── 新增（每分钟，跨时长比较） ───
  dpm: number
  gpm: number
  csm: number

  // ─── 新增（位置 / 角色） ───
  lane: string                    // 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'NONE'
  teamPosition: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'
}
```

LCU 字段映射在 `featureExtract.ts` 内做兜底（`teamPosition === 'UNKNOWN'` 时用召唤师技能 + 英雄 ID 推断），避免脏数据进入 AI 输入。

### 3.2 双阶段调用架构

```
buildTagSuggestPipeline(puuid, forceRefresh?)
  ↓
fetchRecentGames + featureExtract       (现有，扩字段)
  ↓
splitWinsLosses                          (现有)
  ↓
─── Stage 1 ──────────────────────────────────────────
buildStage1ProfilePrompt(wins, losses)
  ↓ (调 AI，非流式聚合)
parseStage1Result → ProfileSummary {
  styleSummary, modeBreakdown[],
  goodCandidates[], badCandidates[]
}
  ↓
─── Stage 2 ──────────────────────────────────────────
buildStage2NamingPrompt(profile, vocabSample, recentlyUsedNames)
  ↓ (调 AI，非流式聚合)
parseStage2Result → NamingResult {
  good: [{ id, name, desc }],
  bad:  [{ id, name, desc }],
  skipped: [...]
}
  ↓
─── Client Stitch ────────────────────────────────────
conditionBuilder.build(candidate) → TagCondition
  for each candidate, by id
  ↓
TagSuggestResult { good[], bad[], droppedCount, generatedAt }
  ↓
writeCache + writeDedupNames(puuid, [...names])
```

### 3.3 Stage 1 — 风格摘要 prompt

System prompt 长度目标 ~600 字，结构：

```
你是 LOL 数据分析师。给你一个玩家近期对局特征数组（赢/输分桶），
任务是提炼"这个玩家赢的时候像什么、输的时候像什么"。

【关键约束】
- 不输出标签名（命名由后续阶段完成）
- 排位（420/440）与娱乐模式必须按 queue 分桶，不能混
- 每个 candidate 必须有 sampleSize ≥ 5 局支撑

【输入说明】每场对局含字段：win / queueId / queueName / champion /
durationMin / kda / damage / dpm / gold / gpm / cs / csm /
killParticipation / damageShare / damageTakenShare / wardScore /
multiKillsMax / lane / teamPosition

【输出严格 JSON】
{
  "styleSummary": "≤120 字整体总结",
  "modeBreakdown": [
    { "queueIds": [420,440], "queueName": "单双排位",
      "winSignals": ["..."], "lossSignals": ["..."],
      "sampleSize": 12 },
    ...
  ],
  "goodCandidates": [
    {
      "id": "g1",
      "metric": "kda" | "damage" | "killParticipation" | ...,
      "queueIds": [420,440],
      "direction": ">=" | "<=",
      "threshold": 4.5,
      "countMin": 5,
      "evidence": "排位 KDA≥4.5 共 6 局，胜率 83%",
      "vibe": ["输出型", "稳健", "carry"]
    },
    ... 4-6 个
  ],
  "badCandidates": [
    {
      "id": "b1",
      ... 同上结构
      "vibe": ["独狼", "划水", "缩塔下"]
    },
    ... 4-6 个
  ]
}

【metric 白名单】
kda / kills / deaths / damage / dpm / gold / gpm / cs / csm /
killParticipation / damageShare / damageTakenShare / wardScore /
multiKillsMax

【vibe 数组】
2-4 个形容词或意象词。这些词是给命名阶段的"风格指南"，
不是最终标签名，避免使用具体梗词。
```

### 3.4 Stage 2 — 锐评命名 prompt

System prompt 长度目标 ~500 字 + 动态 vocab 注入。结构：

```
你是 LOL 锐评命名师。基于玩家风格摘要 + 候选信号 + 词库提示，
为每个候选起一个 2-7 字的锐评标签。

【创作原则】
- 锐评感优先：要有梗、能让人会心一笑
- "不人身攻击"是唯一红线（无辱骂、无地域黑、无生理攻击）
- 好/坏标签命名情绪必须匹配：
  • 好标签：褒义、中性调侃、或带制胜反讽（"严谨逆风千里"、"独狼狙击人"、
    "佛系输出位"、"刺客指挥官"）。允许带 self-aware 戏谑但不能纯贬义。
  • 坏标签：调侃或贬义（"咸鱼"、"挂机佬"、"翻车王"、"演员"、"混子"），
    禁止刺客王这种纯褒义。
- desc 10-30 字，必须与 condition 精确一致（metric / queueName / threshold / countMin）
- desc 模式名严守 queueName，不要用模糊"乱斗"代替"海克斯乱斗"

【风格摘要】
${styleSummary}

【词库提示】（可采用、可创造新词、但避免下列旧梗）
好标签备选：${vocab.good.sample(40).join('、')}
坏标签备选：${vocab.bad.sample(40).join('、')}

【禁用词】
${recentlyUsedNames.join('、')}    ← 该 puuid 近 3 次生成过的名字
"送葬人"、"carry王"、"演员王"、"送人头"  ← 永久禁用（俗套）

【候选信号】
goodCandidates: ${JSON.stringify(goodCandidates)}
badCandidates:  ${JSON.stringify(badCandidates)}

【输出严格 JSON】
{
  "good": [
    { "id": "g1", "name": "...", "desc": "..." },
    ... 3 个
  ],
  "bad": [
    { "id": "b1", "name": "...", "desc": "..." },
    ... 3 个
  ],
  "skipped": ["g4", "b5"]  // 未采用的 candidate id
}

【选择策略】
- 从 goodCandidates 中挑 3 个最有梗的命名，其余进 skipped
- bad 同上
- 创意优先，不必每个 candidate 都命名
```

### 3.5 词库设计

`vocab/good.ts` 与 `vocab/bad.ts` 每个 80-200 个备选词，分组组织：

```typescript
// vocab/good.ts
export const GOOD_VOCAB = {
  // 制胜反讽（self-aware 锐评）
  acerbic: [
    '严谨逆风千里', '独狼狙击人', '佛系输出位', '咆哮指挥官',
    '寂寞独行侠', '闷声 carry 派', '没事躲塔下',
  ],
  // 输出型
  carry: [
    '屠夫', '收割者', '战场雕花', '刺客指挥官', '夜枭',
    '雕刻师', '匕首花匠',
  ],
  // 抗压型 / 苟派
  resilient: [
    '铁布衫', '苟道神功', '心如止水', '禅修上单', '反向开团',
  ],
  // 古风 / 文艺
  classical: [
    '逆风千里', '万军丛中', '潜龙在野', '风雪夜归人', '青锋问路',
  ],
  // 职业 / 梗
  meta: [
    '微操王者', '团战大师', '一锤定音', '运营天才',
  ],
}

// vocab/bad.ts 同结构，分组 acerbic / floppy / 演员 / 古风 / 梗 等
```

`vocab/sampler.ts` 在每次调用时从这些组里加权抽 30-50 个词塞入 prompt，避免词库被 system prompt 长期固化。

### 3.6 反重复机制

`vocab/deduplicator.ts`：

```typescript
// sessionStorage key: ai_tag_suggest_used_names_${puuid}
// 存最近 3 次生成结果的 name 数组（每次 ≤6 个名字，总 ≤18）

readRecentNames(puuid: string): string[]
writeRecentNames(puuid: string, newNames: string[]): void
  // 写入时同时把第 4 次往前的丢弃，保持 ≤3 次

clearRecentNames(puuid: string): void
  // 用户在 Tags.vue 删除已采纳标签时可触发清理
```

读到的 names 数组作为 Stage 2 prompt 的 "禁用词"。永久禁用列表（"送葬人"、"carry王" 等）写死在 `prompts/stage2-naming.ts`。

### 3.7 conditionBuilder

```typescript
// conditionBuilder.ts
import type { Candidate } from './types'
import type { TagCondition } from '@renderer/types/tagCondition'

export function buildCondition(c: Candidate): TagCondition {
  return {
    type: 'history',
    filters: [
      { type: 'queue', ids: c.queueIds },
      { type: 'stat', metric: c.metric, op: c.direction, value: c.threshold },
    ],
    refresh: { type: 'count', op: '>=', value: c.countMin },
  }
}

// streak 类（连胜/连败）需要不同模板：
//   candidate.metric === 'streak' + direction='loss'|'win' + countMin → refresh.streak
// 在 buildCondition 内分支处理
```

由于规则始终由前端模板拼出，**永远不会出现 schema 错误**，废除 `validator.ts` 里对 condition 字段的复杂校验（保留对 name / desc / metric 白名单的校验）。

### 3.8 错误状态

| 错误 | 处理 |
|---|---|
| Stage 1 AI 失败 | 返回 `{ kind: 'aiError', error, stage: 1 }`，UI 显示重试按钮 |
| Stage 1 JSON 解析失败 | 自动重试 1 次；仍失败 → `parseError` |
| Stage 1 candidate < 4 个 | `kind: 'insufficient', reason: 'lowSignal'`，UI 提示 "近期数据特征不明显" |
| Stage 2 AI 失败 | 同 Stage 1，但 error 标记 `stage: 2`，且 Stage 1 JSON 已落 sessionStorage 备用 |
| Stage 2 输出名命中"禁用词"列表 | 客户端剔除该条；不足 3 个时 UI 显示 droppedCount |

### 3.9 缓存

| key | 存储 | TTL | 内容 |
|---|---|---|---|
| `ai_tag_suggest_${puuid}` | sessionStorage | session | 最终 TagSuggestResult（已有，保留） |
| `ai_tag_suggest_used_names_${puuid}` | sessionStorage | session | 反重复禁用名（新增） |
| `ai_tag_suggest_stage1_${puuid}_${ts}` | sessionStorage | 单次调用周期 | Stage 1 ProfileSummary（Stage 2 失败时备用），调完即清 |

## 4. 测试策略

### 4.1 单元测试

| 模块 | 用例 |
|---|---|
| `featureExtract.spec.ts` | 新字段从 raw game 提取正确；dpm/gpm/csm 边界（0 时长）；teamPosition 兜底（UNKNOWN → 召唤师技能推断） |
| `vocab/sampler.spec.ts` | 每次采样数量在 30-50；不同种子结果不同；同组词不会被全部采尽 |
| `vocab/deduplicator.spec.ts` | 3 次写入后读到 ≤18 个名字；第 4 次写入丢弃最早；clear 后读到空 |
| `conditionBuilder.spec.ts` | history 类型生成正确；streak 类型分支正确；与现有 TagCondition validator 反向校验通过 |
| `validator.spec.ts` | Stage 1 candidate 必填字段；Stage 2 输出 name 2-7 字；name 在永久禁用列表中被剔除 |
| `prompts/stage1-profile.spec.ts` | Snapshot 测试：prompt 包含分桶要求 / metric 白名单 / 不含具体梗词 |
| `prompts/stage2-naming.spec.ts` | Snapshot 测试：prompt 含 vocab 注入 / recentlyUsedNames 注入 / 永久禁用列表 / 不再含完整 TagCondition schema |
| `index.spec.ts` | Stage 1 失败时不调 Stage 2；缓存命中行为；dedup 写入正确 |

### 4.2 人肉验收标准

1. 连续点 5 次 "生成标签" → 看 25 个生成的名字：
   - 重复率 < 10%（"送葬"、"咆哮王" 等不应反复出现）
   - 作者本人主观打分 ≥ 3/5 有梗
2. 模式不混淆：娱乐模式标签 desc 不出现"排位"
3. 模式名一致：name 用"大乱斗"时 desc 不能用"海克斯乱斗"

## 5. 风险与权衡

| 风险 | 缓解 |
|---|---|
| Stage 1 → Stage 2 双调用让端到端延迟 2x | 在 AISuggestModal 增加阶段化进度提示（"分析数据中" → "起名中"），并将原本一次性 ~3s 的等待感分摊 |
| 词库需要人工维护 | 初版由作者写 ~150 词 ×2 = 300 词；后续可从用户已采纳的标签中半自动回收新词 |
| AI 在 Stage 2 仍可能选俗词 | 永久禁用列表 + recentlyUsedNames 双重约束；若仍出问题，可在 stage2 prompt 加 temperature 控制（如能配置） |
| TagCondition 由前端拼接，AI 无法表达"复合条件" | 现行 AI 输出的 condition 90% 都是单一 stat + count 模板，复合需求极少；如未来需要可扩展 conditionBuilder 支持 `or` / `not` |

## 6. 开放问题

无。所有 anchor 在 brainstorming 阶段已对齐。
