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
): PositionAssignInput => ({
  championId,
  spellIds,
  minionsKilled: cs,
  jungleMinionsKilled: jungleCs
})

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
    expect(assignTeamPositions(TEAM_LOSS)).toEqual(['TOP', 'JUNGLE', 'BOTTOM', 'MIDDLE', 'UTILITY'])
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

/**
 * 真实 fixture:2026-10-25 单双排 301041798766 蓝方(participantId 1-5)。
 * 悟空点燃上单、维克托传送下路(APC 配悠米)。排除法把悟空推成下路、
 * 维克托推成上单;timeline 前 10 分钟坐标证实 participantId 槽位才是真相。
 */
const withPid = (pid: number, input: PositionAssignInput): PositionAssignInput => ({
  ...input,
  participantId: pid
})
const TEAM_APC_BOT = [
  withPid(1, p(62, [14, 4], 208, 0)),
  withPid(2, p(64, [4, 11], 46, 236)),
  withPid(3, p(246, [14, 4], 188, 29)),
  withPid(4, p(112, [4, 12], 207, 0)),
  withPid(5, p(350, [3, 7], 27, 4))
]
const SLOT_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

describe('assignTeamPositions · 排位槽位顺序', () => {
  it('排位队列按 participantId 槽位取分路(APC 下路不再被推成上单)', () => {
    expect(assignTeamPositions(TEAM_APC_BOT, 420)).toEqual(SLOT_ORDER)
  })

  it('红方 participantId 6-10 同样按槽位', () => {
    const red = TEAM_APC_BOT.map(x => ({ ...x, participantId: x.participantId! + 5 }))
    expect(assignTeamPositions(red, 440)).toEqual(SLOT_ORDER)
  })

  it('输入乱序时按 participantId 归位,返回仍与输入同序', () => {
    const shuffled = [
      TEAM_APC_BOT[3],
      TEAM_APC_BOT[0],
      TEAM_APC_BOT[4],
      TEAM_APC_BOT[1],
      TEAM_APC_BOT[2]
    ]
    expect(assignTeamPositions(shuffled, 420)).toEqual([
      'BOTTOM',
      'TOP',
      'UTILITY',
      'JUNGLE',
      'MIDDLE'
    ])
  })

  it('槽位 2 不是打野(惩戒不在槽 2)时不信槽位,回退排除法', () => {
    const swapped = [
      withPid(1, p(64, [4, 11], 46, 236)),
      withPid(2, p(62, [14, 4], 208, 0)),
      ...TEAM_APC_BOT.slice(2)
    ]
    expect(assignTeamPositions(swapped, 420)[0]).toBe('JUNGLE')
  })

  it('非选秀队列(盲选 430)不信槽位', () => {
    expect(assignTeamPositions(TEAM_APC_BOT, 430)).not.toEqual(SLOT_ORDER)
  })

  it('缺 participantId 时回退排除法', () => {
    expect(assignTeamPositions(TEAM_LOSS, 420)).toEqual([
      'TOP',
      'JUNGLE',
      'BOTTOM',
      'MIDDLE',
      'UTILITY'
    ])
  })
})
