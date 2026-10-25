/**
 * Stage 1 attribution 输出校验器。
 *
 * 分层校验（结构硬毙，数据层一律按快照清洗/重写而非硬毙）：
 * 1. JSON parseable（兼容 ```json fenced 包装）
 * 2. Shape: verdicts 4-7 / evidenceMetrics ≥ 3 / label in enum；证据按快照重写
 * 3. 英雄/分路/胜负方回填
 * 4. 标签按量化定义复核（降级/升级）
 * 5. finalCall / winReason 数字接地
 * 6. 每条 mitigatingFactor 必须与 snapshot 实际数据吻合
 *
 * 返回类型与 shared/twoStage.ts 的 ParseOutcome 兼容。
 */

import { RANKED_METRICS, type MatchSnapshot, type RankedMetric } from '../shared/snapshot'
import { extractNumbers, stripUngroundedSentences } from './postprocess'
import type {
  AttributionResult,
  EvidenceMetric,
  Verdict,
  VerdictLabel,
  MitigatingFactorKind
} from './types'

export type ValidateOutcome = { ok: true; value: AttributionResult } | { ok: false; error: string }

const ALLOWED_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  '尽力',
  '犯罪',
  '被爆',
  '被连累',
  '缚地灵',
  '正常'
])

const ALLOWED_MITIGATING: ReadonlySet<MitigatingFactorKind> = new Set<MitigatingFactorKind>([
  'off-role',
  'first-time-champion',
  'team-collapse',
  'targeted'
])

const NEGATIVE_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  '犯罪',
  '被爆',
  '缚地灵',
  '被连累'
])

export function validateAttribution(rawJson: string, snapshot: MatchSnapshot): ValidateOutcome {
  // ─── Layer 1: parse JSON (strip fenced wrappers) ───
  const stripped = stripFencedCodeBlock(rawJson)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'parsed value is not an object' }
  }

  const candidate = parsed as Partial<AttributionResult>
  if (typeof candidate.winReason !== 'string') {
    return { ok: false, error: 'winReason must be a string' }
  }
  if (!Array.isArray(candidate.verdicts)) {
    return { ok: false, error: 'verdicts must be an array' }
  }

  // ─── Layer 2: shape ───
  if (candidate.verdicts.length < 4 || candidate.verdicts.length > 7) {
    return {
      ok: false,
      error: `verdicts length ${candidate.verdicts.length} out of bounds [4, 7]`
    }
  }

  for (let i = 0; i < candidate.verdicts.length; i++) {
    const v = candidate.verdicts[i] as Partial<Verdict>
    if (typeof v?.participantId !== 'number') {
      return { ok: false, error: `verdict[${i}].participantId must be a number` }
    }
    if (typeof v.name !== 'string') {
      return { ok: false, error: `verdict[${i}].name must be a string` }
    }
    if (!v.label || !ALLOWED_LABELS.has(v.label as VerdictLabel)) {
      return { ok: false, error: `verdict[${i}].label invalid: ${String(v.label)}` }
    }
    if (typeof v.finalCall !== 'string') {
      return { ok: false, error: `verdict[${i}].finalCall must be a string` }
    }
    if (!Array.isArray(v.evidenceMetrics)) {
      return { ok: false, error: `verdict[${i}].evidenceMetrics must be an array` }
    }
    if (v.evidenceMetrics.length < 3) {
      return {
        ok: false,
        error: `verdict[${i}].evidenceMetrics length ${v.evidenceMetrics.length} < 3`
      }
    }
    // 逐条清洗而非硬毙：真机复现模型偶发把 value 写成 "36.3%" 字符串，
    // 一条坏证据不该废掉整份多 verdict 归因（连重试都会同样失败 → 复盘静默不可用）。
    // 字符串数字/百分比 coerce 成 number；救不动的摘除；全摘光的 verdict 在下方剔除。
    v.evidenceMetrics = v.evidenceMetrics
      .map(m => {
        if (!m || typeof m.metric !== 'string') return null
        // 类型上 value 是 number，但这里是未信任的模型 JSON——按 unknown 处理
        const raw: unknown = (m as { value?: unknown }).value
        if (typeof raw === 'number' && Number.isFinite(raw)) return m
        if (typeof raw === 'string') {
          const parsedValue = Number(raw.replace(/[%,，\s]/g, ''))
          if (Number.isFinite(parsedValue)) return { ...m, value: parsedValue }
        }
        return null
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
    // 证据接地:数值/排名/注释一律以快照为准重写,快照里对不上的指标摘除
    const playerSnap = snapshot.players.find(p => p.participantId === v.participantId)
    v.evidenceMetrics = playerSnap
      ? v.evidenceMetrics
          .map(m =>
            groundEvidenceMetric(m.metric, playerSnap, teamSizeOf(snapshot, playerSnap.teamId))
          )
          .filter((m): m is EvidenceMetric => m !== null)
      : []
    if (!Array.isArray(v.mitigatingFactors)) {
      return {
        ok: false,
        error: `verdict[${i}].mitigatingFactors must be an array (use [] when empty)`
      }
    }
  }
  // 清洗后证据被摘光的 verdict 整条剔除（无数字支撑的判定不给用户看）
  candidate.verdicts = candidate.verdicts.filter(v => (v as Verdict).evidenceMetrics.length > 0)
  if (candidate.verdicts.length === 0) {
    return { ok: false, error: 'all verdicts dropped after evidence sanitization' }
  }

  const result = candidate as AttributionResult

  // ─── Layer 3: 确定性回填（快照事实覆盖模型输出） ───
  // 英雄/分路/胜负方是快照里的既有事实，由 TS 写入而非信任模型——Stage 2 锐评
  // 曾因缺这些字段把下路写成"中路核弹手"、把败方塞进"谁尽力了"（真机截图复现）。
  for (const v of result.verdicts) {
    const playerSnap = snapshot.players.find((p: any) => p.participantId === v.participantId) as any
    if (!playerSnap) {
      v.champion = undefined
      v.teamPosition = undefined
      v.teamResult = undefined
      continue
    }
    v.champion = playerSnap.champion
    v.teamPosition = playerSnap.teamPosition
    v.teamResult = playerSnap.win ? '胜方' : '败方'
  }

  // ─── Layer 4: 标签量化复核 ───
  // prompt 里的标签量化标准 qwen-flash 并不总遵守(真机复现:74% 参团被标"缚地灵"、
  // 胜方被标"被连累";2026-10-25 9 局 60 条 verdict 有 15 条犯罪/被连累不满足定义,
  // 另有 16/8/5、35.5% 伤害的败方打野被标"正常")。可量化的标签由 TS 复核:
  // 不符降级"正常"(不进任何人物章节,连带矛盾文案一起消失);满足被连累却标正常的升级。
  // finalCall 随标签变化一并重写:残留的指控文案会把 Stage 2 带偏(真机复现)。
  for (const v of result.verdicts) {
    const playerSnap = snapshot.players.find(p => p.participantId === v.participantId)
    if (!playerSnap) continue
    const team = snapshot.players.filter(p => p.teamId === playerSnap.teamId)
    const next = reviewLabel(v.label, playerSnap, team)
    if (next === v.label) continue
    v.label = next
    v.finalCall = next === '正常' ? '整体表现正常，无功无过' : draggedFinalCall(playerSnap)
  }
  // 补漏:满足被连累却根本没进名册的败方(真机 15 局漏 2 人),名册未满 7 条时补上
  for (const p of snapshot.players) {
    if (result.verdicts.length >= 7) break
    if (result.verdicts.some(v => v.participantId === p.participantId)) continue
    const team = snapshot.players.filter(x => x.teamId === p.teamId)
    if (reviewLabel('正常', p, team) !== '被连累') continue
    const teamSize = team.length
    result.verdicts.push({
      participantId: p.participantId,
      name: p.name,
      label: '被连累',
      evidenceMetrics: ['damageShare', 'kda', 'killParticipation']
        .map(m => groundEvidenceMetric(m, p, teamSize))
        .filter((m): m is EvidenceMetric => m !== null),
      mitigatingFactors: [],
      finalCall: draggedFinalCall(p),
      champion: p.champion,
      teamPosition: p.teamPosition,
      teamResult: '败方'
    })
  }

  // ─── Layer 5: 文本数字接地 ───
  // finalCall / winReason 里的数字同样会张冠李戴(真机:把队友的 20 杀写给盲僧)。
  // 数字对得上方向却写反(落后写成领先)同样剔除,见 stripLaneContradictions。
  // 含快照外数字的句子剔除;finalCall 剔光则用接地后的证据注释兜底。
  for (const v of result.verdicts) {
    const playerSnap = snapshot.players.find(p => p.participantId === v.participantId)
    if (!playerSnap) continue
    const allowed = extractNumbers(
      JSON.stringify(playerSnap) + v.evidenceMetrics.map(m => m.note ?? '').join(' ')
    )
    v.finalCall =
      stripLaneContradictions(stripUngroundedSentences(v.finalCall, allowed), playerSnap) ||
      v.evidenceMetrics
        .slice(0, 2)
        .map(m => m.note)
        .join('；')
  }
  result.winReason =
    stripUngroundedSentences(
      result.winReason,
      extractNumbers(JSON.stringify(snapshot.players) + JSON.stringify(snapshot.teams))
    ).trim() || '胜负归因见下方各玩家证据'

  // ─── Layer 6: 缓解因子接地（清洗，不再硬毙） ───
  // 缓解因子只是负面 verdict 上的解释性标注。模型若给出与 snapshot 对不上的因子，
  // 摘掉该因子即可：既不把未证实的说法放给用户，也不因一个小标注就废掉整份多 verdict
  // 分析（历史上 stage1 最常见的失败正是这层硬毙）。JSON / 结构仍严格校验。
  // 必须在标签复核之后:team-collapse 依赖同队最终 label。
  for (const v of result.verdicts) {
    if (v.mitigatingFactors.length === 0) continue

    // 因子只在负面 label 上有意义；非负面一律摘除。
    if (!NEGATIVE_LABELS.has(v.label)) {
      v.mitigatingFactors = []
      continue
    }

    const playerSnap = snapshot.players.find((p: any) => p.participantId === v.participantId)
    if (!playerSnap) {
      // 找不到对应玩家，无从 grounding，摘除全部因子但保留 verdict。
      v.mitigatingFactors = []
      continue
    }

    v.mitigatingFactors = v.mitigatingFactors.filter(m =>
      isFactorGrounded(m.factor, v, playerSnap, result, snapshot)
    )
  }

  return { ok: true, value: result }
}

/**
 * 按 prompt 的量化定义复核标签,返回复核后的标签。
 * - 尽力:胜方 + 伤害占比/经济占比/参团率中至少 2 项进入队内前 2
 * - 犯罪:败方 + 「死亡队内最多 / 参团率 < 30% / KDA 队内最低」至少满足 2 项
 * - 被连累:败方 + 伤害占比 ≥ 25% + KDA ≥ 队内均值
 * - 缚地灵:参团率低于队内均值 15 个百分点以上
 * - 被爆:定义含"高/低"等无阈值描述,不复核
 * 标签不成立(或本就是正常)时,满足被连累者落到被连累,否则正常——
 * 真机复现:16/8/5、35.5% 伤害的败方盲僧被误标犯罪,只降成正常就把真正的被连累者埋了。
 */
function reviewLabel(label: VerdictLabel, p: SnapshotPlayer, team: SnapshotPlayer[]): VerdictLabel {
  const avg = (pick: (x: SnapshotPlayer) => number): number =>
    team.reduce((s, x) => s + pick(x), 0) / Math.max(team.length, 1)
  const dragged = !p.win && p.damageShare >= 25 && p.kda >= avg(x => x.kda)

  const holds = ((): boolean => {
    switch (label) {
      case '尽力': {
        const ranks = [
          p.teamRanks.damageShare,
          p.teamRanks.goldShare,
          p.teamRanks.killParticipation
        ]
        return p.win && ranks.filter(r => r <= 2).length >= 2
      }
      case '犯罪': {
        const hits = [
          p.deaths === Math.max(...team.map(x => x.deaths)),
          p.killParticipation < 30,
          p.kda === Math.min(...team.map(x => x.kda))
        ].filter(Boolean).length
        return !p.win && hits >= 2
      }
      case '被连累':
        return dragged
      case '缚地灵':
        return p.killParticipation < avg(x => x.killParticipation) - 15
      case '被爆':
        return true
      default:
        return false
    }
  })()
  if (holds) return label
  return dragged ? '被连累' : '正常'
}

/** 被连累(TS 复核升级 / 补漏)的确定性 finalCall */
function draggedFinalCall(p: SnapshotPlayer): string {
  return `伤害占比 ${p.damageShare}%、KDA ${p.kda} 均不低于队内水准，但队伍落败`
}

/**
 * 剔除与对位差值方向相反的分句(按逗号/句末标点切分),并去掉残留的句尾逗号。
 * 真机:Muggle丶 对位输出落后 11567,finalCall 写成「对位盲僧伤害领先 11567」——
 * 绝对值是真的,数字白名单拦不住,只能按方向词核对。
 */
function stripLaneContradictions(text: string, p: SnapshotPlayer): string {
  const opp = p.vsLaneOpponent
  const diffs = opp ? [opp.goldDiff, opp.csDiff].filter(d => d !== 0) : []
  const kept = text
    .split(/(?<=[，,。！？；!?;])/)
    .filter(
      clause =>
        !diffs.some(d =>
          new RegExp(`${d > 0 ? '落后' : '领先'}\\s*${Math.abs(d)}(?![\\d.])`).test(clause)
        )
    )
  return kept
    .join('')
    .trim()
    .replace(/[，,]$/, '')
}

function teamSizeOf(snapshot: MatchSnapshot, teamId: number): number {
  return snapshot.players.filter(p => p.teamId === teamId).length
}

/**
 * 判断单个缓解因子是否被 snapshot 数据支撑。未在白名单、或证据对不上的一律返回
 * false（调用方据此摘除）。`targeted` 因 snapshot 暂无 timeline，恒不成立。
 */
function isFactorGrounded(
  factor: MitigatingFactorKind,
  v: Verdict,
  playerSnap: any,
  result: AttributionResult,
  snapshot: MatchSnapshot
): boolean {
  if (!ALLOWED_MITIGATING.has(factor)) return false
  switch (factor) {
    case 'off-role':
      return playerSnap.recentProfile?.isOffRole === true
    case 'first-time-champion':
      return playerSnap.recentProfile?.currentChampionMastery?.isFirstTimeInRecent === true
    case 'team-collapse': {
      const sameTeamCriminals = result.verdicts.filter(
        other =>
          other.participantId !== v.participantId &&
          snapshot.players.find((p: any) => p.participantId === other.participantId)?.teamId ===
            playerSnap.teamId &&
          other.label === '犯罪'
      )
      return sameTeamCriminals.length >= 2
    }
    case 'targeted':
      // snapshot 暂无 timeline 数据，无法证实 → 摘除。
      return false
    default:
      return false
  }
}

type SnapshotPlayer = MatchSnapshot['players'][number]

/** 指标中文名(证据注释用) */
const METRIC_CN: Record<RankedMetric, string> = {
  kda: 'KDA',
  kills: '击杀',
  deaths: '死亡',
  assists: '助攻',
  gold: '经济',
  cs: '补刀',
  damage: '输出',
  taken: '承伤',
  heal: '治疗',
  turretDamage: '推塔伤害',
  damageShare: '伤害占比',
  damageTakenShare: '承伤占比',
  goldShare: '经济占比',
  killParticipation: '参团率',
  dpm: '分均输出',
  gpm: '分均经济',
  csm: '分均补刀'
}

/** 计数类指标的排名用「最多/最少」,其余用「最高/最低」 */
const COUNT_METRICS = new Set<RankedMetric>(['kills', 'deaths', 'assists', 'cs'])

/**
 * 对位差值字段(snapshot.vsLaneOpponent.*) → 快照原值字段 / 中文名 / 方向词。
 * 死亡差用「多/少」:多死不是「领先」。
 */
const LANE_DIFF_METRICS = {
  goldDiff: { field: 'gold', cn: '经济', words: ['领先', '落后'] },
  csDiff: { field: 'cs', cn: '补刀', words: ['领先', '落后'] },
  kdaDiff: { field: 'kda', cn: 'KDA', words: ['领先', '落后'] },
  killsDiff: { field: 'kills', cn: '击杀', words: ['多', '少'] },
  deathsDiff: { field: 'deaths', cn: '死亡', words: ['多', '少'] },
  damageShareDiff: { field: 'damageShare', cn: '伤害占比', words: ['领先', '落后'] }
} as const
type LaneDiffField = keyof typeof LANE_DIFF_METRICS

/** 模型常写的旧式对位指标名 → vsLaneOpponent 字段 */
const LANE_METRIC_ALIASES: Record<string, LaneDiffField> = {
  goldDiffVsLaneOpp: 'goldDiff',
  csDiffVsLaneOpp: 'csDiff',
  kdaDiffVsLaneOpp: 'kdaDiff'
}

/** `vsLaneOpponent.goldDiff` / 旧式别名 → 对位差值字段;非对位指标返回 null */
function laneDiffFieldOf(metric: string): LaneDiffField | null {
  const field = metric.startsWith('vsLaneOpponent.')
    ? metric.slice('vsLaneOpponent.'.length)
    : LANE_METRIC_ALIASES[metric]
  return field && field in LANE_DIFF_METRICS ? (field as LaneDiffField) : null
}

const MULTI_KILL_CN = { double: '双杀', triple: '三杀', quadra: '四杀', penta: '五杀' } as const

function rankPhrase(metric: RankedMetric, rank: number, teamSize: number): string {
  const [hi, lo] = COUNT_METRICS.has(metric) ? ['最多', '最少'] : ['最高', '最低']
  if (rank === 1) return `队内${hi}`
  if (rank >= teamSize) return `队内${lo}`
  return `队内第 ${rank}`
}

/**
 * 把模型声称的一条证据重写为快照事实:value / teamRank / note 全由 TS 生成。
 * qwen-flash 真机 9 局:排名错 45%、对位差值 12 条错 9 条(把队友的差值抄给别人),
 * 注释里的数字还会与 value 自相矛盾——模型只负责「挑哪几项」,数字一律不信。
 * @returns 快照无此指标 / 值缺失 / 无对位时返回 null(调用方摘除)
 */
export function groundEvidenceMetric(
  metric: string,
  p: SnapshotPlayer,
  teamSize: number
): EvidenceMetric | null {
  if ((RANKED_METRICS as readonly string[]).includes(metric)) {
    const m = metric as RankedMetric
    const value = p[m]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const rank = p.teamRanks[m]
    return {
      metric,
      value,
      teamRank: rank,
      note: `${METRIC_CN[m]} ${value}，${rankPhrase(m, rank, teamSize)}`
    }
  }
  const laneField = laneDiffFieldOf(metric)
  if (laneField) {
    const opp = p.vsLaneOpponent
    if (!opp) return null
    const spec = LANE_DIFF_METRICS[laneField]
    const diff = opp[laneField]
    const mine = p[spec.field]
    const theirs = roundStat(mine - diff)
    const verb = diff >= 0 ? spec.words[0] : spec.words[1]
    return {
      metric: `vsLaneOpponent.${laneField}`,
      value: diff,
      note: `对位${opp.opponentChampion}${spec.cn}：本人 ${mine}，对方 ${theirs}，${verb} ${roundStat(Math.abs(diff))}`
    }
  }
  const multi = metric.match(/^multiKills\.(double|triple|quadra|penta)$/)
  if (multi) {
    const kind = multi[1] as keyof typeof MULTI_KILL_CN
    const value = p.multiKills[kind]
    if (!value) return null
    return { metric, value, note: `${MULTI_KILL_CN[kind]} ${value} 次` }
  }
  if (metric === 'wardScore' && typeof p.wardScore === 'number') {
    return { metric, value: p.wardScore, note: `视野得分 ${p.wardScore}` }
  }
  return null
}

/** 差值反推对方原值时消除浮点尾差(KDA 差为两位小数) */
function roundStat(value: number): number {
  return Number(value.toFixed(2))
}

function stripFencedCodeBlock(raw: string): string {
  const trimmed = raw.trim()
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  if (fenceMatch) return fenceMatch[1].trim()
  return trimmed
}
