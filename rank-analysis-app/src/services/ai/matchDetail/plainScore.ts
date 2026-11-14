/**
 * 评分结果的「人话」表述（只用于喂模型的材料）。
 *
 * 模型看到原始分数（"总分 -0.2（P30~P40）""对线 -1.9"）会原样抄进锐评，普通玩家读不懂。
 * 这里把分数翻成等级词、把总分分位翻成「前/后 X%」、把死亡归责翻成带责任的归类，
 * 并给每个分项配 1~2 条驱动它的真实数据。分数本身仍留在内部数据（PlayerScore/ScoreBrief）里。
 * 纯函数。
 */
import type { DeathKind } from '../shared/scoring/deathAttribution'
import type { TimelineMetricValues } from '../shared/scoring/metrics'
import type { Deciles } from '../shared/scoring/thresholds'
import type { SubScoreKey } from '../shared/scoring/weights'

/** 分项等级阈值（单位：基准标准差）：≤ −1.5 大幅落后，≤ −0.5 落后，< 0.5 持平，< 1.5 领先，其余大幅领先 */
export const LEVEL_FAR_BEHIND_MAX = -1.5
export const LEVEL_BEHIND_MAX = -0.5
export const LEVEL_EVEN_BELOW = 0.5
export const LEVEL_AHEAD_BELOW = 1.5

export type ScoreLevel = '大幅落后' | '落后' | '持平' | '领先' | '大幅领先'

/** 分项分 → 等级词 */
export function levelOf(v: number): ScoreLevel {
  if (v <= LEVEL_FAR_BEHIND_MAX) return '大幅落后'
  if (v <= LEVEL_BEHIND_MAX) return '落后'
  if (v < LEVEL_EVEN_BELOW) return '持平'
  if (v < LEVEL_AHEAD_BELOW) return '领先'
  return '大幅领先'
}

/** 等级词 → 完整措辞，如「大幅落后同位置同英雄的平均水平」 */
export function levelPhrase(level: ScoreLevel): string {
  return level === '持平' ? '与同位置同英雄的平均水平持平' : `${level}同位置同英雄的平均水平`
}

/** 分位人话的取整粒度与两端夹值（避免「前 0%」） */
const RANK_STEP = 5
const RANK_MIN = 5
const RANK_MAX = 95

/**
 * 总分在十分位里的近似百分位：相邻十分位之间线性插值，低于 P10 / 高于 P90 夹到 5 / 95。
 * @param d - P10..P90 十分位（升序）
 * @returns 0~100
 */
export function percentileOf(total: number, d: Deciles): number {
  const k = d.filter(x => x <= total).length
  if (k === 0) return RANK_MIN
  if (k >= d.length) return RANK_MAX
  const lo = d[k - 1]
  const hi = d[k]
  return 10 * k + (hi > lo ? (10 * (total - lo)) / (hi - lo) : 0)
}

/**
 * 百分位 → 「大约处于同位置玩家的前/后 X%」（取整到 5；≥ P50 用「前」）
 * @param p - 0~100 的百分位
 */
export function rankText(p: number): string {
  const r = Math.min(RANK_MAX, Math.max(RANK_MIN, Math.round(p / RANK_STEP) * RANK_STEP))
  return r >= 50 ? `大约处于同位置玩家的前 ${100 - r}%` : `大约处于同位置玩家的后 ${r}%`
}

/** LCU teamPosition → 材料里的中文分路（下路标注 ADC，防止模型把下路写成打野/中路） */
const ROLE_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路（ADC）',
  UTILITY: '辅助'
}

/** 分路中文名；无分路模式（大乱斗/海斗）为「无分路」，有分路但推不出为「分路未知」 */
export function roleCn(position: string, hasLanes: boolean): string {
  if (!hasLanes) return '无分路'
  return ROLE_CN[position] ?? '分路未知'
}

/** 阵亡类型 → 人话名称与本人责任（无 tag 的类不写责任，交给卡片细节） */
export const DEATH_PLAIN: Record<DeathKind, { name: string; tag?: string }> = {
  isolated: { name: '孤立被杀', tag: '自身问题' },
  solo: { name: '被对位单杀', tag: '自身问题' },
  ganked: { name: '被对面打野/游走抓', tag: '部分责任' },
  collapse: { name: '队友先倒下后阵亡', tag: '情有可原' },
  fight: { name: '团战中阵亡' },
  other: { name: '其他' }
}

/** 归类展示顺序：自身问题 → 部分责任 → 情有可原 → 中性 */
const DEATH_ORDER: DeathKind[] = ['isolated', 'solo', 'ganked', 'collapse', 'fight', 'other']

/** 算作「自身问题」的阵亡类型 */
const OWN_FAULT: ReadonlySet<DeathKind> = new Set<DeathKind>(['isolated', 'solo'])

/** 单次阵亡的人话，如「被对位单杀（自身问题）」 */
export function deathTag(kind: DeathKind): string {
  const d = DEATH_PLAIN[kind]
  return d.tag ? `${d.name}（${d.tag}）` : d.name
}

/**
 * 阵亡归类小结：`11 次阵亡：孤立被杀 3 次（自身问题）、…、其他 2 次`，省略 0 次的类。
 * @param kinds - 时间线归责出的每次阵亡类型；无时间线为 null
 * @param lcuDeaths - 战绩死亡数（仅无时间线时使用）
 */
export function deathSummary(kinds: DeathKind[] | null, lcuDeaths: number): string {
  if (kinds === null) return `阵亡 ${lcuDeaths} 次（无时间线，无法细分）`
  if (kinds.length === 0) return '本局未阵亡'
  const parts = DEATH_ORDER.flatMap(k => {
    const n = kinds.filter(x => x === k).length
    if (n === 0) return []
    const d = DEATH_PLAIN[k]
    return [`${d.name} ${n} 次${d.tag ? `（${d.tag}）` : ''}`]
  })
  return `${kinds.length} 次阵亡：${parts.join('、')}`
}

/**
 * 分项数据所需的玩家字段（快照玩家行的子集）
 * @property killParticipation - 参团率，已是百分数（如 48.5）
 * @property wardScore / objectiveDamage - 国服战绩可能缺失，为 null
 */
export interface StatPlayer {
  participantId: number
  deaths: number
  killParticipation: number
  csm: number
  gpm: number
  dpm: number
  damage: number
  gold: number
  wardScore: number | null
  objectiveDamage: number | null
}

/**
 * 分项数据的上下文
 * @property metrics - 时间线指标；无时间线为 null
 * @property fights - 团战卡（subjects = 在场玩家）
 * @property deaths - 本人阵亡类型；无时间线为 null
 */
export interface StatContext {
  player: StatPlayer
  metrics: TimelineMetricValues | null
  minutes: number
  fights: Array<{ subjects: number[] }>
  deaths: DeathKind[] | null
  hasLanes: boolean
  /** 作为缺位搭档被分担责任的阵亡次数（如辅助不在时 AD 阵亡）；无时间线为 null，缺省按 0 */
  partnerAbsences?: number | null
  /** teamPosition：「职责」分项按位置取数据；缺省按无位置 */
  position?: string
}

const r1 = (v: number): number => Math.round(v * 10) / 10

/** 差值的人话：领先 / 落后 / 持平（整数） */
const diffWord = (v: number): string => {
  const n = Math.round(v)
  if (n > 0) return `领先 ${n}`
  if (n < 0) return `落后 ${-n}`
  return '持平'
}

/**
 * 驱动某分项的 1~2 条真实数据（计数/经济取整，每分钟一位小数，占比用 %）；拿不到的项跳过。
 * @returns 可能为空数组
 */
export function partStats(key: SubScoreKey, c: StatContext): string[] {
  const { player: p, metrics: m, minutes } = c
  const perMin = (v: number): number | null => (minutes > 0 ? v / minutes : null)
  const out: Array<string | null> = []
  switch (key) {
    case 'lane':
      out.push(
        m?.goldDiff14 != null ? `14 分钟对位经济${diffWord(m.goldDiff14)}` : null,
        m?.csDiff14 != null ? `补刀${diffWord(m.csDiff14)}` : null
      )
      break
    case 'teamfight': {
      out.push(`参团率 ${p.killParticipation}%`)
      if (c.fights.length > 0) {
        const absent = c.fights.filter(f => !f.subjects.includes(p.participantId)).length
        out.push(`${c.fights.length} 场团战缺席 ${absent} 场`)
      }
      break
    }
    case 'deathQuality':
      out.push(`阵亡 ${p.deaths} 次`)
      if (c.deaths && p.deaths > 0)
        out.push(`其中自身问题 ${c.deaths.filter(k => OWN_FAULT.has(k)).length} 次`)
      // 缺位分担也计入死亡质量，不写出来模型会对着「只死 2 次」解释不了低分
      if (c.partnerAbsences) out.push(`下路搭档阵亡时不在身边 ${c.partnerAbsences} 次`)
      break
    case 'growth':
      if (c.hasLanes) out.push(`每分钟补刀 ${r1(p.csm)}`, `每分钟经济 ${Math.round(p.gpm)}`)
      else
        out.push(
          `每分钟伤害 ${Math.round(p.dpm)}`,
          p.gold > 0 ? `伤害经济比 ${r1(p.damage / p.gold)}` : null
        )
      break
    case 'resources': {
      const objPerMin = p.objectiveDamage === null ? null : perMin(p.objectiveDamage)
      out.push(
        m?.objectiveParticipation != null
          ? `己方大型野怪资源在场率 ${Math.round(m.objectiveParticipation * 100)}%`
          : null,
        objPerMin !== null ? `每分钟对建筑/野怪伤害 ${Math.round(objPerMin)}` : null
      )
      break
    }
    case 'duty': {
      // 与 subScores.dutyScore 的位置口径一致：打野看抓人、中单/辅助看游走（缺位代价在死亡质量里写）
      const roam = m?.roamKills != null ? `对线期离线参与击杀 ${m.roamKills} 次` : null
      if (c.position === 'JUNGLE')
        out.push(m?.gankKills != null ? `对线期到线上参与击杀 ${m.gankKills} 次` : null)
      else if (c.position === 'MIDDLE' || c.position === 'UTILITY') out.push(roam)
      break
    }
    case 'vision': {
      const wardPerMin = p.wardScore === null ? null : perMin(p.wardScore)
      out.push(
        wardPerMin !== null ? `每分钟视野得分 ${r1(wardPerMin)}` : null,
        m?.controlWardsPerMin != null
          ? `插控制守卫 ${Math.round(m.controlWardsPerMin * minutes)} 个`
          : null
      )
      break
    }
  }
  return out.filter((x): x is string => x !== null)
}
