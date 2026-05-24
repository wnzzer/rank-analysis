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
    it('rejects off-role mitigation when player.isOffRole=false', () => {
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
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/off-role/)
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
    it('rejects when player.currentChampionMastery.isFirstTimeInRecent=false', () => {
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
      expect(out.ok).toBe(false)
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
    it('rejects when fewer than 2 同队 verdict.label="犯罪"', () => {
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
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/team-collapse/)
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
    it('always rejects targeted (no timeline data in current snapshot)', () => {
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
      expect(out.ok).toBe(false)
    })
  })
})
