/**
 * minuteCurve 纯函数单测：单局曲线（CS/死亡/参团）+ 跨局聚合。
 * 帧结构按 SGP DETAILS 形状构造（字段可选，容错路径全覆盖）。
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateMinuteCurves,
  buildGameMinuteCurve,
  MAX_CURVE_MINUTES,
  summarizeMinuteCurve,
  type AggregatedMinuteCurve,
  type SgpGameDetail
} from './minuteCurve'

/** 便捷构造：指定分钟戳的帧（participantFrames 只放所需玩家） */
function frame(
  minute: number,
  pid: number,
  stats: { cs?: number; jungleCs?: number } = {}
): NonNullable<SgpGameDetail['frames']>[number] {
  return {
    timestamp: minute * 60_000,
    events: [],
    participantFrames: {
      [pid]: {
        minionsKilled: stats.cs,
        jungleMinionsKilled: stats.jungleCs
      }
    } as NonNullable<SgpGameDetail['frames']>[number]['participantFrames']
  }
}

/** 便捷构造：击杀事件（可带助攻列表） */
function kill(
  minute: number,
  victim: number,
  killer: number,
  assists: number[] = []
): {
  timestamp: number
  events: NonNullable<NonNullable<SgpGameDetail['frames']>[number]['events']>
  participantFrames: NonNullable<SgpGameDetail['frames']>[number]['participantFrames']
} {
  return {
    timestamp: minute * 60_000,
    events: [
      {
        type: 'CHAMPION_KILL',
        victimId: victim,
        killerId: killer,
        assistingParticipantIds: assists
      }
    ],
    participantFrames: {}
  }
}

const SELF_PUUID = 'puuid-me'

function detailOf(
  frames: NonNullable<SgpGameDetail['frames']>,
  participants: NonNullable<SgpGameDetail['participants']> = [
    { participantId: 10, puuid: SELF_PUUID }
  ]
): SgpGameDetail {
  return { frames, participants }
}

describe('buildGameMinuteCurve', () => {
  it('无帧 / 无自身 puuid → null', () => {
    expect(buildGameMinuteCurve(detailOf([]), SELF_PUUID)).toBeNull()
    expect(buildGameMinuteCurve(null, SELF_PUUID)).toBeNull()
    expect(
      buildGameMinuteCurve(
        detailOf([frame(1, 10)], [{ participantId: 10, puuid: 'puuid-other' }]),
        SELF_PUUID
      )
    ).toBeNull()
    expect(buildGameMinuteCurve(detailOf([frame(1, 10)]), '')).toBeNull()
  })

  it('CS 累计：稀疏帧铺满分钟轴，缺帧沿用前值', () => {
    const detail = detailOf([frame(0, 10, { cs: 2 }), frame(3, 10, { cs: 5 })])
    const curve = buildGameMinuteCurve(detail, SELF_PUUID)!
    expect(curve.minutes).toEqual([0, 1, 2, 3])
    expect(curve.csByMinute).toEqual([2, 2, 2, 5])
  })

  it('CS 含野怪（minionsKilled + jungleMinionsKilled）', () => {
    const detail = detailOf([frame(0, 10, { cs: 3, jungleCs: 4 })])
    const curve = buildGameMinuteCurve(detail, SELF_PUUID)!
    expect(curve.csByMinute[0]).toBe(7)
  })

  it('死亡累计单调不减；参团按击杀/助攻计', () => {
    const frames = [
      frame(0, 10),
      kill(1, 10, 20), // 自己死
      kill(2, 30, 10), // 自己击杀
      kill(3, 40, 20, [10]), // 自己助攻
      kill(3, 50, 20, [99]) // 无关
    ]
    const curve = buildGameMinuteCurve(detailOf(frames), SELF_PUUID)!
    // 分钟轴 0..3
    expect(curve.deathsByMinute).toEqual([0, 1, 1, 1])
    expect(curve.fightsByMinute).toEqual([0, 0, 1, 1])
  })

  it('非 CHAMPION_KILL 事件不计入（只认击杀口径）', () => {
    const frames = [
      frame(0, 10),
      {
        timestamp: 60_000,
        events: [
          { type: 'BUILDING_KILL', victimId: 10 },
          { type: 'CHAMPION_SPECIAL_KILL', killerId: 10, victimId: 99 }
        ],
        participantFrames: {}
      }
    ]
    const curve = buildGameMinuteCurve(detailOf(frames), SELF_PUUID)!
    expect(curve.deathsByMinute[1]).toBe(0)
    expect(curve.fightsByMinute[1]).toBe(0)
  })

  it('超长局分钟轴封顶 MAX_CURVE_MINUTES', () => {
    const frames = [frame(0, 10), frame(MAX_CURVE_MINUTES + 30, 10, { cs: 300 })]
    const curve = buildGameMinuteCurve(detailOf(frames), SELF_PUUID)!
    expect(curve.minutes).toHaveLength(MAX_CURVE_MINUTES + 1)
  })

  it('无自身 participantFrames 的帧不报错（CS 沿用前值）', () => {
    const frames = [frame(0, 99, { cs: 5 }), frame(1, 10, { cs: 3 })]
    const curve = buildGameMinuteCurve(detailOf(frames), SELF_PUUID)!
    expect(curve.csByMinute[0]).toBe(0)
    expect(curve.csByMinute[1]).toBe(3)
  })
})

describe('aggregateMinuteCurves', () => {
  function curveOf(cs: number[], deaths: number[], fights: number[]) {
    const minutes = cs.map((_, m) => m)
    return { minutes, csByMinute: cs, deathsByMinute: deaths, fightsByMinute: fights }
  }

  it('多局场均：CS 取平均，死亡/参团取平均', () => {
    const a = curveOf([2, 5], [0, 1], [0, 1])
    const b = curveOf([4, 9], [0, 2], [0, 3])
    const agg = aggregateMinuteCurves([a, b])!
    expect(agg.sourceCount).toBe(2)
    expect(agg.minutes).toEqual([0, 1])
    expect(agg.cs).toEqual([3, 7])
    expect(agg.deaths).toEqual([0, 1.5])
    expect(agg.fights).toEqual([0, 2])
  })

  it('对齐最长轴：短局缺失分钟按末值延伸', () => {
    const a = curveOf([2], [0], [0])
    const b = curveOf([4, 9, 12], [0, 1, 1], [0, 2, 2])
    const agg = aggregateMinuteCurves([a, b])!
    expect(agg.minutes).toEqual([0, 1, 2])
    expect(agg.cs).toEqual([3, 9, 12])
  })

  it('全部 null → null；部分 null 只统计有效局', () => {
    expect(aggregateMinuteCurves([null, null])).toBeNull()
    const agg = aggregateMinuteCurves([null, curveOf([4, 9], [0, 1], [0, 2])])!
    expect(agg.sourceCount).toBe(1)
    expect(agg.cs).toEqual([4, 9])
  })

  it('空列表 → null', () => {
    expect(aggregateMinuteCurves([])).toBeNull()
  })
})

describe('summarizeMinuteCurve（分时画像特征）', () => {
  function aggOf(
    cs: number[],
    deaths: number[],
    fights: number[],
    sourceCount = 3
  ): AggregatedMinuteCurve {
    return {
      minutes: cs.map((_, m) => m),
      cs,
      deaths,
      fights,
      sourceCount
    }
  }

  it('null / 空轴 → null', () => {
    expect(summarizeMinuteCurve(null)).toBeNull()
    expect(summarizeMinuteCurve(aggOf([], [], []))).toBeNull()
  })

  it('补刀取 15/25 分钟锚点，轴不足时取末值', () => {
    // 轴不足（0..6 分钟）→ 15 分钟锚点取末值
    const short = summarizeMinuteCurve(
      aggOf([0, 5, 10, 16, 20, 24, 28], [0, 1, 1, 1, 1, 1, 1], [0, 0, 0, 1, 1, 1, 1])
    )!
    expect(short.csAt15).toBe(28)
    expect(short.csAt25).toBe(28)
    // 轴充足（0..30 分钟）→ 取 index 15 / 25
    const cs = Array.from({ length: 31 }, (_, m) => m * 2)
    const long = summarizeMinuteCurve(aggOf(cs, new Array(31).fill(0), new Array(31).fill(0)))!
    expect(long.csAt15).toBe(30)
    expect(long.csAt25).toBe(50)
  })

  it('死亡集中段 = 累计增速最快的分钟段', () => {
    // 0..4 分钟死亡 0,0,2,3,4：增速峰值在 minute2（+2），并列段按升序收尾
    const s = summarizeMinuteCurve(aggOf([0, 1, 2, 3, 4], [0, 0, 2, 3, 4], [0, 0, 0, 0, 0]))!
    expect(s.deathsBy15).toBe(4)
    expect(s.deathsTotal).toBe(4)
    expect(s.deathSpikeMinutes[0]).toBe(2) // 增速最快的段
    expect(s.deathSpikeMinutes.length).toBeLessThanOrEqual(3)
    expect(s.fightPeakMinutes).toEqual([])
    expect(s.avgFightsPerMin).toBe(0)
  })

  it('参团活跃段取事件数最高的分钟', () => {
    const s = summarizeMinuteCurve(aggOf([0, 1, 2], [0, 0, 0], [0, 3, 0]))!
    expect(s.fightPeakMinutes).toEqual([1])
    expect(s.avgFightsPerMin).toBe(1)
  })

  it('累计死亡 spike 最多 3 个且升序', () => {
    const s = summarizeMinuteCurve(
      aggOf([0, 1, 2, 3, 4, 5], [0, 0, 1, 2, 3, 3], [0, 0, 0, 0, 0, 0])
    )!
    expect(s.deathSpikeMinutes.length).toBeLessThanOrEqual(3)
  })
})
