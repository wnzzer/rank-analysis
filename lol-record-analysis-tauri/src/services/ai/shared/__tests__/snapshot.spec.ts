import { describe, it, expect } from 'vitest'
import { buildMatchSnapshot, isAugmentMode } from '../snapshot'
import type { Game } from '@renderer/types/domain/match'

function makeParticipant(overrides: any = {}) {
  return {
    participantId: 1,
    teamId: 100,
    championId: 64,
    spell1Id: 4,
    spell2Id: 11,
    stats: {
      win: true,
      kills: 5,
      deaths: 3,
      assists: 7,
      totalDamageDealtToChampions: 25000,
      totalDamageTaken: 18000,
      goldEarned: 12000,
      totalMinionsKilled: 100,
      neutralMinionsKilled: 80,
      totalHeal: 1000,
      damageDealtToTurrets: 3000,
      perk0: 8005,
      perkSubStyle: 8200,
      playerAugment1: 0,
      playerAugment2: 0,
      playerAugment3: 0,
      playerAugment4: 0,
      playerAugment5: 0,
      playerAugment6: 0,
      item0: 1001,
      item1: 1018,
      item2: 1031,
      item3: 1037,
      item4: 1042,
      item5: 0,
      item6: 3340,
      doubleKills: 0,
      tripleKills: 0,
      quadraKills: 0,
      pentaKills: 0,
      visionScore: 25,
      sightWardsBoughtInGame: 0,
      visionWardsBoughtInGame: 2
    },
    timeline: { lane: 'JUNGLE', role: 'NONE' },
    teamPosition: 'JUNGLE',
    ...overrides
  }
}

function makeGame(
  opts: { queueId?: number; gameMode?: string; duration?: number; participants?: any[] } = {}
): Game {
  return {
    gameId: 1,
    queueId: opts.queueId ?? 420,
    gameMode: opts.gameMode ?? 'CLASSIC',
    gameDuration: opts.duration ?? 1800,
    queueName: '排位',
    participants: opts.participants ?? [makeParticipant()],
    participantIdentities: [
      { participantId: 1, player: { gameName: 'Test', tagLine: '1234', puuid: 'p1' } }
    ]
  } as any
}

describe('buildMatchSnapshot', () => {
  it('returns modeContext.kind for ranked', () => {
    const snap = buildMatchSnapshot(makeGame({ queueId: 420 }))
    expect(snap.modeContext.kind).toBe('ranked')
  })

  it('returns modeContext.kind for augment (CHERRY)', () => {
    const snap = buildMatchSnapshot(makeGame({ queueId: 1700, gameMode: 'CHERRY' }))
    expect(snap.modeContext.kind).toBe('augment')
    expect(snap.modeContext.isTeamMode).toBe(true)
  })

  it('returns modeContext.kind for aram (450)', () => {
    const snap = buildMatchSnapshot(makeGame({ queueId: 450, gameMode: 'ARAM' }))
    expect(snap.modeContext.kind).toBe('aram')
  })

  it('computes per-minute metrics', () => {
    const snap = buildMatchSnapshot(makeGame({ duration: 1800 }))
    expect(snap.players[0].dpm).toBeCloseTo(25000 / 30, 0)
    expect(snap.players[0].gpm).toBeCloseTo(12000 / 30, 0)
    expect(snap.players[0].csm).toBeCloseTo(180 / 30, 0)
  })

  it('handles 0 duration safely', () => {
    const snap = buildMatchSnapshot(makeGame({ duration: 0 }))
    expect(snap.players[0].dpm).toBe(0)
    expect(snap.players[0].gpm).toBe(0)
  })

  it('converts spellIds to Chinese names', () => {
    const snap = buildMatchSnapshot(makeGame())
    expect(snap.players[0].summonerSpells).toEqual(['闪现', '惩戒'])
  })

  it('passes through teamPosition / lane / role', () => {
    const snap = buildMatchSnapshot(makeGame())
    expect(snap.players[0].teamPosition).toBe('JUNGLE')
    expect(snap.players[0].lane).toBe('JUNGLE')
    expect(snap.players[0].role).toBe('NONE')
  })

  it('wardScore 为 null when LCU stats 缺 visionScore（缺数据≠0，防模型冤枉玩家不插眼）', () => {
    const p = makeParticipant()
    delete (p.stats as any).visionScore
    delete (p.stats as any).sightWardsBoughtInGame
    delete (p.stats as any).visionWardsBoughtInGame
    const snap = buildMatchSnapshot(makeGame({ participants: [p] }))
    expect(snap.players[0].wardScore).toBeNull()
    expect(snap.players[0].controlWardsPlaced).toBeNull()
    expect(snap.players[0].visionWardsBought).toBeNull()
  })

  it('wardScore 透传 when LCU stats 有 visionScore', () => {
    const snap = buildMatchSnapshot(makeGame())
    expect(snap.players[0].wardScore).toBe(25)
  })

  it('infers teamPosition via 召唤师技能+英雄 when LCU 缺该字段（国服战绩实测缺失）', () => {
    // 惩戒 → JUNGLE
    const jungler = makeParticipant({ teamPosition: undefined, spell1Id: 11, spell2Id: 4 })
    // 治疗 + ADC(21 赏金猎人) → BOTTOM
    const adc = makeParticipant({
      participantId: 2,
      teamPosition: undefined,
      championId: 21,
      spell1Id: 7,
      spell2Id: 4
    })
    const snap = buildMatchSnapshot(makeGame({ participants: [jungler, adc] }))
    expect(snap.players[0].teamPosition).toBe('JUNGLE')
    expect(snap.players[1].teamPosition).toBe('BOTTOM')
  })

  it('passes through multiKills（后端曾丢字段导致恒 0 的回归锚点）', () => {
    const p = makeParticipant()
    p.stats.doubleKills = 3
    p.stats.tripleKills = 2
    p.stats.quadraKills = 1
    p.stats.pentaKills = 1
    const snap = buildMatchSnapshot(makeGame({ participants: [p] }))
    expect(snap.players[0].multiKills).toEqual({ double: 3, triple: 2, quadra: 1, penta: 1 })
  })

  it('defaults multiKills to 0 when 旧缓存数据缺字段', () => {
    const p = makeParticipant()
    delete (p.stats as any).doubleKills
    delete (p.stats as any).tripleKills
    delete (p.stats as any).quadraKills
    delete (p.stats as any).pentaKills
    const snap = buildMatchSnapshot(makeGame({ participants: [p] }))
    expect(snap.players[0].multiKills).toEqual({ double: 0, triple: 0, quadra: 0, penta: 0 })
  })

  it('augment mode → items array is empty', () => {
    const snap = buildMatchSnapshot(makeGame({ queueId: 2400, gameMode: 'ARAM' }))
    expect(snap.players[0].items).toEqual([])
  })

  it('non-augment mode → items array contains the 6 items', () => {
    const snap = buildMatchSnapshot(makeGame({ queueId: 420 }))
    expect(snap.players[0].items).toEqual([1001, 1018, 1031, 1037, 1042, 0])
  })

  it('recentProfile defaults to null', () => {
    const snap = buildMatchSnapshot(makeGame())
    expect(snap.players[0].recentProfile).toBeNull()
  })

  it('isAugmentMode helper still works', () => {
    expect(isAugmentMode(makeGame({ queueId: 1700, gameMode: 'CHERRY' }))).toBe(true)
    expect(isAugmentMode(makeGame({ queueId: 420 }))).toBe(false)
  })
})
