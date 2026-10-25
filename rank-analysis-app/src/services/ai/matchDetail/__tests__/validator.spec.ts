import { describe, it, expect } from 'vitest'
import { validateAttribution } from '../validator'
import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'
import { withFacts } from './snapshotFacts'

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
  return { players: players.map(withFacts) } as unknown as MatchSnapshot
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

    it('字符串数字/百分比 value 不整份硬毙,且数值以快照为准重写', () => {
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
        // 快照(withFacts 默认):damageShare 22 / kda 2.5 / kills 5
        expect(out.value.verdicts[0].evidenceMetrics.map(m => m.value)).toEqual([22, 2.5, 5])
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
      return { players: players.map(withFacts) } as unknown as MatchSnapshot
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

    it('participantId 不在快照的 verdict 无从接地证据,整条剔除（其余校验仍通过）', () => {
      const result = validResult([
        validVerdict(99, '正常'),
        validVerdict(2),
        validVerdict(3),
        validVerdict(4)
      ])
      const out = validateAttribution(JSON.stringify(result), snapshotWithRoster())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts.map(v => v.participantId)).toEqual([2, 3, 4])
      }
    })
  })

  describe('标签量化一致性降级(真机复现:qwen 违反量化标准打标)', () => {
    /** 快照:p1 胜方,p2 败方;p3/p4 凑 verdict 数量下限。可注入参团率 */
    function snapForLabels(kp: Record<number, number> = {}): MatchSnapshot {
      const players = [
        { participantId: 1, teamId: 100, win: true, killParticipation: kp[1] ?? 60 },
        { participantId: 2, teamId: 200, win: false, killParticipation: kp[2] ?? 60 },
        { participantId: 3, teamId: 100, win: true, killParticipation: kp[3] ?? 60 },
        { participantId: 4, teamId: 200, win: false, killParticipation: kp[4] ?? 60 },
        { participantId: 5, teamId: 200, win: false, killParticipation: kp[5] ?? 60 }
      ].map(p => ({
        ...p,
        name: `P${p.participantId}`,
        champion: `C${p.participantId}`,
        recentProfile: null
      }))
      return { players: players.map(withFacts) } as unknown as MatchSnapshot
    }

    it('败方玩家被标「尽力」→ 降级为正常(尽力要求该队伍胜)', () => {
      const raw = JSON.stringify(
        validResult([validVerdict(2, '尽力'), validVerdict(1), validVerdict(3), validVerdict(4)])
      )
      const out = validateAttribution(raw, snapForLabels())
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].label).toBe('正常')
    })

    it('胜方玩家被标「犯罪」或「被连累」→ 降级为正常(二者都要求该队伍输)', () => {
      const raw = JSON.stringify(
        validResult([
          validVerdict(1, '犯罪'),
          validVerdict(3, '被连累'),
          validVerdict(2),
          validVerdict(4)
        ])
      )
      const out = validateAttribution(raw, snapForLabels())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].label).toBe('正常')
        expect(out.value.verdicts[1].label).toBe('正常')
      }
    })

    it('参团率不低于队均-15 的玩家被标「缚地灵」→ 降级为正常(真机:74%参团被标缚地灵)', () => {
      // p2 参团 74,队(200)均值 (74+40+40)/3≈51.3 → 74 远高于均值,缚地灵不成立
      const raw = JSON.stringify(
        validResult([validVerdict(2, '缚地灵'), validVerdict(1), validVerdict(3), validVerdict(4)])
      )
      const out = validateAttribution(raw, snapForLabels({ 2: 74, 4: 40, 5: 40 }))
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].label).toBe('正常')
    })

    it('参团率确实低于队均-15 → 缚地灵保留', () => {
      // p2 参团 20,队均 (20+70+70)/3=53.3,20 < 53.3-15 → 成立
      const raw = JSON.stringify(
        validResult([validVerdict(2, '缚地灵'), validVerdict(1), validVerdict(3), validVerdict(4)])
      )
      const out = validateAttribution(raw, snapForLabels({ 2: 20, 4: 70, 5: 70 }))
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.value.verdicts[0].label).toBe('缚地灵')
    })

    it('败方「犯罪」与胜方「尽力」不受影响', () => {
      const raw = JSON.stringify(
        validResult([
          validVerdict(2, '犯罪'),
          validVerdict(1, '尽力'),
          validVerdict(3),
          validVerdict(4)
        ])
      )
      const out = validateAttribution(raw, snapForLabels())
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.value.verdicts[0].label).toBe('犯罪')
        expect(out.value.verdicts[1].label).toBe('尽力')
      }
    })
  })
})

describe('Layer5 降级时 finalCall 一并中和(真机:胜方辅助 label 降正常但 finalCall 仍写「严重拖累」)', () => {
  function snap(): MatchSnapshot {
    const players = [
      { participantId: 1, teamId: 100, win: true, killParticipation: 60 },
      { participantId: 2, teamId: 200, win: false, killParticipation: 60 },
      { participantId: 3, teamId: 100, win: true, killParticipation: 60 },
      { participantId: 4, teamId: 200, win: false, killParticipation: 60 }
    ].map(p => ({
      ...p,
      name: `P${p.participantId}`,
      champion: `C${p.participantId}`,
      recentProfile: null
    }))
    return { players: players.map(withFacts) } as unknown as MatchSnapshot
  }

  it('胜方「犯罪」降级为正常时,指控性 finalCall 被替换为中性文案', () => {
    const v = { ...validVerdict(1, '犯罪'), finalCall: '表现严重拖累团队' }
    const raw = JSON.stringify(validResult([v, validVerdict(2), validVerdict(3), validVerdict(4)]))
    const out = validateAttribution(raw, snap())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.verdicts[0].label).toBe('正常')
      expect(out.value.verdicts[0].finalCall).not.toContain('拖累')
    }
  })

  it('未降级的 verdict finalCall 原样保留', () => {
    const v = { ...validVerdict(2, '犯罪'), finalCall: '这锅背定了' }
    const raw = JSON.stringify(validResult([v, validVerdict(1), validVerdict(3), validVerdict(4)]))
    const out = validateAttribution(raw, snap())
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.verdicts[0].finalCall).toBe('这锅背定了')
  })
})

/**
 * 真实回归锚点:2026-10-25 单双排 301041798766(蓝方败)。qwen-flash 原始输出把
 * 止痛片(盲僧)的对位差值抄给了胜方打野 Muggle丶、把 50% 参团的维克托标成犯罪、
 * 把 16/8/5 伤害 35.5% 的盲僧标成正常。
 */
describe('validateAttribution · 证据与标签按快照复核(真机 301041798766)', () => {
  const ranks = (r: Record<string, number>) => r
  const players = [
    withFacts({
      participantId: 2,
      teamId: 100,
      win: false,
      name: '止痛片#25697',
      champion: '盲僧',
      teamPosition: 'JUNGLE',
      kills: 16,
      deaths: 8,
      kda: 2.63,
      damageShare: 35.5,
      killParticipation: 65.6,
      gold: 20099,
      teamRanks: ranks({ kills: 1, deaths: 3, kda: 2, damageShare: 1, killParticipation: 1 }),
      vsLaneOpponent: {
        opponentName: 'Muggle丶#59080',
        opponentChampion: '破败之王',
        goldDiff: 1885,
        csDiff: 84,
        kdaDiff: -0.5,
        killsDiff: 0,
        deathsDiff: 0,
        damageShareDiff: 0
      }
    }),
    withFacts({
      participantId: 4,
      teamId: 100,
      win: false,
      name: '幽默的二次元#12510',
      teamPosition: 'BOTTOM',
      deaths: 11,
      kda: 1.45,
      killParticipation: 50,
      damageShare: 23.3,
      teamRanks: ranks({ deaths: 1, kda: 4, killParticipation: 3 })
    }),
    withFacts({ participantId: 3, teamId: 100, win: false, deaths: 8, kda: 1, damageShare: 17.7 }),
    withFacts({
      participantId: 1,
      teamId: 100,
      win: false,
      deaths: 5,
      kda: 2.2,
      damageShare: 16.7
    }),
    withFacts({
      participantId: 5,
      teamId: 100,
      win: false,
      deaths: 7,
      kda: 2.86,
      damageShare: 6.8
    }),
    withFacts({
      participantId: 7,
      teamId: 200,
      win: true,
      name: 'Muggle丶#59080',
      gold: 18214,
      vsLaneOpponent: {
        opponentName: '止痛片#25697',
        opponentChampion: '盲僧',
        goldDiff: -1885,
        csDiff: -84,
        kdaDiff: 0.5,
        killsDiff: 0,
        deathsDiff: 0,
        damageShareDiff: 0
      }
    })
  ]
  const snap = { players } as unknown as MatchSnapshot
  const verdict = (participantId: number, label: string, metrics: any[], finalCall = 'x') => ({
    participantId,
    name: `P${participantId}`,
    label,
    // 形状校验要求 ≥3 条证据:补两条快照必有的指标凑数
    evidenceMetrics: [...metrics, { metric: 'gold', value: 0 }, { metric: 'cs', value: 0 }],
    mitigatingFactors: [],
    finalCall
  })
  const run = (verdicts: any[]) => {
    const out = validateAttribution(
      JSON.stringify({ winReason: '胜方打野 20 杀带飞', verdicts }),
      snap
    )
    if (!out.ok) throw new Error(out.error)
    return out.value
  }
  const filler = [
    verdict(3, '正常', [{ metric: 'kda', value: 1 }]),
    verdict(1, '正常', [{ metric: 'kda', value: 2.2 }])
  ]

  it('对位差值按 vsLaneOpponent 重写,旧式指标名归一(模型把盲僧的 +8100 抄给了 Muggle丶)', () => {
    const out = run([
      verdict(7, '尽力', [
        {
          metric: 'goldDiffVsLaneOpp',
          value: 7900,
          note: '对位玩家 11999 金币，本人 20099 金币，领先 8100'
        }
      ]),
      verdict(2, '正常', [{ metric: 'kills', value: 16, teamRank: 1 }]),
      ...filler
    ])
    const m = out.verdicts[0].evidenceMetrics[0]
    expect(m.metric).toBe('vsLaneOpponent.goldDiff')
    expect(m.value).toBe(-1885)
    expect(m.note).toBe('对位盲僧经济：本人 18214，对方 20099，落后 1885')
  })

  it('teamRank 照快照重写,快照外指标(拼错的 assist)被摘除', () => {
    const out = run([
      verdict(4, '正常', [
        { metric: 'kda', value: 1.45, teamRank: 5, note: '队内倒数第一' },
        { metric: 'assist', value: 8 }
      ]),
      verdict(2, '正常', [{ metric: 'kills', value: 16 }]),
      ...filler
    ])
    expect(out.verdicts[0].evidenceMetrics.map(m => m.metric)).not.toContain('assist')
    expect(out.verdicts[0].evidenceMetrics[0]).toEqual({
      metric: 'kda',
      value: 1.45,
      teamRank: 4,
      note: 'KDA 1.45，队内第 4'
    })
  })

  it('不满足「至少 2 项」的犯罪降级:死亡最多但参团 50%、KDA 非最低', () => {
    const out = run([
      verdict(4, '犯罪', [{ metric: 'deaths', value: 11 }]),
      verdict(2, '正常', [{ metric: 'kills', value: 16 }]),
      ...filler
    ])
    expect(out.verdicts[0].label).toBe('正常')
  })

  it('满足被连累定义却标正常的败方升级为被连累,finalCall 由快照生成', () => {
    const out = run([verdict(2, '正常', [{ metric: 'kills', value: 16 }]), ...filler, filler[0]])
    expect(out.verdicts[0].label).toBe('被连累')
    expect(out.verdicts[0].finalCall).toContain('35.5%')
  })

  it('被误标犯罪、实为被连累的败方:复核后落到被连累而非正常(真机二跑复现)', () => {
    const out = run([
      verdict(2, '犯罪', [{ metric: 'kills', value: 16 }], '16 杀还输,锅在他'),
      ...filler,
      filler[0]
    ])
    expect(out.verdicts[0].label).toBe('被连累')
    expect(out.verdicts[0].finalCall).not.toContain('锅')
  })

  it('finalCall 里快照外的数字整句剔除,剔光则用证据注释兜底', () => {
    const out = run([
      verdict(4, '正常', [{ metric: 'deaths', value: 11 }], '9 次死亡全队最多。'),
      verdict(2, '正常', [{ metric: 'kills', value: 16 }]),
      ...filler
    ])
    expect(out.verdicts[0].finalCall).toMatch(/^死亡 11，队内最多/)
  })
})

describe('validateAttribution · 对位方向接地', () => {
  it('finalCall 里与对位差值方向相反的分句被剔除(真机:Muggle丶 对位落后写成领先)', () => {
    const players = [
      withFacts({
        participantId: 7,
        teamId: 200,
        win: true,
        damageShare: 27.9,
        vsLaneOpponent: {
          opponentName: '止痛片#25697',
          opponentChampion: '盲僧',
          goldDiff: -1885,
          csDiff: -84,
          kdaDiff: 0.5,
          killsDiff: 0,
          deathsDiff: 0,
          damageShareDiff: 0
        }
      }),
      ...[1, 2, 3].map(i => withFacts({ participantId: i, teamId: 100 }))
    ]
    const v = (pid: number, finalCall: string) => ({
      participantId: pid,
      name: `P${pid}`,
      label: '正常',
      evidenceMetrics: [
        { metric: 'kda', value: 0 },
        { metric: 'gold', value: 0 },
        { metric: 'cs', value: 0 }
      ],
      mitigatingFactors: [],
      finalCall
    })
    const out = validateAttribution(
      JSON.stringify({
        winReason: 'x',
        verdicts: [
          v(7, '伤害占比 27.9% 队内最高，对位盲僧经济领先 1885'),
          v(1, 'a'),
          v(2, 'b'),
          v(3, 'c')
        ]
      }),
      { players } as unknown as MatchSnapshot
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.verdicts[0].finalCall).toBe('伤害占比 27.9% 队内最高')
  })
})

describe('validateAttribution · 补漏被连累', () => {
  const players = [
    withFacts({ participantId: 1, teamId: 100, win: false, damageShare: 37.2, kda: 2.83 }),
    ...[2, 3, 4, 5].map(i => withFacts({ participantId: i, teamId: 100, win: false, kda: 1 })),
    ...[6, 7].map(i => withFacts({ participantId: i, teamId: 200, win: true }))
  ]
  const snap = { players } as unknown as MatchSnapshot
  const v = (pid: number) => ({
    participantId: pid,
    name: `P${pid}`,
    label: '正常',
    evidenceMetrics: [
      { metric: 'kda', value: 0 },
      { metric: 'gold', value: 0 },
      { metric: 'cs', value: 0 }
    ],
    mitigatingFactors: [],
    finalCall: 'x'
  })

  it('满足被连累却没进名册的败方自动补一条 verdict(真机 301041571554 xxxchen)', () => {
    const out = validateAttribution(
      JSON.stringify({ winReason: 'x', verdicts: [v(2), v(3), v(6), v(7)] }),
      snap
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const added = out.value.verdicts.find(x => x.participantId === 1)
    expect(added?.label).toBe('被连累')
    expect(added?.evidenceMetrics.map(m => m.metric)).toEqual([
      'damageShare',
      'kda',
      'killParticipation'
    ])
  })

  it('名册已满 7 条时不再补', () => {
    const many = [2, 3, 4, 5, 6, 7].map(v)
    const extra = [...players, withFacts({ participantId: 8, teamId: 200, win: true })]
    const out = validateAttribution(JSON.stringify({ winReason: 'x', verdicts: [...many, v(8)] }), {
      players: extra
    } as unknown as MatchSnapshot)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.verdicts).toHaveLength(7)
  })
})
