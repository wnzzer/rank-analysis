import { describe, it, expect } from 'vitest'
import { emptyQuery, validateParsedQuery } from '../schema'

const CHAMPS = new Set([51, 222, 36, 64])
const QUEUES = new Set([420, 440, 450])

describe('emptyQuery', () => {
  it('返回全空条件(不筛任何东西)', () => {
    const q = emptyQuery()
    expect(q.timeRange).toEqual({ from: null, to: null })
    expect(q.selfChampionIds).toEqual([])
    expect(q.allyChampionIds).toEqual([])
    expect(q.enemyChampionIds).toEqual([])
    expect(q.myTeamChampionIds).toEqual([])
    expect(q.result).toBe('any')
    expect(q.queueIds).toEqual([])
    expect(q.playerNames).toEqual([])
    expect(q.intent).toBe('list')
  })
})

describe('validateParsedQuery', () => {
  it('合法输入原样通过', () => {
    const q = validateParsedQuery(
      {
        timeRange: { from: '2026-08-01', to: '2026-08-31' },
        selfChampionIds: [51],
        allyChampionIds: [222],
        enemyChampionIds: [36],
        myTeamChampionIds: [],
        result: 'win',
        queueIds: [420],
        playerNames: ['某人#12345'],
        intent: 'count_encounters'
      },
      CHAMPS,
      QUEUES
    )
    expect(q.selfChampionIds).toEqual([51])
    expect(q.allyChampionIds).toEqual([222])
    expect(q.result).toBe('win')
    expect(q.queueIds).toEqual([420])
    expect(q.intent).toBe('count_encounters')
    expect(q.timeRange).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('清单外英雄 id 被剔除,非数字被剔除', () => {
    const q = validateParsedQuery(
      { selfChampionIds: [51, 99999, '64', null], allyChampionIds: [1] },
      CHAMPS,
      QUEUES
    )
    expect(q.selfChampionIds).toEqual([51])
    expect(q.allyChampionIds).toEqual([])
  })

  it('带时间的 ISO 串被规范化为纯日期(下游拼 T00:00:00 不会炸)', () => {
    const q = validateParsedQuery(
      { timeRange: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T15:30:00.000Z' } },
      CHAMPS,
      QUEUES
    )
    expect(q.timeRange).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('非法日期与 from>to 都降级为 null', () => {
    const bad = validateParsedQuery(
      { timeRange: { from: 'abc', to: '2026-08-01' } },
      CHAMPS,
      QUEUES
    )
    expect(bad.timeRange.from).toBeNull()
    expect(bad.timeRange.to).toBe('2026-08-01')

    const inverted = validateParsedQuery(
      { timeRange: { from: '2026-08-31', to: '2026-08-01' } },
      CHAMPS,
      QUEUES
    )
    expect(inverted.timeRange).toEqual({ from: null, to: null })
  })

  it('非法枚举降级:result→any,intent→list', () => {
    const q = validateParsedQuery({ result: 'DRAW', intent: 'summarize' }, CHAMPS, QUEUES)
    expect(q.result).toBe('any')
    expect(q.intent).toBe('list')
  })

  it('清单外 queueId 被剔除', () => {
    const q = validateParsedQuery({ queueIds: [420, 9999] }, CHAMPS, QUEUES)
    expect(q.queueIds).toEqual([420])
  })

  it('playerNames 去空白、去重、丢弃非字符串', () => {
    const q = validateParsedQuery(
      { playerNames: [' 某人#123 ', '某人#123', '', 42, null] },
      CHAMPS,
      QUEUES
    )
    expect(q.playerNames).toEqual(['某人#123'])
  })

  it('完全不是对象时返回空条件', () => {
    expect(validateParsedQuery(null, CHAMPS, QUEUES)).toEqual(emptyQuery())
    expect(validateParsedQuery('gibberish', CHAMPS, QUEUES)).toEqual(emptyQuery())
  })
})
