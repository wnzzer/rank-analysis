export type ChangeDirection = 'buff' | 'nerf' | 'adjusted'

/** 召唤师峡谷五个位置。英雄资料库只使用这套稳定的内部值。 */
export type ChampionLane = 'top' | 'jungle' | 'middle' | 'bottom' | 'support'

/** 对位统计支持的段位桶；与快照生成器保持一致。 */
export type MatchupTier =
  'all' | 'gold_plus' | 'platinum_plus' | 'emerald_plus' | 'diamond_plus' | 'master_plus'

export interface ChampionCollectionItem {
  id: number
  name: string
  title: string
  alias: string
  portraitUrl: string | null
  /** 当前版本中有可靠数据的常用分路，而不是战士/法师等职业标签。 */
  lanes: ChampionLane[]
}

export interface ChampionStatValue {
  base: number
  growth: number
  precision?: number
  suffix?: string
}

export interface ChampionStats {
  health: ChampionStatValue
  healthRegen: ChampionStatValue
  resourceName: string
  resource: ChampionStatValue
  resourceRegen: ChampionStatValue
  attackDamage: ChampionStatValue
  armor: ChampionStatValue
  magicResist: ChampionStatValue
  attackSpeed: {
    base: number
    ratio: number
    /** 每级额外攻速百分比，例如 2.2 表示 2.2%。 */
    growth: number
  }
  moveSpeed: number
  attackRange: number
}

export interface AbilityRankValue {
  label: string
  values: Array<number | string>
  suffix?: string
}

export interface ChampionAbility {
  slot: 'P' | 'Q' | 'W' | 'E' | 'R'
  name: string
  description: string
  iconUrl: string
  maxRank: number
  cooldowns: Array<number | string>
  costs: Array<number | string>
  ranges: Array<number | string>
  rankValues: AbilityRankValue[]
}

export interface ChampionDetail extends ChampionCollectionItem {
  shortBio: string
  roles: string[]
  splashUrl: string
  difficulty: number
  attackType?: string
  damageType?: string
  stats: ChampionStats
  abilities: ChampionAbility[]
}

export interface PatchChangeItem {
  championId: number
  direction: ChangeDirection
  lines: string[]
}

export interface PatchCollection {
  label: string
  publishedAt: string
  sourceUrl: string
  isFresh: boolean
  changes: PatchChangeItem[]
}

export interface ChampionCollection {
  source: 'bundledSnapshot' | 'communityDragon'
  dataPatch: string
  generatedAt: string
  champions: ChampionCollectionItem[]
  patch: PatchCollection | null
}

export interface MatchupRow {
  opponentId: number
  winRate: number
  games: number
  goldDiffAt15?: number
  csDiffAt15?: number
  xpDiffAt15?: number
  soloKillRate?: number
}

export interface MatchupSnapshot {
  patch: string
  tier: MatchupTier
  lane: ChampionLane
  region: string
  generatedAt: string
  source: string
  /** true 表示当前只覆盖关键对位，不应被描述为完整矩阵。 */
  isPartial: boolean
  rows: MatchupRow[]
}

export interface OwnedChroma {
  championId: number
  championName: string
  skinId: number
  skinName: string
  chromaId: number
  chromaName: string
  colors: string[]
  skinImageUrl?: string
  chromaImageUrl?: string
}

export interface OwnedChromaCollection {
  summonerName: string
  chromas: OwnedChroma[]
  isPartial: boolean
  warning: string | null
}
