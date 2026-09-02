import { describe, it, expect } from 'vitest'
import { assignTeamPositions, type PositionAssignInput } from '../positionAssign'

/**
 * 真实 fixture:2026-09-02 单双排 28:56 一局(国服 teamPosition 全缺)。
 * 旧的逐人启发式在这局把 蛮王/波比(上单)、星籁歌姬/时光守护者(辅助)
 * 全推成 UNKNOWN,导致辅助保护规则与对位比较全部失效。
 */
const p = (
  championId: number,
  spellIds: number[],
  cs: number,
  jungleCs: number
): PositionAssignInput => ({ championId, spellIds, minionsKilled: cs, jungleMinionsKilled: jungleCs })

/** 败方:蛮王(上) 男枪(野) 卢锡安(下) 维克托(中) 星籁歌姬(辅) */
const TEAM_LOSS = [
  p(23, [14, 6], 206, 4),
  p(104, [11, 4], 32, 164),
  p(236, [4, 1], 150, 0),
  p(112, [4, 12], 175, 0),
  p(147, [4, 14], 50, 0)
]

/** 胜方:波比(上) 悟空(野) 阿狸(中) 女枪(下) 基兰(辅) */
const TEAM_WIN = [
  p(78, [14, 4], 141, 0),
  p(62, [11, 4], 29, 184),
  p(103, [14, 4], 172, 8),
  p(21, [4, 21], 196, 0),
  p(26, [4, 3], 50, 0)
]

describe('assignTeamPositions', () => {
  it('真实败方阵容:五个位置全部推对(含旧启发式推不出的上单/辅助)', () => {
    expect(assignTeamPositions(TEAM_LOSS)).toEqual([
      'TOP',
      'JUNGLE',
      'BOTTOM',
      'MIDDLE',
      'UTILITY'
    ])
  })

  it('真实胜方阵容:五个位置全部推对', () => {
    expect(assignTeamPositions(TEAM_WIN)).toEqual(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
  })

  it('打野优先看惩戒,无惩戒看吃野量', () => {
    const team = [
      p(23, [14, 6], 200, 0),
      p(64, [4, 14], 40, 150), // 盲僧没带惩戒但野怪 150
      p(236, [4, 7], 160, 0),
      p(112, [4, 12], 170, 0),
      p(147, [4, 14], 30, 0)
    ]
    expect(assignTeamPositions(team)[1]).toBe('JUNGLE')
  })

  it('非 5 人队伍逐人回退旧启发式,不做排除法', () => {
    const team = [p(104, [11, 4], 32, 164), p(51, [4, 7], 200, 0)]
    expect(assignTeamPositions(team)).toEqual(['JUNGLE', 'BOTTOM'])
  })

  it('每个位置恰好出现一次(排除法不产生重复)', () => {
    const out = assignTeamPositions(TEAM_LOSS)
    expect(new Set(out).size).toBe(5)
  })
})
