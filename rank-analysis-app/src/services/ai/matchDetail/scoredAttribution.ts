/**
 * TS 归因骨架（取代 Stage 1 模型调用）：评分 → 标签 → 必出名单 → AttributionResult。
 *
 * - verdicts：名单与 label 来自 scoring；evidenceMetrics 为具体数据（KDA/阵亡/参团率）；finalCall 为
 *   模板句（分位人话 + 最突出两项的等级词），Stage 2 在同一次调用里按 label 立场改写成锐评。
 * - winReason：胜负分项差距最大的一项 + 整局可见的 T/F 卡编号，由 Stage 2 润色。
 * - scores：全员评分拆解，prompt 里渲染成【表现评估】。
 * 喂模型的内容一律不含原始分数/分位段（用户反馈：模型会把"总分 -0.2（P30~P40）"原样抄给玩家），
 * 分数只留在内部字段里。纯函数，同输入同输出。
 */
import { DEFAULT_SCORING_DATA, scoreSnapshot, selectVerdicts } from '../shared/scoring/match'
import type { PlayerScore, ScoringData } from '../shared/scoring/scorePlayers'
import { lookupThresholds } from '../shared/scoring/thresholds'
import { SUB_SCORE_CN, SUB_SCORE_KEYS, type SubScoreKey } from '../shared/scoring/weights'
import type { MatchSnapshot } from '../shared/snapshot'
import { visibleCards, type TimelineCard } from '../shared/timeline'
import { fmtTime } from '../shared/timeline/geometry'
import { sideLabel } from '../shared/timeline/labels'
import {
  deathSummary,
  deathTag,
  LEVEL_BEHIND_MAX,
  levelOf,
  levelPhrase,
  partStats,
  percentileOf,
  rankText,
  roleCn
} from './plainScore'
import type {
  AttributionResult,
  EvidenceMetric,
  MitigatingFactor,
  ScoreBrief,
  Verdict
} from './types'

const r1 = (v: number): number => Math.round(v * 10) / 10

type SnapPlayer = MatchSnapshot['players'][number]

/**
 * 拆解：只列参与加总的分项，按 SUB_SCORE_KEYS 顺序；分项配等级词与驱动数据。
 * 复盘仪表盘（services/ai/review）也用它取个人卡的等级词/数据/分位，与喂模型的材料同源。
 */
export function toBrief(
  s: PlayerScore,
  p: SnapPlayer,
  snapshot: MatchSnapshot,
  data: ScoringData,
  deathCards: TimelineCard[],
  fightCards: TimelineCard[]
): ScoreBrief {
  const hasLanes = snapshot.modeContext.hasLanes
  const metrics = snapshot.timeline?.metrics[s.participantId] ?? null
  const kinds = s.deaths?.map(d => d.kind) ?? null
  const statCtx = {
    player: p,
    metrics,
    minutes: snapshot.durationSeconds / 60,
    fights: fightCards,
    deaths: kinds,
    hasLanes,
    position: p.teamPosition,
    partnerAbsences:
      snapshot.timeline?.deaths.filter(d => d.absentPartner?.participantId === s.participantId)
        .length ?? null
  }
  const parts = SUB_SCORE_KEYS.filter(
    k => s.contributions[k] !== undefined && s.sub[k] !== null
  ).map(k => {
    const value = r1(s.sub[k] as number)
    return {
      key: k,
      cn: SUB_SCORE_CN[k],
      value,
      level: levelOf(value),
      stats: partStats(k, statCtx)
    }
  })
  const deaths =
    s.deaths?.map(d => ({
      cardId:
        deathCards.find(
          c => c.subjects[0] === d.victimId && Math.abs(c.minute * 60000 - d.timestamp) < 1
        )?.id ?? null,
      time: fmtTime(d.timestamp),
      kind: d.kind,
      responsibility: d.responsibility
    })) ?? null
  // 分位与 scorePlayers 判标签用同一阈值格（同队列×位置×是否有时间线）
  const cell = lookupThresholds(
    data.thresholds,
    snapshot.queueId,
    p.teamPosition,
    hasLanes,
    !!metrics
  )
  // 减责证据只对低分改判（被爆）有意义，其余标签不展示，避免模型拿它给高分者洗白或给犯罪者开脱
  const mitigation = s.label === '被爆' ? s.mitigation.reasons : []
  return {
    total: r1(s.total),
    band: s.band,
    label: s.label,
    role: roleCn(p.teamPosition, hasLanes),
    rank: rankText(percentileOf(s.total, cell.total)),
    parts,
    deaths,
    deathSummary: deathSummary(kinds, p.deaths),
    mitigation
  }
}

function toVerdict(s: PlayerScore, p: SnapPlayer, brief: ScoreBrief): Verdict {
  const top = [...brief.parts].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const evidence: EvidenceMetric[] = [
    { metric: 'kda', value: p.kda },
    { metric: 'deaths', value: p.deaths },
    { metric: 'killParticipation', value: p.killParticipation }
  ]
  const mitigatingFactors: MitigatingFactor[] =
    s.label === '被爆'
      ? s.mitigation.reasons.map(r => ({ factor: 'team-collapse' as const, support: r }))
      : []
  const headline = top
    .slice(0, 2)
    .map(x => `${x.cn}${x.level}`)
    .join('、')
  return {
    participantId: s.participantId,
    name: p.name,
    label: s.label,
    evidenceMetrics: evidence,
    mitigatingFactors,
    finalCall: `${s.label}：${brief.rank}${headline ? `，${headline}` : ''}`,
    champion: p.champion,
    teamPosition: p.teamPosition,
    teamResult: p.win ? '胜方' : '败方'
  }
}

/** 胜负因果模板句：胜败两队分项队均差距最大的一项 + 整局可见的 T/F 卡（不写分数） */
export function winReasonSkeleton(snapshot: MatchSnapshot, scores: PlayerScore[]): string {
  const win = snapshot.players.find(p => p.win)?.teamId
  const lose = snapshot.players.find(p => !p.win)?.teamId
  if (win === undefined || lose === undefined) return '胜负信息缺失，仅按评分点名。'
  const teamOf = new Map(snapshot.players.map(p => [p.participantId, p.teamId]))
  const teamMean = (team: number, k: SubScoreKey): number | null => {
    const v = scores
      .filter(s => teamOf.get(s.participantId) === team && s.contributions[k] !== undefined)
      .map(s => s.sub[k])
      .filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  let best: { k: SubScoreKey; a: number; b: number } | null = null
  for (const k of SUB_SCORE_KEYS) {
    const a = teamMean(win, k)
    const b = teamMean(lose, k)
    if (a === null || b === null) continue
    if (!best || a - b > best.a - best.b) best = { k, a, b }
  }
  let text = !best
    ? `${sideLabel(win)}获胜`
    : best.a - best.b > 0
      ? `${sideLabel(win)}在${SUB_SCORE_CN[best.k]}上优势最大`
      : `${sideLabel(win)}获胜，但没有哪一项整体占优（差距最小的是${SUB_SCORE_CN[best.k]}）`
  const shown = snapshot.timeline ? visibleCards(snapshot.timeline.cards, 'overview') : []
  const turn = shown.find(c => c.kind === 'turn')
  const fight = [...shown].filter(c => c.kind === 'fight').sort((x, y) => y.weight - x.weight)[0]
  const cites = [turn && `[${turn.id}] 经济转折`, fight && `[${fight.id}] 关键团战`].filter(Boolean)
  if (cites.length) text += `；${cites.join('，')}`
  return `${text}。`
}

/**
 * 由快照确定性生成归因骨架。
 * @param data - 基准与阈值（默认入库数据；测试可注入）
 */
export function buildScoredAttribution(
  snapshot: MatchSnapshot,
  data: ScoringData = DEFAULT_SCORING_DATA
): AttributionResult {
  const scores = scoreSnapshot(snapshot, data)
  const cards = snapshot.timeline?.cards ?? []
  const deathCards = cards.filter(c => c.kind === 'death')
  const fightCards = cards.filter(c => c.kind === 'fight')
  const byId = new Map(snapshot.players.map(p => [p.participantId, p]))
  const briefs: Record<number, ScoreBrief> = {}
  for (const s of scores) {
    const p = byId.get(s.participantId)
    if (p) briefs[s.participantId] = toBrief(s, p, snapshot, data, deathCards, fightCards)
  }
  const verdicts = selectVerdicts(snapshot.players, scores).flatMap(s => {
    const p = byId.get(s.participantId)
    return p ? [toVerdict(s, p, briefs[s.participantId])] : []
  })
  return { winReason: winReasonSkeleton(snapshot, scores), verdicts, scores: briefs }
}

/** 被连累玩家在材料里列出的短板分项上限 */
const WEAKNESS_LIMIT = 2

/** 【表现评估】块标题行 */
export const SCORE_BLOCK_HEADER =
  '【表现评估】（系统按国服同位置大盘算好的结论：label、等级词与数据只能照抄，禁止换算成分数）'

/**
 * 有【表现评估】时两种 Stage 2 prompt 共用的硬规则：禁分数、分路照抄、阵亡责任照分类转述。
 * 用户反馈 36/36 篇都出现"总分-0.2（P30~P40）"类黑话、把下路写成打野、把孤立阵亡写成被连累。
 */
export const PLAIN_SCORE_RULES = [
  '- 禁止写任何分数、分位、标准差、z 值（如“总分 -0.2”“P30”“对线 -1.9”）；只能用材料里的等级词和具体数据。',
  '- 分路只能照抄材料里的位置，禁止写别的位置。',
  '- 阵亡的责任只能按材料里的分类转述：标“自身问题”的不得说成被连累。'
].join('\n')

/** 分项一行的「等级（数据）」尾巴 */
const withStats = (head: string, stats: string[]): string =>
  stats.length ? `${head}（${stats.join('、')}）` : head

/**
 * 渲染【表现评估】：分路开头，分位与分项都用人话，阵亡按责任归类。不写任何原始分数。
 * @param visibleIds - 当前 prompt 可见的卡片编号；不可见的 D 卡只写时间不写编号（null = 全不写）
 * @returns 无行时为空串
 */
export function renderScoreBlock(
  rows: Array<{ name: string; brief: ScoreBrief }>,
  visibleIds: Set<string> | null
): string {
  if (rows.length === 0) return ''
  const lines = [SCORE_BLOCK_HEADER]
  for (const { name, brief } of rows) {
    lines.push(`- ${[brief.role, name, brief.label, `整体：${brief.rank}`].join('｜')}`)
    for (const x of brief.parts)
      lines.push(`  ${x.cn}：${withStats(levelPhrase(x.level), x.stats)}`)
    if (brief.mitigation.length) lines.push(`  减责证据：${brief.mitigation.join('；')}`)
    // 被连累不需要证据，但锐评要点出不足：列出落后及以下、最低的至多 2 项
    if (brief.label === '被连累') {
      const weak = brief.parts
        .filter(x => x.value <= LEVEL_BEHIND_MAX)
        .sort((a, b) => a.value - b.value)
        .slice(0, WEAKNESS_LIMIT)
      if (weak.length)
        lines.push(`  短板：${weak.map(x => withStats(`${x.cn}${x.level}`, x.stats)).join('、')}`)
    }
    lines.push(`  阵亡情况：${brief.deathSummary}`)
    if (brief.deaths?.length) {
      const ds = brief.deaths.map(d => {
        const id = d.cardId && visibleIds?.has(d.cardId) ? `[${d.cardId}] ` : ''
        return `${id}${d.time} ${deathTag(d.kind)}`
      })
      lines.push(`  阵亡明细：${ds.join('；')}`)
    }
  }
  return lines.join('\n')
}
