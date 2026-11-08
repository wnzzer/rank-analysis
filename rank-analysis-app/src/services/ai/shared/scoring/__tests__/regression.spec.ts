/**
 * spec 验证 2/3：用户标注的两局真实对局（匿名 fixture，入库基准）+ 构造的单线被单杀局 + 确定性。
 * - A：败方 carry 虚空之女 15/9/9（pid 4）不得判犯罪/被爆；
 *   铁铠冥魂 3/11/9（pid 1）应被点名且为负面标签。
 * - B：败方 carry 奥术先驱 24/11/15（pid 9）不得判犯罪/被爆。
 * - 同局两次运行评分/标签/点名名单完全相同。
 * 注：原型显示两名 carry 既不 ≥P70 也非队内唯一最高，故不要求「被连累」。
 */
import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../../snapshot'
import { buildPuuidMap, remapTimeline } from '../../timeline/remap'
import type { SlimTimeline } from '../../timeline/types'
import { buildScoredAttribution } from '../../../matchDetail/scoredAttribution'
import { scoreSnapshot, selectVerdicts } from '../match'
import { END_METRICS, TIMELINE_METRICS } from '../metrics'
import type { Baseline } from '../baseline'
import type { AttributedDeath } from '../deathAttribution'
import { scorePlayers, type PlayerScoringInput, type ScoringData } from '../scorePlayers'
import type { Thresholds } from '../thresholds'
import a from './fixtures/regression-a.json'
import b from './fixtures/regression-b.json'

const NEGATIVE = ['犯罪', '被爆', '缚地灵']

function snapOf(fx: unknown, withTimeline = true) {
  const { game, slim } = fx as { game: Game; slim: SlimTimeline }
  return buildMatchSnapshot(
    game,
    undefined,
    withTimeline ? remapTimeline(slim, buildPuuidMap(game)) : null
  )
}
const labelOf = (snap: ReturnType<typeof snapOf>, pid: number) =>
  scoreSnapshot(snap).find(s => s.participantId === pid)?.label

describe('回归：标注局 A', () => {
  const snap = snapOf(a)
  it('败方 carry 虚空之女 15/9/9 不判犯罪/被爆', () => {
    expect(['犯罪', '被爆']).not.toContain(labelOf(snap, 4))
  })
  it('铁铠冥魂 3/11/9 被点名且为负面标签', () => {
    const chosen = selectVerdicts(snap.players, scoreSnapshot(snap))
    const v = chosen.find(x => x.participantId === 1)
    expect(v).toBeDefined()
    expect(NEGATIVE).toContain(v!.label)
  })
  it('无时间线时虚空之女也不得判犯罪', () => {
    expect(labelOf(snapOf(a, false), 4)).not.toBe('犯罪')
  })
})

describe('回归：标注局 B', () => {
  it('败方 carry 奥术先驱 24/11/15 不判犯罪/被爆', () => {
    expect(['犯罪', '被爆']).not.toContain(labelOf(snapOf(b), 9))
  })
})

describe('构造局：单线被单杀 ≥3 次、无 gank', () => {
  const UNIT: Baseline = {
    meta: { builtAt: '', versions: [], sampleGames: 0, detailsGames: 0, perQueue: {}, note: '' },
    cells: {
      '420|*|*': {
        n: 1000,
        metrics: Object.fromEntries(
          [...END_METRICS, ...TIMELINE_METRICS].map(m => [m, { mean: 0, std: 1 }])
        )
      }
    }
  }
  const TH: Thresholds = {
    meta: { builtAt: '', sampleGames: 0 },
    cells: {
      '*|*|tl': {
        n: 1000,
        total: [-0.8, -0.5, -0.3, -0.1, 0, 0.15, 0.3, 0.5, 0.8],
        sub: {
          lane: [-1.5, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.5],
          deathQuality: [-1.4, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.4],
          teamfight: [-1.2, -0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.8, 1.2],
          growth: [-1.2, -0.8, -0.5, -0.2, 0, 0.3, 0.5, 0.8, 1.2]
        }
      }
    }
  }
  const DATA: ScoringData = { baseline: UNIT, thresholds: TH }
  const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
  const zero = <T extends string>(names: readonly T[]) =>
    Object.fromEntries(names.map(m => [m, 0])) as Record<T, number>
  const solo = (minute: number): AttributedDeath => ({
    victimId: 1,
    timestamp: minute * 60000,
    kind: 'solo',
    responsibility: 1,
    consequence: 1
  })

  it('对线期被对位单杀 3 次、队友正常 → 负面标签且无减责证据', () => {
    const players: PlayerScoringInput[] = Array.from({ length: 10 }, (_, i) => {
      const pid = i + 1
      const base: PlayerScoringInput = {
        participantId: pid,
        teamId: pid <= 5 ? 100 : 200,
        win: pid > 5,
        position: POS[i % 5],
        championId: pid,
        end: zero(END_METRICS) as PlayerScoringInput['end'],
        timeline: zero(TIMELINE_METRICS) as PlayerScoringInput['timeline'],
        deaths: []
      }
      if (pid !== 1) return base
      return {
        ...base,
        timeline: {
          ...base.timeline!,
          goldDiff14: -1,
          xpDiff14: -1,
          csDiff14: -1,
          deathCostPerMin: 2
        },
        deaths: [solo(4), solo(7), solo(10)]
      }
    })
    const s = scorePlayers(players, { queueId: 420, hasLanes: true }, DATA)[0]
    expect(NEGATIVE).toContain(s.label)
    expect(s.mitigation.mitigated).toBe(false)
    expect(s.mitigation.reasons).toEqual([])
  })
})

describe('确定性', () => {
  it('同局两次运行：评分、标签、点名名单与归因骨架完全相同', () => {
    for (const fx of [a, b]) {
      const s1 = snapOf(fx)
      const s2 = snapOf(fx)
      const r1 = scoreSnapshot(s1)
      const r2 = scoreSnapshot(s2)
      expect(r1).toEqual(r2)
      expect(r1.map(s => s.label)).toEqual(r2.map(s => s.label))
      expect(selectVerdicts(s1.players, r1)).toEqual(selectVerdicts(s2.players, r2))
      expect(buildScoredAttribution(s1)).toEqual(buildScoredAttribution(s2))
    }
  })
})
