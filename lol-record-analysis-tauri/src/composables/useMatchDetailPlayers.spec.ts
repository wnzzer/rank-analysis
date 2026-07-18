import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useMatchDetailPlayers } from './useMatchDetailPlayers'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'

// @vicons/ionicons5 is not installed in the test environment
vi.mock('@vicons/ionicons5', () => ({
  CashOutline: {},
  FlagOutline: {},
  FlameOutline: {},
  FlashOutline: {},
  FootstepsOutline: {},
  PeopleOutline: {},
  ShieldOutline: {},
  SkullOutline: {}
}))

function makeStats(overrides: Partial<ParticipantStats> = {}): ParticipantStats {
  return {
    win: false,
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
    subteamPlacement: 0,
    ...overrides
  }
}

function makeP(id: number, teamId: number, stats: ParticipantStats): Participant {
  return {
    win: stats.win,
    participantId: id,
    teamId,
    championId: 1,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
}

describe('useMatchDetailPlayers - CHERRY mode grouping', () => {
  it('should group by playerSubteamId in CHERRY game', () => {
    const game: Game = {
      mvp: '',
      gameDetail: { endOfGameResult: 'GameComplete', participantIdentities: [], participants: [] },
      gameId: 1,
      gameCreationDate: '2026-05-10T00:00:00Z',
      gameDuration: 1200,
      gameMode: 'CHERRY',
      gameType: '',
      mapId: 30,
      queueId: 1700,
      queueName: '斗魂竞技场',
      platformId: '',
      participantIdentities: Array.from({ length: 16 }, (_, i) => ({
        player: {
          accountId: 0,
          platformId: '',
          gameName: `P${i + 1}`,
          tagLine: '0001',
          summonerName: '',
          summonerId: 0
        }
      })),
      participants: [
        // subteam 1, placement 3
        makeP(1, 100, makeStats({ playerSubteamId: 1, subteamPlacement: 3, win: true })),
        makeP(2, 100, makeStats({ playerSubteamId: 1, subteamPlacement: 3, win: true })),
        // subteam 2, placement 1 (champion)
        makeP(3, 100, makeStats({ playerSubteamId: 2, subteamPlacement: 1, win: true })),
        makeP(4, 100, makeStats({ playerSubteamId: 2, subteamPlacement: 1, win: true })),
        // subteam 3, placement 8
        makeP(5, 200, makeStats({ playerSubteamId: 3, subteamPlacement: 8, win: false })),
        makeP(6, 200, makeStats({ playerSubteamId: 3, subteamPlacement: 8, win: false }))
      ]
    }
    const { teamSections } = useMatchDetailPlayers(ref(game), ref(''))
    const sections = teamSections.value

    expect(sections).toHaveLength(3)
    // 按 placement 升序
    expect(sections[0].title).toContain('队伍 2')
    expect(sections[0].title).toContain('第 1')
    expect(sections[1].title).toContain('队伍 1')
    expect(sections[1].title).toContain('第 3')
    expect(sections[2].title).toContain('队伍 3')
    expect(sections[2].title).toContain('第 8')
  })

  it('should still group by teamId in non-CHERRY game', () => {
    const game: Game = {
      mvp: '',
      gameDetail: { endOfGameResult: '', participantIdentities: [], participants: [] },
      gameId: 2,
      gameCreationDate: '2026-05-10T00:00:00Z',
      gameDuration: 1500,
      gameMode: 'CLASSIC',
      gameType: '',
      mapId: 11,
      queueId: 420,
      queueName: '排位',
      platformId: '',
      participantIdentities: Array.from({ length: 10 }, (_, i) => ({
        player: {
          accountId: 0,
          platformId: '',
          gameName: `P${i + 1}`,
          tagLine: '0001',
          summonerName: '',
          summonerId: 0
        }
      })),
      participants: [
        ...[1, 2, 3, 4, 5].map(i => makeP(i, 100, makeStats({ win: true }))),
        ...[6, 7, 8, 9, 10].map(i => makeP(i, 200, makeStats({ win: false })))
      ]
    }
    const { teamSections } = useMatchDetailPlayers(ref(game), ref(''))
    const sections = teamSections.value
    expect(sections).toHaveLength(2)
    expect(sections[0].title).toBe('胜方')
    expect(sections[1].title).toBe('败方')
  })
})

describe('useMatchDetailPlayers - 伤害徽章与 WeGame 式 MVP', () => {
  /** 无死亡低伤"蹭分型"(KDA 18) vs 真核 carry(全场最高输出/参团/经济)——
   *  旧纯 KDA 逻辑会把 MVP 给前者，新综合评分应给 carry */
  function makeGame(): Game {
    return {
      mvp: '',
      gameDetail: { endOfGameResult: '', participantIdentities: [], participants: [] },
      gameId: 3,
      gameCreationDate: '2026-07-05T00:00:00Z',
      gameDuration: 1800,
      gameMode: 'CLASSIC',
      gameType: '',
      mapId: 11,
      queueId: 420,
      queueName: '单双排',
      platformId: '',
      participantIdentities: Array.from({ length: 4 }, (_, i) => ({
        player: {
          accountId: 0,
          platformId: '',
          gameName: `P${i + 1}`,
          tagLine: '0001',
          summonerName: '',
          summonerId: 0
        }
      })),
      participants: [
        // 蹭分型：KDA 18 但输出/经济低
        makeP(
          1,
          100,
          makeStats({
            win: true,
            kills: 10,
            deaths: 0,
            assists: 8,
            totalDamageDealtToChampions: 8000,
            totalDamageTaken: 5000,
            goldEarned: 9000,
            totalMinionsKilled: 100
          })
        ),
        // 真核 carry：KDA 12 但全场最高输出/承伤/经济/补刀/推塔
        makeP(
          2,
          100,
          makeStats({
            win: true,
            kills: 9,
            deaths: 2,
            assists: 15,
            totalDamageDealtToChampions: 40000,
            totalDamageTaken: 30000,
            goldEarned: 15000,
            totalMinionsKilled: 200,
            damageDealtToTurrets: 5000
          })
        ),
        // 败方两人
        makeP(
          3,
          200,
          makeStats({
            win: false,
            kills: 5,
            deaths: 6,
            assists: 3,
            totalDamageDealtToChampions: 20000,
            totalDamageTaken: 22000,
            goldEarned: 10000,
            totalMinionsKilled: 150
          })
        ),
        makeP(
          4,
          200,
          makeStats({
            win: false,
            kills: 1,
            deaths: 9,
            assists: 2,
            totalDamageDealtToChampions: 6000,
            totalDamageTaken: 15000,
            goldEarned: 7000,
            totalMinionsKilled: 80
          })
        )
      ]
    }
  }

  it('伤害最多者获得 damage 徽章', () => {
    const { detailPlayers } = useMatchDetailPlayers(ref(makeGame()), ref(''))
    const carry = detailPlayers.value.find(p => p.participantId === 2)!
    expect(carry.badges.some(b => b.key === 'damage')).toBe(true)
    const farmer = detailPlayers.value.find(p => p.participantId === 1)!
    expect(farmer.badges.some(b => b.key === 'damage')).toBe(false)
  })

  it('综合评分把 MVP 给 carry 而非纯 KDA 蹭分型；败方最高分得 SVP', () => {
    const { detailPlayers } = useMatchDetailPlayers(ref(makeGame()), ref(''))
    const byId = (id: number) => detailPlayers.value.find(p => p.participantId === id)!
    expect(byId(2).mvpTag).toBe('MVP')
    expect(byId(1).mvpTag).toBe('')
    expect(byId(3).mvpTag).toBe('SVP')
    expect(byId(4).mvpTag).toBe('')
    // 评分单调性：carry 分应高于蹭分型
    expect(byId(2).score).toBeGreaterThan(byId(1).score)
  })
})

describe('useMatchDetailPlayers - 多杀徽章', () => {
  function makeGame(statsOverrides: Partial<ParticipantStats>): Game {
    return {
      mvp: '',
      gameDetail: { endOfGameResult: '', participantIdentities: [], participants: [] },
      gameId: 9,
      gameCreationDate: '2026-07-18T00:00:00Z',
      gameDuration: 2400,
      gameMode: 'CLASSIC',
      gameType: '',
      mapId: 11,
      queueId: 420,
      queueName: '单双排位',
      platformId: '',
      participantIdentities: Array.from({ length: 2 }, (_, i) => ({
        player: {
          accountId: 0,
          platformId: '',
          gameName: `P${i + 1}`,
          tagLine: '0001',
          summonerName: '',
          summonerId: 0
        }
      })),
      participants: [
        makeP(1, 100, makeStats({ win: true, kills: 19, ...statsOverrides })),
        makeP(2, 200, makeStats({ win: false, kills: 2 }))
      ]
    }
  }

  const badgesOf = (game: Game, id: number) => {
    const { detailPlayers } = useMatchDetailPlayers(ref(game), ref(''))
    return detailPlayers.value.find(p => p.participantId === id)!.badges
  }

  it('五杀 1 次 → "五杀" 徽章', () => {
    const badges = badgesOf(makeGame({ pentaKills: 1 }), 1)
    const penta = badges.find(b => b.key === 'penta')
    expect(penta?.label).toBe('五杀')
  })

  it('三杀 2 次 → "三杀×2" 徽章，且排在"最多"类徽章前面', () => {
    const badges = badgesOf(makeGame({ tripleKills: 2 }), 1)
    const triple = badges.find(b => b.key === 'triple')
    expect(triple?.label).toBe('三杀×2')
    const tripleIdx = badges.findIndex(b => b.key === 'triple')
    const killsIdx = badges.findIndex(b => b.key === 'kills')
    expect(killsIdx).toBeGreaterThan(-1)
    expect(tripleIdx).toBeLessThan(killsIdx)
  })

  it('四杀 + 五杀同局 → 两枚徽章，五杀在前', () => {
    const badges = badgesOf(makeGame({ pentaKills: 1, quadraKills: 1 }), 1)
    const keys = badges.map(b => b.key)
    expect(keys.indexOf('penta')).toBeGreaterThan(-1)
    expect(keys.indexOf('quadra')).toBeGreaterThan(-1)
    expect(keys.indexOf('penta')).toBeLessThan(keys.indexOf('quadra'))
  })

  it('无多杀 → 不出多杀徽章；双杀不出徽章', () => {
    const badges = badgesOf(makeGame({ doubleKills: 3 }), 1)
    expect(badges.some(b => ['penta', 'quadra', 'triple'].includes(b.key))).toBe(false)
  })
})
