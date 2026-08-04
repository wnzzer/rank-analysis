import type {
  ChampionCollectionItem,
  ChangeDirection,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

export type DirectionFilter = 'all' | ChangeDirection | 'unchanged'

const DIRECTION_ORDER: Record<ChangeDirection | 'unchanged', number> = {
  buff: 0,
  adjusted: 1,
  unchanged: 2,
  nerf: 3
}

export function createChangeMap(changes: PatchChangeItem[]): Map<number, PatchChangeItem> {
  return new Map(changes.map(change => [change.championId, change]))
}

export function filterAndSortChampions(
  champions: ChampionCollectionItem[],
  changes: Map<number, PatchChangeItem>,
  query: string,
  direction: DirectionFilter
): ChampionCollectionItem[] {
  const keyword = query.trim().toLocaleLowerCase()
  return [...champions]
    .filter(champion => {
      const changeDirection = changes.get(champion.id)?.direction ?? 'unchanged'
      const directionMatches = direction === 'all' || changeDirection === direction
      const keywordMatches =
        !keyword ||
        champion.name.toLocaleLowerCase().includes(keyword) ||
        champion.title.toLocaleLowerCase().includes(keyword) ||
        champion.alias.toLocaleLowerCase().includes(keyword)
      return directionMatches && keywordMatches
    })
    .sort((left, right) => {
      const leftDirection = changes.get(left.id)?.direction ?? 'unchanged'
      const rightDirection = changes.get(right.id)?.direction ?? 'unchanged'
      return (
        DIRECTION_ORDER[leftDirection] - DIRECTION_ORDER[rightDirection] ||
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id - right.id
      )
    })
}
