import { describe, it, expect } from 'vitest'
import type { ParticipantStats } from '@renderer/types/domain/match'
import type { SgpFrame, SgpGameDetail, SgpFrameParticipantStats } from '@renderer/services/sgp'
import {
  SGP_FRAME_ROWS,
  aggregateSgpFrameStats,
  buildSgpFrameRows,
  type SgpFrameRowSource
} from './sgpFrameStats'
import type { StatsTablePlayer } from './detailsTable'

function makeStats(): ParticipantStats {
  return {
    win: true,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    perk0: 0,
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    goldEarned: 0,
    goldSpent: 0,
    totalDamageDealtToChampions: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalHeal: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    damageDealtToTurrets: 0,
    groupRate: 0,
    goldEarnedRate: 0,
    damageDealtToChampionsRate: 0,
    damageTakenRate: 0,
    healRate: 0,
    playerSubteamId: 0,
    subteamPlacement: 0
  }
}

function makePlayer(participantId: number): StatsTablePlayer {
  return {
    index: participantId,
    participantId,
    teamId: participantId <= 5 ? 100 : 200,
    displayName: `P${participantId}`,
    championId: 1,
    win: participantId <= 5,
    spell1Id: 4,
    spell2Id: 11,
    stats: makeStats()
  }
}

function makeDetail(frames: SgpFrame[]): SgpGameDetail {
  return { endOfGameResult: null, frameInterval: null, frames, participants: [] }
}

function makeSource(partial: Partial<SgpFrameRowSource>): SgpFrameRowSource {
  return {
    controlTime: 0,
    attackDamage: NaN,
    attackSpeed: NaN,
    armor: NaN,
    magicResist: NaN,
    healthMax: NaN,
    movementSpeed: NaN,
    power: NaN,
    ...partial
  }
}

describe('aggregateSgpFrameStats', () => {
  it('null/undefined 详情返回空 Map', () => {
    expect(aggregateSgpFrameStats(null).size).toBe(0)
    expect(aggregateSgpFrameStats(undefined).size).toBe(0)
  })

  it('控制时间跨帧累加，championStats 末帧覆盖生效', () => {
    const detail = makeDetail([
      {
        timestamp: 1,
        events: [],
        participantFrames: {
          1: { timeEnemySpentControlled: 12, championStats: { attackDamage: 100 } },
          2: { timeEnemySpentControlled: 8 }
        }
      },
      {
        timestamp: 2,
        events: [],
        participantFrames: {
          1: { timeEnemySpentControlled: 30, championStats: { attackDamage: 180, power: 350 } },
          2: { timeEnemySpentControlled: 15 }
        }
      }
    ])
    const aggs = aggregateSgpFrameStats(detail)
    expect(aggs.get(1)).toEqual(makeSource({ controlTime: 42, attackDamage: 180, power: 350 }))
    // 玩家 2 无 championStats：属性字段保持 NaN
    expect(aggs.get(2)).toEqual(makeSource({ controlTime: 23 }))
  })

  it('championStats 缺失字段不覆盖已有值；无帧玩家不在 Map', () => {
    const detail = makeDetail([
      {
        timestamp: 1,
        events: [],
        participantFrames: {
          1: { championStats: { attackDamage: 90, armor: 40 } }
        }
      },
      {
        timestamp: 2,
        events: [],
        participantFrames: {
          1: { championStats: { attackDamage: null, movementSpeed: 350 } }
        }
      }
    ])
    const aggs = aggregateSgpFrameStats(detail)
    // attackDamage null 不覆盖 90；movementSpeed 补上
    expect(aggs.get(1)?.attackDamage).toBe(90)
    expect(aggs.get(1)?.armor).toBe(40)
    expect(aggs.get(1)?.movementSpeed).toBe(350)
    expect(aggs.has(2)).toBe(false)
  })

  it('非数字 participantId 键被忽略', () => {
    const detail = makeDetail([
      {
        timestamp: 1,
        events: [],
        // SGP JSON 的键是字符串，类型只声明 number——运行时乱键靠聚合器兜底
        participantFrames: { abc: { timeEnemySpentControlled: 5 } } as unknown as Record<
          number,
          SgpFrameParticipantStats
        >
      }
    ])
    expect(aggregateSgpFrameStats(detail).size).toBe(0)
  })
})

describe('buildSgpFrameRows', () => {
  it('行数 = SGP_FRAME_ROWS 数，值与列序（players participantId）一一对应', () => {
    const players = [makePlayer(1), makePlayer(6)]
    const aggs = new Map<number, SgpFrameRowSource>([
      [1, makeSource({ controlTime: 42, attackDamage: 180 })],
      [6, makeSource({ controlTime: 60, attackDamage: 220 })]
    ])
    const rows = buildSgpFrameRows(players, aggs)
    expect(rows).toHaveLength(SGP_FRAME_ROWS.length)
    const control = rows.find(r => r.def.key === 'controlTime')!
    expect(control.values).toEqual([42, 60])
    expect(control.max).toBe(60)
    const ad = rows.find(r => r.def.key === 'attackDamage')!
    expect(ad.values).toEqual([180, 220])
  })

  it('帧里缺失的玩家 → 该列全 NaN，max 忽略 NaN', () => {
    const players = [makePlayer(1), makePlayer(6)]
    const aggs = new Map<number, SgpFrameRowSource>([[1, makeSource({ controlTime: 42 })]])
    const rows = buildSgpFrameRows(players, aggs)
    const control = rows.find(r => r.def.key === 'controlTime')!
    expect(control.values).toEqual([42, NaN])
    expect(control.max).toBe(42)
    const ad = rows.find(r => r.def.key === 'attackDamage')!
    expect(ad.values.every(Number.isNaN)).toBe(true)
    expect(ad.max).toBe(0)
  })

  it('展示格式：控制时间 秒→分:秒，攻速两位小数', () => {
    const players = [makePlayer(1)]
    const aggs = new Map<number, SgpFrameRowSource>([
      [1, makeSource({ controlTime: 431, attackSpeed: 1.256 })]
    ])
    const rows = buildSgpFrameRows(players, aggs)
    const control = rows.find(r => r.def.key === 'controlTime')!
    const speed = rows.find(r => r.def.key === 'attackSpeed')!
    expect(control.def.format(431)).toBe('7:11')
    expect(speed.def.format(1.256)).toBe('1.26')
  })
})
