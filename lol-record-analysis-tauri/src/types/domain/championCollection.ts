export type ChangeDirection = 'buff' | 'nerf' | 'adjusted'

export interface ChampionCollectionItem {
  id: number
  name: string
  title: string
  alias: string
  portraitUrl: string | null
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
  source: 'lcu' | 'communityDragon'
  champions: ChampionCollectionItem[]
  patch: PatchCollection | null
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
