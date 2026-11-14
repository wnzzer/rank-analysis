/**
 * 减责证据与标签判定（spec §2「减责证据」、§3「总分与标签」，2026-11-07 用户确认的拆分）。
 *
 * 按顺序取第一个命中：Carry（胜方本队唯一最高且 ≥P90）→ 尽力（胜方 ≥P80）→ 被连累（败方且 ≥P70，或本队唯一最高且 ≥P40；不需要证据）→
 * 被爆（<P70、对线或死亡质量 ≤P10、有证据）→ 犯罪（败方、无证据；有时间线 ≤P30，无时间线 ≤P20；
 * 且须是本队最低分，非最低分要 ≤P10 才算）→
 * 缚地灵（团战 ≤P10 且发育 ≥P60）→ 正常。
 * 减责证据只给低分玩家减责，不参与高分玩家的判定。
 */
import type { VerdictLabel } from '../../matchDetail/types'
import type { AttributedDeath } from './deathAttribution'
import type { SubScores } from './subScores'
import { decileAt, type ThresholdCell } from './thresholds'
import type { SubScoreKey } from './weights'

/** 证据 1：被抓 + 队友先崩占本人阵亡的比例下限 */
export const MITIGATION_DEATH_SHARE = 0.5
/** 证据 2：对线崩盘的队友对线分上限与人数 */
export const LANE_COLLAPSE_SCORE = -1.0
export const LANE_COLLAPSE_MIN_TEAMMATES = 2

/**
 * 犯罪线（总分百分位）。有时间线时能取到减责证据（被抓/队友先崩），"无证据"才有分量，故放宽到 P30；
 * 无时间线时根本无从取得减责证据，只能凭终局数据定罪，必须更严，取 P20。
 */
export const CRIME_PERCENTILE_TIMELINE = 30
export const CRIME_PERCENTILE_NO_TIMELINE = 20
/**
 * 非本队最低分的败方玩家，总分要低到这个百分位才判犯罪（2026-11-14 用户真机标注）。
 * 只用犯罪线时，一队输了常有三人挤在线下同时被判犯罪（实测一局三人 −0.56/−0.51/−0.47），
 * 而玩家心里该背锅的通常只有一个；本队最低分仍按犯罪线，其余人要明显拉胯（≤P10）才连坐。
 */
export const CRIME_PERCENTILE_NOT_WORST = 10

/**
 * Carry 线（2026-11-14 用户要求加赞扬标签）：胜方本队唯一最高分，且总分 ≥ 同位置该百分位。
 * 每局最多一人；「尽力」原本占约 17%、每局 1~2 人，太常见算不上夸奖。
 */
export const CARRY_PERCENTILE = 90

/** @property reasons - 成立的证据（中文人话，喂模型用；不含分数，避免模型抄分数） */
export interface Mitigation {
  mitigated: boolean
  reasons: string[]
}

/**
 * 减责证据。
 * @param deaths - 本人阵亡归责；无时间线为 null
 * @param teammateLaneScores - 同队其他人的对线分项
 */
export function mitigationEvidence(
  deaths: AttributedDeath[] | null,
  teammateLaneScores: Array<number | null>
): Mitigation {
  const reasons: string[] = []
  if (deaths && deaths.length > 0) {
    // 搭档缺位（如辅助不在身边）、牵制换资源与被抓、队友先崩同属「不全是自己的锅」，同一次阵亡只计一次
    const excused = deaths.filter(
      x => x.kind === 'ganked' || x.kind === 'collapse' || !!x.absentPartner || !!x.traded
    )
    if (excused.length / deaths.length >= MITIGATION_DEATH_SHARE) {
      const why = ['被抓', '队友先倒下']
      if (excused.some(x => x.absentPartner)) why.push('搭档不在身边')
      if (excused.some(x => x.traded)) why.push('被多人包抄换来了资源')
      const tail = why.length > 2 ? `${why.slice(0, -1).join('、')}或${why.at(-1)}` : why.join('或')
      reasons.push(`阵亡 ${deaths.length} 次中 ${excused.length} 次是${tail}`)
    }
  }
  const collapsed = teammateLaneScores.filter(s => s !== null && s < LANE_COLLAPSE_SCORE).length
  if (collapsed >= LANE_COLLAPSE_MIN_TEAMMATES) {
    reasons.push(`${collapsed} 名队友对线明显落后`)
  }
  return { mitigated: reasons.length > 0, reasons }
}

/** 判定输入 */
export interface LabelInput {
  win: boolean
  total: number
  sub: SubScores
  thresholds: ThresholdCell
  mitigated: boolean
  /** 该玩家打分是否带时间线（决定犯罪线；与阈值格选择同一标志） */
  hasTimeline: boolean
  /** 总分严格高于每名队友（scorePlayers 计算） */
  teamBest: boolean
  /** 总分严格低于每名队友（scorePlayers 计算）；缺省按 false */
  teamWorst?: boolean
}

/** 由分数与证据判标签 */
export function decideLabel(i: LabelInput): VerdictLabel {
  const t = i.thresholds
  const subCut = (k: SubScoreKey, p: 10 | 60): number | null => {
    const d = t.sub[k]
    return d ? decileAt(d, p) : null
  }
  const low = (k: SubScoreKey): boolean => {
    const cut = subCut(k, 10)
    const v = i.sub[k]
    return cut !== null && v !== null && v <= cut
  }
  const high = (k: SubScoreKey): boolean => {
    const cut = subCut(k, 60)
    const v = i.sub[k]
    return cut !== null && v !== null && v >= cut
  }
  const p70 = decileAt(t.total, 70)

  if (i.win && i.teamBest && i.total >= decileAt(t.total, CARRY_PERCENTILE)) return 'Carry'
  if (i.win && i.total >= decileAt(t.total, 80)) return '尽力'
  if (!i.win && (i.total >= p70 || (i.teamBest && i.total >= decileAt(t.total, 40))))
    return '被连累'
  if (i.total < p70 && i.mitigated && (low('lane') || low('deathQuality'))) return '被爆'
  const crimeCut = i.hasTimeline ? CRIME_PERCENTILE_TIMELINE : CRIME_PERCENTILE_NO_TIMELINE
  const crimeLine = i.teamWorst ? crimeCut : Math.min(crimeCut, CRIME_PERCENTILE_NOT_WORST)
  if (!i.win && i.total <= decileAt(t.total, crimeLine as 10 | 20 | 30) && !i.mitigated)
    return '犯罪'
  if (low('teamfight') && high('growth')) return '缚地灵'
  return '正常'
}
