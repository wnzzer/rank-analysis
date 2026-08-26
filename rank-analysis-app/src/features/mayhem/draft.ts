/**
 * A2 选人期助手纯逻辑：bench 打分 + 阵容缺口启发式。
 *
 * 数据口径：champions.json 的 roles（tank/fighter/assassin/mage/marksman/support）
 * 与 stats.tier（官方 1-5）。AD/AP 归类是**启发式**（射手/战士→AD，法师→AP），
 * 结论句只作参考提示而非断言。
 */

export interface ChampMeta {
  tier: number | null
  roles: string[]
}

export type ChampMetaMap = Record<number, ChampMeta>

export interface BenchEntry {
  championId: number
  score: number
  /** 排序理由（T 级 / 我的历史胜率） */
  reasons: string[]
}

/** 我的历史战绩（来自 mayhem_db 聚合）。 */
export interface MyChampRecord {
  games: number
  wins: number
}

const TIER_SCORE: Record<number, number> = { 1: 100, 2: 80, 3: 60, 4: 40, 5: 20 }
/** 我的历史胜率参与打分的最低场次。 */
const MY_MIN_GAMES = 10

function tierScore(tier: number | null): number {
  const t = Math.min(Math.max(tier ?? 5, 1), 5)
  return TIER_SCORE[t] ?? 20
}

/**
 * bench 候选打分排序（高分在前）。
 *
 * score = 官方 T 级分（T1=100 … T5=20）± 我的历史胜率偏移
 * （≥10 场才参与；胜率每偏离 50% 一个百分点 ±1.6 分，90% 时 +64，
 * 足以让 T4 的绝活英雄反超 T1）。无个人数据时退化为纯 T 级分。
 */
export function scoreBench(
  bench: number[],
  meta: ChampMetaMap,
  mine?: Record<number, MyChampRecord>
): BenchEntry[] {
  return bench
    .map(championId => {
      const m = meta[championId]
      const tScore = tierScore(m?.tier ?? null)
      const reasons = [`T${m?.tier ?? '?'}`]

      let score = tScore
      const rec = mine?.[championId]
      if (rec && rec.games >= MY_MIN_GAMES) {
        const wr = rec.wins / rec.games
        score += Math.round((wr - 0.5) * 2 * 80)
        reasons.push(`我的胜率 ${(wr * 100).toFixed(0)}%（${rec.games} 场）`)
      } else {
        reasons.push('我的样本不足')
      }

      return { championId, score: Math.round(score * 10) / 10, reasons }
    })
    .sort((a, b) => b.score - a.score)
}

export interface CompositionGaps {
  tanks: number
  adish: number
  apish: number
  sentence: string
}

/**
 * 阵容缺口启发式（一句话结论）。
 *
 * adish=射手/战士、apish=法师/辅助；坦克为 0 时前排缺口优先级最高。
 */
export function compositionGaps(teamIds: number[], meta: ChampMetaMap): CompositionGaps {
  let tanks = 0
  let adish = 0
  let apish = 0
  for (const id of teamIds) {
    const roles = meta[id]?.roles ?? []
    if (roles.includes('tank')) tanks += 1
    if (roles.includes('marksman') || roles.includes('fighter')) adish += 1
    if (roles.includes('mage')) apish += 1
  }

  const parts: string[] = []
  if (tanks === 0) parts.push('缺前排')
  if (apish === 0) parts.push('缺 AP')
  if (adish === 0) parts.push('缺 AD')
  const sentence =
    parts.length === 0 ? '阵容均衡' : `阵容缺口：${parts.join(' + ')}，换入时优先补齐`
  return { tanks, adish, apish, sentence }
}
