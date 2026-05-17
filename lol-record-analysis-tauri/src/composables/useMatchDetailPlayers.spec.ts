import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useMatchDetailPlayers } from './useMatchDetailPlayers'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'

// @vicons/ionicons5 is not installed in the test environment
vi.mock('@vicons/ionicons5', () => ({
  CashOutline: {},
  FlagOutline: {},
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
