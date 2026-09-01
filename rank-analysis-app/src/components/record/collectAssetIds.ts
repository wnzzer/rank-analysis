/**
 * 从一批对局中收集需要预载的资产 ID(装备/召唤师技能/符文强化)
 *
 * 战绩列表(MatchHistory / AiSearchResults)在父级一次性去重收集后下发 IPC,
 * 子 RecordCard 经 inject 共享,跳过自身 preload。
 */

import type { Game } from '@renderer/types/domain/match'

export function collectAssetIds(games: Game[] | undefined): {
  items: number[]
  spells: number[]
  perks: number[]
} {
  const items = new Set<number>()
  const spells = new Set<number>()
  const perks = new Set<number>()
  for (const g of games ?? []) {
    const s = g.participants[0]?.stats
    if (!s) continue
    ;[s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].forEach(id => {
      if (id > 0) items.add(id)
    })
    ;[g.participants[0].spell1Id, g.participants[0].spell2Id].forEach(id => {
      if (id > 0) spells.add(id)
    })
    ;[
      s.playerAugment1,
      s.playerAugment2,
      s.playerAugment3,
      s.playerAugment4,
      s.playerAugment5,
      s.playerAugment6
    ].forEach(id => {
      if (id > 0) perks.add(id)
    })
  }
  return {
    items: [...items],
    spells: [...spells],
    perks: [...perks]
  }
}
