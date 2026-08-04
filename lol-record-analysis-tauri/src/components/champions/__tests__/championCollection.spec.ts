import { describe, expect, it } from 'vitest'
import { createChangeMap, filterAndSortChampions } from '../championCollection'
import type {
  ChampionCollectionItem,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

const champions: ChampionCollectionItem[] = [
  { id: 1, name: '安妮', title: '黑暗之女', alias: 'Annie', portraitUrl: null },
  { id: 2, name: '奥拉夫', title: '狂战士', alias: 'Olaf', portraitUrl: null },
  { id: 3, name: '加里奥', title: '正义巨像', alias: 'Galio', portraitUrl: null },
  { id: 4, name: '崔斯特', title: '卡牌大师', alias: 'TwistedFate', portraitUrl: null }
]
const changes: PatchChangeItem[] = [
  { championId: 1, direction: 'nerf', lines: [] },
  { championId: 2, direction: 'buff', lines: [] },
  { championId: 3, direction: 'adjusted', lines: [] }
]

describe('filterAndSortChampions', () => {
  it('sorts buffs first and nerfs last', () => {
    expect(
      filterAndSortChampions(champions, createChangeMap(changes), '', 'all').map(item => item.id)
    ).toEqual([2, 3, 4, 1])
  })

  it('searches Chinese names, titles and aliases', () => {
    const map = createChangeMap(changes)
    expect(filterAndSortChampions(champions, map, 'twisted', 'all').map(item => item.id)).toEqual([
      4
    ])
    expect(filterAndSortChampions(champions, map, '狂战', 'all').map(item => item.id)).toEqual([2])
  })

  it('filters by official change direction', () => {
    expect(
      filterAndSortChampions(champions, createChangeMap(changes), '', 'unchanged').map(
        item => item.id
      )
    ).toEqual([4])
  })
})
