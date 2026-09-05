import { describe, it, expect } from 'vitest'
import { emptyQuery } from '../schema'
import { queryToChips, removeChipFromQuery } from '../chips'

const championName = (id: number) => ({ 51: '皮城女警', 222: '暴走萝莉' })[id] ?? `英雄${id}`
const queueName = (id: number) => ({ 420: '单双排位' })[id] ?? `队列${id}`

function fullQuery() {
  return {
    ...emptyQuery(),
    timeRange: { from: '2026-08-01', to: '2026-08-31' },
    selfChampionIds: [51],
    allyChampionIds: [222],
    enemyChampionIds: [36],
    myTeamChampionIds: [64],
    result: 'win' as const,
    queueIds: [420],
    playerNames: ['某人#123'],
    intent: 'count_encounters' as const
  }
}

describe('queryToChips', () => {
  it('空条件不产 chips', () => {
    expect(queryToChips(emptyQuery(), championName, queueName)).toEqual([])
  })

  it('每个条件维度一枚 chip,带人类可读 label', () => {
    const chips = queryToChips(fullQuery(), championName, queueName)
    const labels = chips.map(c => c.label).join('|')
    expect(labels).toContain('2026-08-01')
    expect(labels).toContain('皮城女警')
    expect(labels).toContain('暴走萝莉')
    expect(labels).toContain('单双排位')
    expect(labels).toContain('胜')
    expect(labels).toContain('某人#123')
    // key 唯一
    expect(new Set(chips.map(c => c.key)).size).toBe(chips.length)
  })

  it('仅 from 或仅 to 的时间窗也能产出可读 chip', () => {
    const chips = queryToChips(
      { ...emptyQuery(), timeRange: { from: '2026-08-01', to: null } },
      championName,
      queueName
    )
    expect(chips).toHaveLength(1)
    expect(chips[0].label).toContain('2026-08-01')
  })
})

describe('removeChipFromQuery', () => {
  it('删除 chip 后对应条件被清空,其余保留', () => {
    const q = fullQuery()
    const chips = queryToChips(q, championName, queueName)
    const allyChip = chips.find(c => c.key === 'ally:222')!
    const next = removeChipFromQuery(q, allyChip.key)
    expect(next.allyChampionIds).toEqual([])
    expect(next.selfChampionIds).toEqual([51])
    // 原对象不被修改
    expect(q.allyChampionIds).toEqual([222])
  })

  it('删除时间 chip 清空整个时间窗', () => {
    const next = removeChipFromQuery(fullQuery(), 'time')
    expect(next.timeRange).toEqual({ from: null, to: null })
  })

  it('删除玩家名 chip 时 count 意图退回 list', () => {
    const q = fullQuery()
    const next = removeChipFromQuery(q, 'player:某人#123')
    expect(next.playerNames).toEqual([])
    expect(next.intent).toBe('list')
  })

  it('未知 key 原样返回', () => {
    const q = fullQuery()
    expect(removeChipFromQuery(q, 'nope')).toEqual(q)
  })
})

describe('selfPositions chips', () => {
  it('位置条件产出中文 chip 且可删除', () => {
    const q = { ...emptyQuery(), selfPositions: ['UTILITY' as const, 'JUNGLE' as const] }
    const chips = queryToChips(q, championName, queueName)
    expect(chips.map(c => c.label)).toEqual(['我玩: 辅助', '我玩: 打野'])
    const next = removeChipFromQuery(q, 'pos:UTILITY')
    expect(next.selfPositions).toEqual(['JUNGLE'])
  })
})
