/**
 * BP 候选打分的演示实现。
 *
 * 这是打分公式的 TypeScript 原型，只服务于演示页的实时重排；
 * 正式实现会放在后端 `bp_decision`，系数以那边的系数表为准。
 *
 * 所有项都在对数几率上相加，最后过 sigmoid 得到「评估胜率」。
 * 系数均为未校准的先验值。
 */
import type { BpCandidate, BpDamageMix, BpReason } from '@renderer/types/bpPanel'
import {
  ALLIES,
  BAN_CANDIDATES,
  BY_ID,
  MY_AVG,
  MY_GAMES,
  MY_POOL,
  NEMESIS,
  PICK_CANDIDATES,
  VS,
  demoIcon,
  demoSplash
} from './data'

/** 熟练度收缩强度：等效于先验的虚拟场次。 */
const SHRINK_K = 20
/** 熟练度项封顶（对数几率），约 ±6 个百分点。 */
const MASTERY_CAP = 0.25
/** 池外且近期零场次的陌生惩罚（对数几率），约 3 个百分点。 */
const UNFAMILIAR_PENALTY = 0.12
/** 阵容健康区间：全队魔法占比的下限与上限。 */
const MIX_LOW = 0.3
const MIX_HIGH = 0.7
/** 阵容项系数：魔法占比每超出区间 1.0 扣的对数几率。 */
const COMP_BETA = 0.4
/** 池内分差在此以内时保持用户的池顺序（对数几率），约 0.6 个百分点。 */
const KEEP_ORDER_MARGIN = 0.025
/** 对数几率换算成百分点的近似系数（sigmoid 在 0.5 处的斜率）。 */
const PP_PER_LOGIT = 25
/** 展示的候选数量。 */
const SHOWN = 5

const logit = (p: number): number => Math.log(p / (1 - p))
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** 一个候选的打分明细（对数几率）。 */
interface PickScore {
  id: number
  total: number
  reasons: BpReason[]
  warning?: string
}

/** 打分结果：要展示的卡片 + 自动执行目标。 */
export interface Ranked {
  candidates: BpCandidate[]
  autoTargetId: number | null
}

/**
 * 推算「加上候选后」我方五人的魔法伤害占比
 *
 * 已亮出的队友用真实构成；没亮的下路两人按分路默认值：
 * ADC 纯物理权重 1，辅助物理魔法各半且权重 0.4。
 * @param candidateId - 我要选的英雄
 * @returns 魔法占比 0~1
 */
function projectedMagicShare(candidateId: number): number {
  let physical = 1 + 0.2
  let magic = 0.2
  for (const id of [...ALLIES, candidateId]) {
    physical += BY_ID[id].physical
    magic += 1 - BY_ID[id].physical
  }
  return magic / (physical + magic)
}

/**
 * 给单个 pick 候选打分
 * @param id - 候选英雄
 * @param enemies - 已亮出的敌方英雄
 * @returns 总分与理由明细
 */
function scorePick(id: number, enemies: number[]): PickScore {
  const champion = BY_ID[id]
  const baseLogit = logit(champion.base)
  const reasons: BpReason[] = []
  let total = baseLogit
  reasons.push({
    kind: 'meta',
    label: `版本 T${champion.tier}`,
    delta: (champion.base - 0.5) * 100
  })

  // 熟练度：往我的总体胜率收缩，场次少时几乎不动
  const [games, wins] = MY_GAMES[id] ?? [0, 0]
  const inPool = MY_POOL.includes(id)
  let mastery = clamp(
    logit((wins + SHRINK_K * MY_AVG) / (games + SHRINK_K)) - logit(MY_AVG),
    -MASTERY_CAP,
    MASTERY_CAP
  )
  if (!inPool && games === 0) mastery -= UNFAMILIAR_PENALTY
  total += mastery
  reasons.push({
    kind: 'mastery',
    label: mastery < 0 ? '不熟练' : '熟练度',
    delta: mastery * PP_PER_LOGIT
  })

  // 克制：每个已亮敌人按「他是我对位」的概率加权
  const laneWeights = enemies.map(enemy => BY_ID[enemy].midRate)
  const weightSum = laneWeights.reduce((a, b) => a + b, 0)
  const norm = weightSum > 1 ? 1 / weightSum : 1
  enemies.forEach((enemy, i) => {
    const wr = VS[id]?.[enemy]
    if (wr === undefined) return
    const term = laneWeights[i] * norm * (logit(wr) - baseLogit)
    total += term
    reasons.push({
      kind: 'counter',
      label: term >= 0 ? `克制${BY_ID[enemy].name}` : `被${BY_ID[enemy].name}克制`,
      delta: term * PP_PER_LOGIT
    })
  })

  // 先手风险：对位没亮时，对面随手拿到克制英雄的期望损失
  const unrevealed = clamp(1 - weightSum, 0, 1)
  const threats = Object.entries(VS[id] ?? {})
    .map(([enemy, wr]) => ({ enemy: Number(enemy), wr }))
    .filter(t => t.wr < champion.base && !enemies.includes(t.enemy))
    .sort((a, b) => a.wr - b.wr)
    .slice(0, 3)
  const risk =
    -unrevealed *
    threats.reduce((sum, t) => sum + BY_ID[t.enemy].pickRate * (baseLogit - logit(t.wr)), 0)
  total += risk
  reasons.push({ kind: 'risk', label: '先手风险', delta: risk * PP_PER_LOGIT })

  // 阵容：魔法占比落在健康区间外才扣分
  const share = projectedMagicShare(id)
  const outside = share < MIX_LOW ? MIX_LOW - share : share > MIX_HIGH ? share - MIX_HIGH : 0
  const comp = -COMP_BETA * outside
  total += comp
  let warning: string | undefined
  if (outside > 0.05) {
    warning = share < MIX_LOW ? '选它全队缺魔法伤害' : '选它全队缺物理伤害'
    reasons.push({ kind: 'comp', label: '阵容偏科', delta: comp * PP_PER_LOGIT })
  } else if (champion.physical < 0.5) {
    reasons.push({ kind: 'comp', label: '补魔法伤害' })
  }

  return { id, total, reasons, warning }
}

/** 只留贡献明显的理由，按影响从大到小取前三条。 */
function topReasons(reasons: BpReason[]): BpReason[] {
  return reasons
    .filter(r => r.delta === undefined || Math.abs(r.delta) >= 0.3)
    .sort((a, b) => Math.abs(b.delta ?? 0.5) - Math.abs(a.delta ?? 0.5))
    .slice(0, 3)
}

/** 熟练度文案与是否陌生。 */
function masteryOf(id: number): { mastery: string; unfamiliar: boolean } {
  const [games, wins] = MY_GAMES[id] ?? [0, 0]
  if (games === 0) return { mastery: '没玩过', unfamiliar: true }
  return {
    mastery: `近期 ${games} 场 ${Math.round((wins / games) * 100)}%`,
    unfamiliar: games < 5 && !MY_POOL.includes(id)
  }
}

const damageOf = (id: number) => {
  const physical = BY_ID[id].physical
  return physical >= 0.65 ? 'physical' : physical <= 0.35 ? 'magic' : 'mixed'
}

/**
 * pick 阶段的推荐列表
 *
 * 池内池外统一按分数排序；自动执行目标只在池内取，且分差很小时
 * 尊重用户的池顺序，避免敌方每亮一个人首选就来回跳。
 * @param enemies - 已亮出的敌方英雄
 * @param autoEnabled - 自动选择开关
 * @returns 展示卡片与自动执行目标
 */
export function rankPicks(enemies: number[], autoEnabled: boolean): Ranked {
  const scores = PICK_CANDIDATES.filter(id => !enemies.includes(id) && !ALLIES.includes(id))
    .map(id => scorePick(id, enemies))
    .sort((a, b) => b.total - a.total)

  const poolScores = scores.filter(s => MY_POOL.includes(s.id))
  const best = poolScores[0]?.total ?? -Infinity
  const autoTargetId =
    MY_POOL.find(id => {
      const score = poolScores.find(s => s.id === id)
      return score !== undefined && score.total >= best - KEEP_ORDER_MARGIN
    }) ?? null

  // 自动目标必须出现在列表里，哪怕它没进前五
  const shown = scores.slice(0, SHOWN)
  if (autoTargetId !== null && !shown.some(s => s.id === autoTargetId)) {
    shown[SHOWN - 1] = scores.find(s => s.id === autoTargetId)!
  }

  return {
    autoTargetId: autoEnabled ? autoTargetId : null,
    candidates: shown.map(s => ({
      championId: s.id,
      name: BY_ID[s.id].name,
      icon: demoIcon(s.id),
      splash: demoSplash(s.id),
      headline: `${(sigmoid(s.total) * 100).toFixed(1)}%`,
      caption: '评估胜率',
      inPool: MY_POOL.includes(s.id),
      damage: damageOf(s.id),
      ...masteryOf(s.id),
      reasons: topReasons(s.reasons),
      warning: s.warning
    }))
  }
}

/**
 * ban 阶段的推荐列表
 *
 * 威胁 = 版本强度 + 对我首选英雄的克制 + 我近期输给它的次数。
 * ban 没有池的概念，自动目标就是第一名。
 * @param autoEnabled - 自动禁用开关
 * @returns 展示卡片与自动执行目标
 */
export function rankBans(autoEnabled: boolean): Ranked {
  const myPick = rankPicks([], true).autoTargetId ?? MY_POOL[0]
  const mine = BY_ID[myPick]

  const scored = BAN_CANDIDATES.filter(id => !ALLIES.includes(id) && id !== myPick)
    .map(id => {
      const champion = BY_ID[id]
      const reasons: BpReason[] = [
        {
          kind: 'meta',
          label: `T${champion.tier} · Ban 率 ${Math.round(champion.banRate * 100)}%`
        }
      ]
      let points = (champion.base - 0.5) * 100 + champion.banRate * 10

      const wr = VS[myPick]?.[id]
      if (wr !== undefined && wr < mine.base) {
        const loss = champion.midRate * (logit(mine.base) - logit(wr)) * PP_PER_LOGIT
        points += loss * 2
        reasons.push({ kind: 'counter', label: `克制你的${mine.name}`, delta: -loss })
      }

      const losses = NEMESIS[id] ?? 0
      if (losses > 0) {
        points += losses * 0.6
        reasons.push({ kind: 'nemesis', label: `近期输给它 ${losses} 次` })
      }
      return { id, points, reasons }
    })
    .sort((a, b) => b.points - a.points)
    .slice(0, SHOWN)

  // 威胁度按第一名归一化到 95，避免绝对刻度在强势版本里全部顶满
  const top = Math.max(scored[0]?.points ?? 1, 1)

  return {
    autoTargetId: autoEnabled ? (scored[0]?.id ?? null) : null,
    candidates: scored.map(s => ({
      championId: s.id,
      name: BY_ID[s.id].name,
      icon: demoIcon(s.id),
      splash: demoSplash(s.id),
      headline: String(Math.round(clamp((s.points / top) * 95, 0, 95))),
      caption: '威胁度',
      inPool: true,
      damage: damageOf(s.id),
      reasons: s.reasons
    }))
  }
}

/**
 * 一组已亮出英雄的伤害构成（只算已知的，不做默认值推算）
 * @param ids - 已亮出的英雄
 * @returns 物理 / 魔法总量与已知人数
 */
export function mixOf(ids: number[]): BpDamageMix {
  const known = ids.filter(id => BY_ID[id])
  return {
    physical: known.reduce((sum, id) => sum + BY_ID[id].physical, 0),
    magic: known.reduce((sum, id) => sum + 1 - BY_ID[id].physical, 0),
    known: known.length
  }
}
