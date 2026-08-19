/**
 * OP.GG 英雄对位情报（选人期悬浮弹窗 / 阵容推荐数据源）。
 *
 * 后端命令 `get_champion_intel` 直连 OP.GG 内部端点
 * `/api/{region}/champions/ranked/{id}/{POSITION}?tier=`（LeagueAkari 逆向），
 * 返回该英雄该位置的全量对位列表 + 协同搭档列表。
 */

import { invoke } from '@tauri-apps/api/core'

/** 单条对位数据：本英雄（请求位置）面对对手的对位 */
export interface CounterItem {
  championId: number
  play: number
  win: number
  /** 对位胜率（0~1，由 win/play 计算） */
  winRate: number
}

/** 单条协同搭档数据：与搭档同队的胜率（V1.1 UI 启用） */
export interface SynergyItem {
  synergyChampionId: number
  synergyPosition: string
  winRate: number
  play: number
}

/** 单英雄单位置的对位情报 */
export interface ChampionIntel {
  region: string
  tier: string
  fetchedAt: number
  /** 是否过期数据（拉取失败降级） */
  stale: boolean
  counters: CounterItem[]
  synergies: SynergyItem[]
}

/** 对位排序键与方向 */
export type CounterSortKey = 'winRate' | 'play'
export type CounterSortDir = 'asc' | 'desc'

/** 默认排序：胜率降序（最擅长对位排最前） */
export const DEFAULT_COUNTER_SORT: { key: CounterSortKey; dir: CounterSortDir } = {
  key: 'winRate',
  dir: 'desc'
}

/** 搭档排序键与方向（与对位表一致，胜率/场次可排） */
export type SynergySortKey = 'winRate' | 'play'
export type SynergySortDir = 'asc' | 'desc'

/** 默认搭档排序：胜率降序（默契最高的搭档排最前） */
export const DEFAULT_SYNERGY_SORT: { key: SynergySortKey; dir: SynergySortDir } = {
  key: 'winRate',
  dir: 'desc'
}

/**
 * 把 LCU/前端分路命名转成 OP.GG 命名（MIDDLE→MID、BOTTOM→ADC、UTILITY→SUPPORT）。
 * 未知/非法值返回 null（调用方走主分路推断或放弃请求）。
 */
export function positionToOpgg(lcu: string): string | null {
  switch (lcu) {
    case 'TOP':
    case 'JUNGLE':
    case 'MID':
    case 'ADC':
    case 'SUPPORT':
      return lcu
    case 'MIDDLE':
      return 'MID'
    case 'BOTTOM':
      return 'ADC'
    case 'UTILITY':
      return 'SUPPORT'
    default:
      return null
  }
}

/**
 * LCU 分路 → OP.GG 命名（大小写不敏感）。
 *
 * LCU 选人会话的 `assignedPosition` 是纯小写（top/jungle/middle/bottom/utility），
 * 而 [`positionToOpgg`] 只认大写——两处命名体系拼不上时直接返回 null，调用方
 * （候选池位置收敛）会静默退化成「不过滤」：推荐条混入所有位置的英雄。
 * 这里统一先转大写再走既有映射，保证大小写任意都能命中。
 */
export function normalizeLcuPosition(lcu: string): string | null {
  return positionToOpgg(lcu.toUpperCase())
}

/** 推荐条位置筛选选项（"follow" = 跟随我本局分路；"all" = 全位置） */
export type PickPositionFilter =
  'follow' | 'all' | 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'

/** 推荐条位置筛选下拉选项（label 中文、value 走 LCU 命名） */
export const PICK_POSITION_OPTIONS: Array<{ label: string; value: PickPositionFilter }> = [
  { label: '跟随我的分路', value: 'follow' },
  { label: '全部位置', value: 'all' },
  { label: '上单', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中单', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]

/**
 * 推荐条位置筛选 → `useBestPicks` 的 myPosition 入参（纯函数，可单测）。
 *
 * - `follow`：跟随我本局分路（LCU 命名，可能为空串 = 位置未知）；规范化后返回
 *   OP.GG 命名，未知位置返回空串（不过滤候选池）。
 * - `all`：空串，候选池不做位置收敛。
 * - 具体分路：该分路的 OP.GG 命名。
 */
export function resolvePanelPosition(filter: PickPositionFilter, myPosition: string): string {
  if (filter === 'all') return ''
  if (filter === 'follow') return normalizeLcuPosition(myPosition) ?? ''
  return normalizeLcuPosition(filter) ?? ''
}

/**
 * 对位列表排序（纯函数，不修改原数组）。
 *
 * 方向说明：按胜率/场次升或降序；同值保持原始顺序（稳定排序）。
 */
export function sortCounters(
  items: CounterItem[],
  key: CounterSortKey,
  dir: CounterSortDir
): CounterItem[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => (a[key] - b[key]) * factor)
}

/**
 * 对位行文案：胜率（一位小数）+ 局数。
 * 例：`57.0% · 120 局`
 */
export function formatCounterLine(winRate: number, play: number): string {
  return `${(winRate * 100).toFixed(1)}% · ${play} 局`
}

/**
 * 搭档列表排序（纯函数，不修改原数组）。
 *
 * 与 [`sortCounters`] 同规则：按胜率/场次升或降序，同值保持原始顺序（稳定排序）。
 */
export function sortSynergies(
  items: SynergyItem[],
  key: SynergySortKey,
  dir: SynergySortDir
): SynergyItem[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => (a[key] - b[key]) * factor)
}

/**
 * 搭档行文案：胜率（一位小数）+ 局数。
 * 例：`55.3% · 890 局`
 */
export function formatSynergyLine(winRate: number, play: number): string {
  return `${(winRate * 100).toFixed(1)}% · ${play} 局`
}

/** 请求 OP.GG 对位情报；失败返回 null（沿用 opgg.ts 降级约定，调用方显示降级文案）。 */
export async function getChampionIntel(
  region: string,
  championId: number,
  position: string,
  tier: string
): Promise<ChampionIntel | null> {
  try {
    return await invoke<ChampionIntel>('get_champion_intel', {
      region,
      championId,
      position,
      tier
    })
  } catch (e) {
    console.warn('[counterIntel] 对位情报拉取失败:', e)
    return null
  }
}

// ---------- P2 阵容推荐评分（纯函数，可单测） ----------

/** 候选对某一敌方已锁英雄的证据行 */
export interface PickEvidence {
  /** 敌方已锁英雄 ID */
  againstChampionId: number
  /** favored = 我方候选对该敌胜率 >50%；countered = 低于 50% */
  relation: 'favored' | 'countered'
  /** 候选打该敌的胜率（0~1） */
  winRate: number
  /** 样本对局数 */
  play: number
}

/** 单个候选英雄的综合推荐结果 */
export interface BestPick {
  championId: number
  /** 综合分 = Σ (候选对该敌胜率 - 0.5)，保留 2 位 */
  score: number
  /** 有数据的对位证据（unknown 的对位不出现在证据里，前端一次带过文案） */
  evidences: PickEvidence[]
}

/**
 * 敌方已锁英雄的对位情报集合 → 候选评分（纯函数，P2 数据层）。
 *
 * 数据来源：只需敌方已锁英雄 E 的 intel（`counters[E]` 全量列表已含 E 对每个对手的
 * 数据），对候选 C 用反查：`wr(C vs E) = 1 - wr(E vs C)`。请求数 = |已锁敌方| ≤ 5，
 * 候选池大小不影响请求量。
 *
 * @param candidateIds - 排除 ban/锁定/intent 后的候选英雄 ID
 * @param enemyIntelById - 敌方已锁英雄 ID → 其 intel（缺失的敌方整队缺席评分）
 * @param coverageFirst - 为 true 时优先按 counter 敌方人数排序（覆盖度优先），
 *   同覆盖度按原始对位分降序；默认 false 按对位分降序
 *
 * @returns 按 score 降序排序的评分结果（同分按总场次降序，再按 championId 升序）
 */
export function computeBestPicks(
  candidateIds: number[],
  enemyIntelById: Map<number, ChampionIntel>,
  coverageFirst = false
): BestPick[] {
  // 无敌方数据（未锁定 / 快照缺失）或候选为空：无评分可言，返回空，
  // 前端据此显示「敌方尚未锁定英雄 / 无正面对位优势」空态
  if (candidateIds.length === 0 || enemyIntelById.size === 0) return []

  const results = candidateIds.map<BestPick>(candidateId => {
    let score = 0
    let coverage = 0
    const evidences: PickEvidence[] = []
    for (const [enemyId, intel] of enemyIntelById) {
      // 反查：E 的 counters 含 C → wr(E vs C) 已知，反转得 wr(C vs E)
      const entry = intel.counters.find(c => c.championId === candidateId)
      if (!entry) continue // 未知：不编造，不进证据
      const winRate = 1 - entry.winRate
      score += winRate - 0.5
      if (winRate >= 0.5) coverage++
      evidences.push({
        againstChampionId: enemyId,
        relation: winRate >= 0.5 ? 'favored' : 'countered',
        winRate,
        play: entry.play
      })
    }
    return { championId: candidateId, score: coverageFirst ? coverage : round2(score), evidences }
  })

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const playA = sumPlay(a.evidences)
    const playB = sumPlay(b.evidences)
    if (playB !== playA) return playB - playA
    return a.championId - b.championId
  })
}

/** 分数保留 2 位（避免 0.30000000000000004 类浮点噪声进入 UI/断言） */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 证据总场次（同分 tie-break） */
function sumPlay(evidences: PickEvidence[]): number {
  return evidences.reduce((acc, e) => acc + e.play, 0)
}

// ---------- P3 双维推荐（counter 对位 + synergy 协同） ----------

/** 协同证据：候选与某队友的搭档数据（源自队友 intel 的 synergies 列表） */
export interface SynergyEvidence {
  /** 队友（已亮英雄）ID */
  teammateChampionId: number
  /** 搭档位置（队友数据标注，如 ADC/SUPPORT） */
  synergyPosition: string
  /** 与该队友搭档的胜率（0~1） */
  winRate: number
  /** 样本对局数 */
  play: number
}

/** 双维推荐结果：counter（打敌方）+ synergy（配队友）融合 */
export interface DualPick {
  championId: number
  /** 融合分 = counterScore + synergyScore */
  score: number
  /** 对位分：Σ(候选打该敌胜率 - 0.5) */
  counterScore: number
  /** 协同分：Σ(与队友协同胜率 - 0.5) */
  synergyScore: number
  /** 对位证据（沿用 PickEvidence，favored/countered 语义同 computeBestPicks） */
  evidences: PickEvidence[]
  /** 协同证据（与队友的搭档数据） */
  synergyEvidences: SynergyEvidence[]
}

/**
 * 双维推荐：我方候选对敌方已锁的反查对位分 + 对队友已亮的协同分融合排序。
 *
 * 场景：
 * 1. 只有队友已亮 → 纯协同推荐（「辅助预选 X，我 AD 该选谁」）；
 * 2. 只有敌方已锁 → 退化为 computeBestPicks 的对位推荐；
 * 3. 双方都有 → 协同 + 克制双维融合（score = counterScore + synergyScore）。
 *
 * 协同来源：队友的 intel.synergies（OP.GG 搭档列表，含搭档位置与胜率），
 * 对候选 C 直接命中 synergyChampionId === C 的条目；无数据的队友/敌方
 * 记 0 分不编造。排序：融合分降序；同分按证据总场次降序，再按 championId 升序。
 *
 * @param candidateIds - 排除 ban/锁定/intent 后的候选英雄 ID
 * @param enemyIntelById - 敌方已锁英雄 ID → 其 intel（缺测者整队缺席对位分）
 * @param teammateIntelById - 我方已亮队友英雄 ID → 其 intel（缺席者无协同分）
 * @param coverageFirst - 为 true 时优先按 counter 敌方人数排序（覆盖度优先），
 *   同覆盖度按融合分降序；默认 false 按融合分降序
 */
export function computeDualPicks(
  candidateIds: number[],
  enemyIntelById: Map<number, ChampionIntel>,
  teammateIntelById: Map<number, ChampionIntel>,
  coverageFirst = false
): DualPick[] {
  if (candidateIds.length === 0) return []
  if (enemyIntelById.size === 0 && teammateIntelById.size === 0) return []

  const results = candidateIds.map<DualPick>(candidateId => {
    let counterScore = 0
    let synergyScore = 0
    let coverage = 0
    const evidences: PickEvidence[] = []
    const synergyEvidences: SynergyEvidence[] = []

    for (const [enemyId, intel] of enemyIntelById) {
      const entry = intel.counters.find(c => c.championId === candidateId)
      if (!entry) continue
      const winRate = 1 - entry.winRate
      counterScore += winRate - 0.5
      if (winRate >= 0.5) coverage++
      evidences.push({
        againstChampionId: enemyId,
        relation: winRate >= 0.5 ? 'favored' : 'countered',
        winRate,
        play: entry.play
      })
    }

    for (const [teammateId, intel] of teammateIntelById) {
      const entry = intel.synergies.find(s => s.synergyChampionId === candidateId)
      if (!entry) continue
      synergyScore += entry.winRate - 0.5
      synergyEvidences.push({
        teammateChampionId: teammateId,
        synergyPosition: entry.synergyPosition,
        winRate: entry.winRate,
        play: entry.play
      })
    }

    const rawScore = round2(counterScore + synergyScore)
    const score = coverageFirst ? coverage : rawScore
    return {
      championId: candidateId,
      score,
      counterScore: round2(counterScore),
      synergyScore: round2(synergyScore),
      evidences,
      synergyEvidences
    }
  })

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const playA = sumPlay(a.evidences) + sumSynergyPlay(a.synergyEvidences)
    const playB = sumPlay(b.evidences) + sumSynergyPlay(b.synergyEvidences)
    if (playB !== playA) return playB - playA
    return a.championId - b.championId
  })
}

/** 协同证据总场次 */
function sumSynergyPlay(evidences: SynergyEvidence[]): number {
  return evidences.reduce((acc, e) => acc + e.play, 0)
}
