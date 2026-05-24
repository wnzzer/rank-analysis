# match-detail 模式感知重构 — 设计

> 状态：设计稿，待实施
> 日期：2026-05-24
> 作者：wnzzer

## 1. 背景

`services/ai/prompts/match-detail.ts` 提供两个对外函数：`buildMatchOverviewAnalysisPrompt`（全队复盘）和 `buildMatchPlayerAnalysisPrompt`（单玩家分析），均由 `MatchAIPanel.vue` 调用，输出 markdown 给用户。

### 现状问题

- **模式语义全盲**：单套 prompt 通吃所有模式。排位、大乱斗、海克斯乱斗、斗魂竞技场的"玩法规则"完全不同，但 AI 拿到的输入和 prompt 都一样。结果：
  - 大乱斗局被分析"补位"、"BP劣势"（大乱斗无 BP 无路位）
  - 海克斯局被分析"装备走向"（强化局没有标准装备系统）
  - 斗魂局被分析"上中下打野辅助"（斗魂是 2v2 random pick）

- **路位识别不可靠**：`snapshot.ts` 完全没把 LCU 的 `teamPosition` / `role` / `lane` 字段传给 AI。AI 只能从英雄、召唤师技能 spellIds 数字硬猜，错误率高。

- **AI 被要求推理不存在的数据**：现行 prompt 让 AI 判断"补位（从近期位置分布判断）"、"被针对（死亡时间分布推断）"、"英雄克制" 等，但 snapshot 里**没有**近期对局、没有 timeline 事件、没有英雄属性。结果：AI 要么编造（"看起来该玩家在补位"），要么走万金油兜底（"情有可原"）。

- **prompt overload**：单次调用让 AI 同时做 4 件事（事实总结 / 因果归因 / 5 类申辩评估 / 6 段格式化输出）。注意力分摊后每段都浅。

- **强化局 augmentMode 是个布尔**：只告诉 AI "是不是强化局"，没说明"这局英雄是随机分的、没 BP、有强化系统"等关键语义。

### 目标

- AI 输出能正确识别：玩家本局路位、是否补位、英雄熟练度、本场胜负的核心因果链
- 不同模式走不同 prompt 模板，禁止模式间概念串用
- 申辩判定从"AI 自由推理"改为"基于 TS 算好的事实"
- 归因深度从"打得不好"提升到具体因果链（"上路 10 分钟崩 → 打野 free 入侵下野 → 下路 0-5 → 全局节奏锁死"）

### 用户硬约束

- 进入对局详情可接受 ~3s 预拉延迟（拉 10 人近期 20 场对局）
- match-detail 必须三档分流：排位 / 大乱斗类 / 强化类
- "不辱骂"语气底线保留

## 2. 范围

### 涉及文件（新建 / 修改 / 不动）

**新建（共享层）**：
- `src/services/ai/shared/snapshot.ts` — 由现有 `services/ai/snapshot.ts` 重构、扩字段
- `src/services/ai/shared/modeContext.ts` — queueId / gameMode → ModeContext 描述符
- `src/services/ai/shared/recentProfile.ts` — 单玩家近期对局聚合纯函数
- `src/services/ai/shared/recentProfile.batch.ts` — 10 人并发拉取 + 模块级 LRU
- `src/services/ai/shared/twoStage.ts` — 共享双阶段调用编排器（与 tagSuggest 改造共用）
- `src/services/ai/shared/positionInfer.ts` — teamPosition='UNKNOWN' 时基于召唤师技能 + 英雄推断的兜底
- `src/services/ai/shared/summonerSpells.ts` — spellId → 中文名映射

**新建（matchDetail 模块）**：
- `src/services/ai/matchDetail/dispatcher.ts` — 三档模式路由
- `src/services/ai/matchDetail/attribution.ts` — Stage 1 编排
- `src/services/ai/matchDetail/critique.ts` — Stage 2 编排
- `src/services/ai/matchDetail/prompts/stage1-attribution.ts` — Stage 1 公共骨架
- `src/services/ai/matchDetail/prompts/stage2-critique.ts` — Stage 2 公共骨架
- `src/services/ai/matchDetail/prompts/ranked.ts` — 排位档独有规则
- `src/services/ai/matchDetail/prompts/aram.ts` — 大乱斗类独有规则
- `src/services/ai/matchDetail/prompts/augment.ts` — 强化类独有规则
- `src/services/ai/matchDetail/validator.ts` — Stage 1 输出 JSON schema 校验
- `src/services/ai/matchDetail/critiqueTemplate.ts` — Stage 2 失败时的兜底渲染模板
- `src/services/ai/matchDetail/index.ts` — 对外入口（替换 `services/ai/player-insight.ts`）
- `src/services/ai/matchDetail/types.ts` — AttributionResult / Verdict / MitigatingFactor 类型

**修改**：
- `src/services/ai/snapshot.ts` → 迁移至 `services/ai/shared/snapshot.ts` 并扩字段
- `src/services/ai/index.ts` — 重新导出新入口
- `src/services/ai/player-insight.ts` → 废弃（被 `matchDetail/index.ts` 替代）
- `src/services/ai/prompts/match-detail.ts` → 废弃（被 `matchDetail/prompts/*` 替代）
- `src/services/ai/prompts/team.ts` / `team-player.ts` — 评估是否仍被调用，若否则废弃
- `src/components/record/MatchAIPanel.vue` — 加 skeleton 阶段；接入新入口
- `src/views/MatchDetail.vue` — 进入页面时触发 `recentProfile.batch.fetch(10 人)`
- `src/composables/useMatchAIAnalysis.ts` — 改为消费双阶段调用结果

**不动**：
- Tauri 后端 `command/ai.rs` 与 `lcu/api/game_detail.rs`
- `src/services/ai/stream.ts`（底层 SSE）
- `src/services/ai/champion-names.ts`
- tagSuggest 模块（独立改造，但共享 shared/ 层）

## 3. 设计

### 3.1 snapshot 字段扩充

```typescript
// shared/snapshot.ts
export interface PlayerSnapshot {
  // ─── 现有保留 ───
  participantId, teamId, name, champion, isMe, win,
  kda, kills, deaths, assists, gold, cs, damage, taken, heal,
  turretDamage, damageShare, damageTakenShare, goldShare,
  killParticipation, perks, augments,

  // ─── 改造：spellIds 数组改为中文名 ───
  summonerSpells: string[]                  // ['闪现', '传送']

  // ─── 新增：路位识别 ───
  teamPosition: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'
  lane: string                              // LCU 原始 lane 字段，给申辩判定用
  role: string                              // 'SOLO' | 'DUO_CARRY' | 'DUO_SUPPORT' | 'NONE'

  // ─── 新增：每分钟数据 ───
  dpm: number                               // damage per minute
  gpm: number                               // gold per minute
  csm: number                               // cs per minute

  // ─── 新增：装备 / 视野 / 多杀 ───
  items: number[]                           // 6 件主装备 itemId（强化局为 []）
  trinketId: number
  wardScore: number
  controlWardsPlaced: number
  visionWardsBought: number
  multiKills: { double, triple, quadra, penta }

  // ─── 新增（核心）：该玩家近期对局摘要 ───
  recentProfile: RecentPlayerProfile | null   // null 表示拉取失败
}

export interface MatchSnapshot {
  gameId, queueName, queueId, gameMode, durationSeconds,
  teams, players,

  // ─── 改造：augmentMode 升级为 modeContext ───
  modeContext: ModeContext
}
```

### 3.2 ModeContext

```typescript
// shared/modeContext.ts
export type ModeKind = 'ranked' | 'aram' | 'augment' | 'unknown'

export interface ModeContext {
  kind: ModeKind

  /** 给 LLM 看的人话规则，直接插到 prompt 里 */
  description: string

  // 硬约束（给程序看）
  hasLanes: boolean
  hasItemBuild: boolean
  hasAugmentSystem: boolean
  championAssignment: 'pick' | 'random' | 'random-with-bench'
  isTeamMode: boolean                       // 斗魂是 2v2，单独标记
}

export function classifyMode(queueId: number, gameMode: string): ModeContext {
  // 排位 / 匹配（420/440/430/480/490/700）→ ranked
  // CHERRY 模式 / 海克斯（2400）/ 斗魂旧（1700）→ augment
  // 大乱斗（450）/ 觉醒之战（1300）/ 无限火力（900）/ 终极魔典（1900）→ aram
  // 其他 → unknown，按 aram 容忍语义兜底
}

// description 范本：
// ranked  → "5v5 召唤师峡谷排位赛。玩家自选英雄，有 BP，分上中下打野辅助五个位置。
//           可基于位置、英雄熟练度、对线克制分析。"
// aram    → "大乱斗类（${queueName}）。玩家英雄是随机分配的，无线、无打野，
//           不能用"补位""英雄选择"概念评价。评价应侧重团战参与、伤害承伤、节奏。"
// augment → "强化模式（${queueName}）。英雄随机分配，有强化系统。
//           评价应侧重强化构筑选择、套装搭配、与队友强化的协同。
//           ${isTeamMode ? '本模式为 2v2 配对，注意双人配合。' : ''}"
```

### 3.3 recentProfile 数据通道

#### 单玩家聚合（纯函数）

```typescript
// shared/recentProfile.ts
export interface RecentPlayerProfile {
  // 主玩位置
  positionDistribution: Array<{ pos: TeamPosition; ratio: number; games: number }>
  mainPosition: TeamPosition | 'UNCLEAR'    // 占比 ≥ 40% 才认，否则 UNCLEAR
  currentLanePlayedRatio: number            // 本局位置在近期的占比

  // 英雄熟练度
  championDistribution: Array<{ championId, name, games, winRate, avgKda }>
  currentChampionMastery: {
    gamesInRecent: number
    winRate: number
    avgKda: number
    isOnetrick: boolean                     // 单一英雄占比 > 50%
    isFirstTimeInRecent: boolean            // 近 20 场没玩过
  } | null

  // 近期表现
  recentWinRate: number
  recentKda: number
  streak: { kind: 'win' | 'loss'; count: number } | null

  // 关键判定（TS 算出，AI 直接消费）
  isOffRole: boolean                        // 当前 lane 占比 < 20%
  offRoleSeverity: 'none' | 'mild' | 'severe'   // <40% mild, <20% severe
}

export function buildRecentProfile(
  currentTeamPosition: TeamPosition,
  currentChampionId: number,
  recentGames: RawGame[],
  puuid: string
): RecentPlayerProfile
```

#### 批量并发拉取

```typescript
// shared/recentProfile.batch.ts
type ProfileMap = Map<string, RecentPlayerProfile | null>

const PROFILE_CACHE = new Map<string, { profile: RecentPlayerProfile; expireAt: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000

export async function fetchBatchProfiles(
  participants: Array<{ puuid: string; teamPosition: TeamPosition; championId: number }>
): Promise<ProfileMap> {
  // 并发上限 10
  // 每人 invoke('get_match_history_by_puuid', { begIndex: 0, endIndex: 19 })
  // 单失败 → 该 puuid 的 profile 为 null
  // LRU 缓存：命中直接返回
  // TTL 过期 → 重新拉
}
```

**关键设计**：把"判断逻辑"前移到 TS 层。`isOffRole`、`isOnetrick`、`isFirstTimeInRecent` 是 TS 算出的 fact，AI 拿到的是判定好的 bool，**不会编造**。

### 3.4 双阶段调用架构

```
MatchDetail.vue 挂载
  ↓
1. 拿到 game (LCU)
  ↓
2. modeContext = classifyMode(queueId, gameMode)
  ↓
3. participants = game.participants.map(p => {puuid, teamPosition, championId})
   profiles = await fetchBatchProfiles(participants)   // 10 并发，~2-3s
   [UI 显示 skeleton]
  ↓
4. snapshot = buildMatchSnapshot(game, profiles, modeContext)
  ↓
5. attribution = await runAttributionStage(snapshot)
     [stage 1: 静默累积，结束才校验 JSON]
     调 prompts/stage1-attribution.ts + 模式追加规则
  ↓
6. critique = await runCritiqueStage(snapshot, attribution)
     [stage 2: 流式渲染 markdown]
     调 prompts/stage2-critique.ts
  ↓
UI 渲染
```

### 3.5 Stage 1 — 归因 prompt（公共骨架 + 模式追加）

`prompts/stage1-attribution.ts` 公共骨架（~700 字）：

```
你是 LOL 单场归因分析师。基于下面这场比赛的快照 + 玩家近期摘要，
判断每个值得点名的玩家归类为：尽力 / 犯罪 / 被爆 / 被连累 / 缚地灵 / 正常，
并给出数据证据。

【模式上下文】
${snapshot.modeContext.description}

hasLanes: ${snapshot.modeContext.hasLanes}
hasItemBuild: ${snapshot.modeContext.hasItemBuild}
championAssignment: ${snapshot.modeContext.championAssignment}

【硬性规则】
- 只能基于 snapshot 实际存在的字段做结论
- hasLanes=false 时禁止提到上中下打野辅助等位置概念
- championAssignment='random' 时禁止提到"补位"、"英雄选择失误"、"BP劣势"
- hasItemBuild=false 时禁止评价装备走向
- snapshot.players[i].recentProfile=null 时禁止判断"是否补位"、"熟练度"
- snapshot.players[i].recentProfile.isOffRole=true 时可采用申辩降级
  反之则不要瞎编"可能在补位"

【TS 已算好的事实】
- isOffRole: bool（是否补位）
- offRoleSeverity: 'none' | 'mild' | 'severe'
- currentChampionMastery.isFirstTimeInRecent: bool
- currentChampionMastery.isOnetrick: bool
直接采用，不要重新推断。

【标签定义】
- 尽力：数据明显高于队内均值（伤害/经济/参团率任意 2 项 ≥ 队内前 2）+ 该队伍胜
- 犯罪：数据明显低于队内均值（如死亡数最多 + 参团 < 30% + KDA 倒数）+ 该队伍输
- 被爆：deaths 高 + damageShare 低 + goldShare 低，且无 isOffRole 等申辩
- 被连累：个人数据合格但队伍输（damageShare ≥ 25% + KDA ≥ 团队均值，但 win=false）
- 缚地灵：killParticipation < 团队平均 - 15% + assists 低 + cs/damage 不低
- 正常：以上都不符合

【输出严格 JSON】
{
  "winReason": "为什么胜方赢/败方输的核心因果链，2-3 句",
  "verdicts": [
    {
      "participantId": int,
      "name": "玩家名",
      "label": "尽力" | "犯罪" | "被爆" | "被连累" | "缚地灵" | "正常",
      "evidenceMetrics": [
        { "metric": "kda", "value": 1.2, "teamRank": 5, "note": "队内倒数第一" },
        ... 至少 3 条
      ],
      "mitigatingFactors": [
        // 只在 label 为负面（犯罪/被爆/缚地灵）时填，
        // 且必须基于 snapshot 数据。
        // 可选 factor:
        //   'off-role' (需 isOffRole=true)
        //   'first-time-champion' (需 isFirstTimeInRecent=true)
        //   'team-collapse' (需 队伍其他 ≥2 人 label='犯罪')
        //   'targeted' (需 deaths 集中在前 10 分钟 — 当前 snapshot 无 timeline 暂不可用)
        { "factor": "off-role", "support": "isOffRole=true, mainPosition=JUNGLE, 本局打 TOP" }
      ],
      "finalCall": "一句话归因，必须引用 ≥2 个数字"
    }
  ]
}

【对哪些玩家出 verdict】
- 必出：双方击杀 TOP1（最尽力）/ 死亡 TOP1（最可能犯罪）/ 当前用户（isMe=true）
- 可选：其他显著表现（damageShare > 35% 或 < 12%、KDA 极端）
- 总数 4-7 个 verdict
```

各档**追加规则**（注入到公共骨架之后）：

#### ranked 追加
```
启用 lane 分析：
- 对每个玩家，找同 lane 的敌方对位
- 评价 1v1 表现（金币差 / CS 差 / KDA 比较）
- 若 isOffRole=true，对位比较失效，应在 mitigatingFactors 中明确标记

启用装备走向（items 字段）：
- 关键装备命中度（如 ADC 没出第一件神话装、坦克没出第一件防装）

启用英雄克制：
- 仅在玩家近期英雄选择有数据支撑时（非 isFirstTimeInRecent）
- snapshot 不含英雄属性表，可基于通用 LOL 常识但保守表述
```

#### aram 追加
```
关闭 lane 分析。所有玩家不区分位置。

评价重点：
- killParticipation 高于队内平均 → 团战核心
- damageTakenShare 高 → 抗压前排
- damageShare 高 → 输出核心
- multiKills 多 → 团战爆发能力

不要评价：
- 个人对线
- BP / 英雄选择（英雄是随机的）
- 补位（无路位概念）
```

#### augment 追加
```
关闭 lane 分析。关闭装备走向（items=[]）。

评价重点：
- augments[] 数量与套装搭配（augments[] 长度应 = 6，少于 6 表示局未打完）
- 与队友 augments 的协同（如双输出 augment 都点伤害是否过于偏科）
- KDA、damageShare 与 augments 的契合度

isTeamMode=true 时（斗魂 CHERRY）额外：
- 评价 2v2 双人配合
- 4 个队伍排名（teams[] 顺序）

不要评价：
- 装备出装顺序
- 对线
- 英雄选择
```

### 3.6 Stage 2 — 锐评 prompt

`prompts/stage2-critique.ts`（~300 字）：

```
你是 LOL 锐评写手。基于已经给出的归因 JSON，转写为锐评 markdown。

【输入】
${attributionJson}

【模式上下文】
${snapshot.modeContext.description}

【输出 markdown，严格按下面模板】

## 一句话定论
{用一句锐评点明胜负 + 当局最显眼的人，要有梗}

## 谁尽力了
- {名字}：{锐评一句} — {数字证据}

## 谁要背锅
- {名字}：{锐评一句} — {数字证据}
- 没有明显背锅时，写"本局没人能甩锅，混战自有命数"

## 谁被打爆 / 被连累
- {名字 + 哪类}：{锐评一句} — {数字证据 + mitigatingFactor}
- 没有则写"无明显被针对者"

## 关键证据
- 3-5 条 bullet，每条带 ≥1 个数字

【语气原则】
- 锐评感优先：要有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系等）
- mitigatingFactors 必须体现在评价中（"在补位"应有相应宽容措辞）
- 数字证据必须来自 evidenceMetrics 字段，不能编造

【词库提示】（可采用、可创造新词）
${vocab.sample(30).join('、')}
```

`vocab` 与 tagSuggest 共享 `services/ai/tagSuggest/vocab/` 模块。

### 3.7 校验逻辑

`matchDetail/validator.ts`：

```typescript
// 校验 Stage 1 输出 JSON
export function validateAttribution(raw: string, snapshot: MatchSnapshot): {
  ok: true
  value: AttributionResult
} | {
  ok: false
  error: string
}

// 关键校验：
// 1. JSON parse
// 2. verdicts 数量 4-7
// 3. evidenceMetrics 长度 ≥ 3
// 4. label 在 enum 内
// 5. mitigatingFactors 的 factor 必须在 snapshot 数据中有支撑：
//    - factor='off-role' → snapshot.players[i].recentProfile.isOffRole 必须 true
//    - factor='first-time-champion' → isFirstTimeInRecent 必须 true
//    - factor='team-collapse' → 同队其他 ≥2 人 verdict.label = '犯罪'
//    若 mitigating 与数据不符 → return ok:false
//
// 校验失败 → 自动重试 1 次；仍失败 → 接受原输出但 console.warn
```

### 3.8 Dispatcher

```typescript
// matchDetail/dispatcher.ts
import { classifyMode } from '../shared/modeContext'
import * as rankedPrompt from './prompts/ranked'
import * as aramPrompt from './prompts/aram'
import * as augmentPrompt from './prompts/augment'

export function getModePromptAddon(modeContext: ModeContext) {
  switch (modeContext.kind) {
    case 'ranked':  return rankedPrompt
    case 'aram':    return aramPrompt
    case 'augment': return augmentPrompt
    case 'unknown': return aramPrompt   // 兜底
  }
}
```

### 3.9 UI 改动

#### MatchDetail.vue 流程

```vue
<script setup>
const { game } = useMatchDetail()
const profilesLoading = ref(true)
const profiles = ref<ProfileMap | null>(null)
const aiState = ref<'idle' | 'profiles' | 'attribution' | 'critique' | 'done' | 'error'>('idle')

onMounted(async () => {
  aiState.value = 'profiles'
  profiles.value = await fetchBatchProfiles(game.value.participants.map(...))
  aiState.value = 'attribution'
  // 接下来由 MatchAIPanel 自己消费 profiles + game 触发 stage1/stage2
})
</script>
```

#### MatchAIPanel.vue 加 skeleton 阶段

UI 文案：
- `aiState='profiles'`：骨架屏 + "正在加载玩家近期数据..."
- `aiState='attribution'`：骨架屏 + "AI 正在归因..."（Stage 1 静默累积，不展示中间 JSON）
- `aiState='critique'`：开始流式渲染 markdown
- `aiState='error'`：错误状态卡片 + 重试按钮 + 兜底简版报告（见 3.10）

### 3.10 错误状态 & 兜底

| 错误 | 处理 |
|---|---|
| recentProfile 部分失败（N < 10） | 静默继续；对应玩家 profile=null；prompt 自动剥离该玩家的 isOffRole 等判定 |
| recentProfile 全失败 | UI 显示告警 "近期数据获取失败，分析准确度可能降低"；继续走 AI 调用，prompt 不含 profile |
| Stage 1 AI 失败 | UI 显示 "AI 归因失败" 卡片 + 重试按钮 + 一份**纯数字快照**（不调用 Stage 2，不编造锐评） |
| Stage 1 JSON 解析失败 | 自动重试 1 次；仍失败 → 同上 |
| Stage 1 校验失败（mitigating 与数据不符） | 重试 1 次；仍失败 → 接受原输出但 warn |
| Stage 2 AI 失败 | 用 Stage 1 JSON + `critiqueTemplate.ts` 兜底渲染"简版报告"：列出 winReason + 每个 verdict 的 label + finalCall。不展示锐评但保证用户能看到结构化结果 |

### 3.11 缓存

| key | 存储 | 内容 | TTL |
|---|---|---|---|
| `recentProfile.batch` 模块内 LRU | 内存 | puuid → profile | 10 min |
| `ai_match_detail_stage1_${gameId}` | sessionStorage | Stage 1 AttributionResult | session |
| `ai_match_detail_critique_${gameId}` | sessionStorage | Stage 2 markdown | session |

同一 gameId 再次打开 MatchDetail 时：
1. recentProfile 命中模块 LRU 直接拿（如未过期）
2. Stage 1 / Stage 2 结果命中 sessionStorage 直接渲染，不再调 AI

## 4. 测试策略

### 4.1 单元测试

| 模块 | 用例 |
|---|---|
| `shared/modeContext.spec.ts` | 已知 queueId 分类正确（420→ranked、450→aram、2400→augment、CHERRY→augment、1700→augment、未知→aram 兜底）；description 不含逻辑错误（augment.description 不能提到"BP"） |
| `shared/positionInfer.spec.ts` | 召唤师技能含惩戒 → JUNGLE；含传送 + 战士英雄 → TOP；含点燃 + 法师英雄 → MIDDLE；ADC 英雄 → BOTTOM；治疗 + 辅助英雄 → UTILITY |
| `shared/recentProfile.spec.ts` | mainPosition 占比 ≥ 40% 才认；isOffRole 阈值 < 20%；isFirstTimeInRecent 在近 20 场无该英雄时为 true；isOnetrick 单英雄 > 50% |
| `shared/recentProfile.batch.spec.ts` | 10 个并发；1 个失败时其余 9 个成功返回；LRU 命中行为；TTL 过期重拉 |
| `shared/snapshot.spec.ts` | 扩字段从 raw game 提取正确；dpm/gpm/csm 计算（0 时长边界）；augment 模式 items=[]；summonerSpells 转中文名 |
| `matchDetail/dispatcher.spec.ts` | 三档路由正确；unknown 兜底走 aram |
| `matchDetail/validator.spec.ts` | mitigating 与 snapshot 不符时 ok:false；verdicts 数量越界时 ok:false |
| `matchDetail/prompts/*` snapshot 测试 | ranked.ts prompt 含 lane 字样；aram.ts 不含；augment.ts 含 augments 评价 |
| `matchDetail/attribution.spec.ts` | Stage 1 失败时不调 Stage 2；缓存命中行为 |
| `matchDetail/critique.spec.ts` | Stage 2 失败时走 critiqueTemplate 兜底渲染 |

### 4.2 fixture 准备

从作者本人近期对局中抓三种模式各 1 局作为测试 fixture：
- `fixtures/ranked-420.json` — 排位单双
- `fixtures/aram-450.json` — 大乱斗
- `fixtures/augment-2400.json` — 海克斯乱斗

puuid 哈希化处理（用 sha256 截断）避免泄露真实身份。

### 4.3 人肉验收

| 项 | 验收办法 |
|---|---|
| 模式准确 | 各模式各 3 局：①大乱斗局不能出现"上中下""BP""补位" ②海克斯局不能说"装备出错" ③排位局有 lane 和对位玩家比较 |
| 补位识别 | 找 1 局自己实际在补位的对局 → AI 输出含"在补位"或"非主玩位置"语句 + 申辩降级生效 |
| 归因深度 | 各模式 3 局，AI 输出有"决定性转折"或"为什么这边输"的具体因果链（非"打得不好"这种空泛句） |
| 锐评感 | 各模式各 3 局，作者本人主观打分 ≥ 3/5 有梗、不空泛、不套话 |
| 错误兜底 | 手动断网模拟 Stage 1 失败 → UI 显示纯数字快照 + 重试按钮 |

## 5. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 进入 MatchDetail 时 ~3s skeleton 让用户等 | 用骨架屏 + 阶段化文案分摊感知。后续可考虑 MatchHistory 列表悬停时预热 LRU |
| 10 并发 LCU 请求峰值 | LCU 本身是本地服务，并发 10 个 query 历史的开销很小（vs 公网 API）；保险起见 `recentProfile.batch.ts` 内部用并发限制 ≤10 |
| Stage 1 校验失败重试可能让总耗时翻倍 | 重试上限 1 次；超过即接受原输出，UI 不感知 |
| 兜底"简版报告"和锐评 markdown 体验差异大 | 设计 `critiqueTemplate.ts` 时让简版也带一定语气（如 "本局结论：{winReason}，主要责任人：{criminalNames}"），降低落差 |
| timeline 数据缺失导致"被针对"申辩永远不可用 | 当前 spec 不引入 timeline（要改 Rust 后端）；'targeted' factor 在 prompt 中标为"暂不可用"，留作未来 spec |

## 6. 开放问题

1. **`prompts/team.ts` / `team-player.ts` 是否仍被使用？** 在实施第一步时确认是否还有调用方，决定保留或废弃。
2. **斗魂 2v2 配对识别**：CHERRY 模式的 4 个队伍配对（同组队友是谁）需要从 raw game 数据中找。实施时确认 `teamId` 字段是否能区分（CHERRY 应该是 0/1/2/3 四队，每队 2 人）。
3. **MatchAIPanel.vue 的 props 变化**：当前组件如何拿到 game 数据，决定改造时是新增 prop（profiles）还是内部 fetch。实施时根据现状决定。
