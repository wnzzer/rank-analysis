import { describe, it, expect } from 'vitest'
import { validateAttribution } from '../validator'
import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

function snapshotWithPlayer(opts: {
  participantId: number
  teamId: number
  isOffRole?: boolean
  isFirstTimeInRecent?: boolean
  otherPlayers?: Array<{ participantId: number; teamId: number }>
}): MatchSnapshot {
  const players: any[] = [
    {
      participantId: opts.participantId,
      teamId: opts.teamId,
      name: 'TestPlayer',
      recentProfile: {
        isOffRole: opts.isOffRole ?? false,
        offRoleSeverity: opts.isOffRole ? 'severe' : 'none',
        currentChampionMastery: opts.isFirstTimeInRecent
          ? {
              gamesInRecent: 0,
              winRate: 0,
              avgKda: 0,
              isOnetrick: false,
              isFirstTimeInRecent: true
            }
          : {
              gamesInRecent: 5,
              winRate: 0.6,
              avgKda: 2.5,
              isOnetrick: false,
              isFirstTimeInRecent: false
            }
      }
    },
    ...(opts.otherPlayers ?? []).map(p => ({
      participantId: p.participantId,
      teamId: p.teamId,
      name: `P${p.participantId}`,
      recentProfile: null
    }))
  ]
  return { players } as unknown as MatchSnapshot
}

function validVerdict(participantId: number, label = '正常', mitigatingFactors: any[] = []) {
  return {
    participantId,
    name: `P${participantId}`,
    label,
    evidenceMetrics: [
      { metric: 'kda', value: 2.5 },
      { metric: 'damageShare', value: 22 },
      { metric: 'killParticipation', value: 60 }
    ],
    mitigatingFactors,
    finalCall: '数据合格，没什么好说的'
  }
}

function validResult(verdicts: any[]): AttributionResult {
  return { winReason: '蓝方运营优势滚雪球，红方下路 10 分钟崩盘连锁', verdicts }
}

describe('validateAttribution', () => {
  describe('JSON parsing', () => {
    it('rejects non-JSON', () => {
      const snap = snapshotWithPlayer({ participantId: 1, teamId: 100 })
      const out = validateAttribution('not json at all', snap)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/json|parse/i)
    })

    it('accepts well-formed JSON', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 100 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
    })

    it('strips fenced markdown code blocks before parsing', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const raw = '```json\n' + JSON.stringify(result) + '\n```'
      const out = validateAttribution(raw, snap)
      expect(out.ok).toBe(true)
    })
  })

  describe('shape validation', () => {
    it('rejects verdicts array length < 4', () => {
      const snap = snapshotWithPlayer({ participantId: 1, teamId: 100 })
      const result = validResult([validVerdict(1), validVerdict(2), validVerdict(3)])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(false)
    })

    it('rejects verdicts array length > 7', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: Array.from({ length: 9 }, (_, i) => ({
          participantId: i + 2,
          teamId: 100
        }))
      })
      const result = validResult(Array.from({ length: 8 }, (_, i) => validVerdict(i + 1)))
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(false)
    })

    it('rejects evidenceMetrics length < 3', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const bad = validVerdict(1)
      bad.evidenceMetrics = [{ metric: 'kda', value: 1 }]
      const result = validResult([bad, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/evidenceMetrics/)
    })

    it('rejects label not in enum', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const bad = validVerdict(1, '神勇' as any)
      const result = validResult([bad, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/label/)
    })
  })

  describe('data-grounding: off-role', () => {
    it('strips ungrounded off-role factor (player.isOffRole=false)', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        isOffRole: false,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '犯罪', [{ factor: 'off-role', support: 'fake' }]),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].mitigatingFactors).toHaveLength(0)
    })

    it('accepts off-role mitigation when player.isOffRole=true', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        isOffRole: true,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '犯罪', [{ factor: 'off-role', support: 'isOffRole=true' }]),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
    })
  })

  describe('data-grounding: first-time-champion', () => {
    it('strips ungrounded first-time-champion factor (isFirstTimeInRecent=false)', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        isFirstTimeInRecent: false,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '被爆', [{ factor: 'first-time-champion', support: 'fake' }]),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].mitigatingFactors).toHaveLength(0)
    })

    it('accepts when isFirstTimeInRecent=true', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        isFirstTimeInRecent: true,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '被爆', [{ factor: 'first-time-champion', support: '近 20 场未练此英雄' }]),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
    })
  })

  describe('data-grounding: team-collapse', () => {
    it('strips team-collapse factor when <2 同队 犯罪', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 100 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '被连累', [{ factor: 'team-collapse', support: 'fake' }]),
        validVerdict(2, '正常'),
        validVerdict(3, '犯罪'), // only 1 teammate criminal — not enough
        validVerdict(4, '尽力')
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].mitigatingFactors).toHaveLength(0)
    })

    it('accepts when ≥2 同队 verdict.label="犯罪" (excluding self)', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 100 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '被连累', [{ factor: 'team-collapse', support: '两个队友被判犯罪' }]),
        validVerdict(2, '犯罪'),
        validVerdict(3, '犯罪'),
        validVerdict(4, '尽力')
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
    })
  })

  describe('data-grounding: targeted', () => {
    it('always strips targeted (no timeline data in current snapshot)', () => {
      const snap = snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
      const result = validResult([
        validVerdict(1, '被爆', [{ factor: 'targeted', support: 'fake' }]),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snap)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].mitigatingFactors).toHaveLength(0)
    })
  })

  describe('evidenceMetrics 清洗（真机复现：value 为百分比字符串时不整份硬毙）', () => {
    function snap4() {
      return snapshotWithPlayer({
        participantId: 1,
        teamId: 100,
        otherPlayers: [
          { participantId: 2, teamId: 100 },
          { participantId: 3, teamId: 200 },
          { participantId: 4, teamId: 200 }
        ]
      })
    }

    it('coerces 字符串数字/百分比 value → number', () => {
      const v = validVerdict(1)
      v.evidenceMetrics = [
        { metric: 'damageShare', value: '36.3%' },
        { metric: 'kda', value: '4.44' },
        { metric: 'kills', value: 19 }
      ] as any
      const result = validResult([v, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snap4())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].evidenceMetrics[0].value).toBe(36.3)
        expect(out.value.verdicts[0].evidenceMetrics[1].value).toBe(4.44)
      }
    })

    it('救不动的坏条目被摘除，verdict 保留（不再整份失败）', () => {
      const v = validVerdict(1)
      v.evidenceMetrics = [
        { metric: 'kda', value: 2.5 },
        { metric: 'deaths', value: 11 },
        { metric: 'rank', value: '队内最高' },
        { metric: 'damageShare', value: 30 }
      ] as any
      const result = validResult([v, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snap4())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].evidenceMetrics).toHaveLength(3)
        expect(out.value.verdicts[0].evidenceMetrics.every(m => typeof m.value === 'number')).toBe(
          true
        )
      }
    })

    it('全部条目救不动 → 丢该 verdict，其余保留', () => {
      const v = validVerdict(1)
      v.evidenceMetrics = [
        { metric: 'a', value: '很高' },
        { metric: 'b', value: null },
        { metric: 'c', value: '第一名' }
      ] as any
      const result = validResult([v, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snap4())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts).toHaveLength(3)
        expect(out.value.verdicts.find(x => x.participantId === 1)).toBeUndefined()
      }
    })
  })

  describe('deterministic backfill: champion / teamPosition / teamResult', () => {
    /** 带英雄/分路/胜负的快照——回填数据源 */
    function snapshotWithRoster(): MatchSnapshot {
      const players: any[] = [
        {
          participantId: 1,
          teamId: 100,
          name: 'P1',
          champion: '赏金猎人',
          teamPosition: 'BOTTOM',
          win: true,
          recentProfile: null
        },
        {
          participantId: 2,
          teamId: 200,
          name: 'P2',
          champion: '牧魂人',
          teamPosition: 'TOP',
          win: false,
          recentProfile: null
        },
        {
          participantId: 3,
          teamId: 200,
          name: 'P3',
          champion: '曙光女神',
          teamPosition: 'UTILITY',
          win: false,
          recentProfile: null
        },
        {
          participantId: 4,
          teamId: 100,
          name: 'P4',
          champion: '疾风剑豪',
          teamPosition: 'MIDDLE',
          win: true,
          recentProfile: null
        }
      ]
      return { players } as unknown as MatchSnapshot
    }

    it('backfills 三字段 from snapshot for every verdict（含胜败两侧）', () => {
      const result = validResult([
        validVerdict(1, '尽力'),
        validVerdict(2, '被爆'),
        validVerdict(3, '正常'),
        validVerdict(4, '正常')
      ])
      const out = validateAttribution(JSON.stringify(result), snapshotWithRoster())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].champion).toBe('赏金猎人')
        expect(out.value.verdicts[0].teamPosition).toBe('BOTTOM')
        expect(out.value.verdicts[0].teamResult).toBe('胜方')
        expect(out.value.verdicts[1].champion).toBe('牧魂人')
        expect(out.value.verdicts[1].teamResult).toBe('败方')
        expect(out.value.verdicts[2].teamPosition).toBe('UTILITY')
      }
    })

    it('overrides 模型自带的 champion/teamPosition（快照为准）', () => {
      const verdict = { ...validVerdict(1, '尽力'), champion: '编造英雄', teamPosition: 'MIDDLE' }
      const result = validResult([verdict, validVerdict(2), validVerdict(3), validVerdict(4)])
      const out = validateAttribution(JSON.stringify(result), snapshotWithRoster())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].champion).toBe('赏金猎人')
        expect(out.value.verdicts[0].teamPosition).toBe('BOTTOM')
      }
    })

    it('leaves 字段 undefined when participantId 不在快照（校验仍通过）', () => {
      const result = validResult([
        validVerdict(99, '正常'),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snapshotWithRoster())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].champion).toBeUndefined()
        expect(out.value.verdicts[0].teamResult).toBeUndefined()
      }
    })
  })
})
