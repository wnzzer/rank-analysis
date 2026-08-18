import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildScoreInputsFromGame,
  computePlayerScores,
  fetchPlayerScoresByGameId,
  sortScoresDesc,
  PLAYER_SCORE_MAX,
  type PlayerScore
} from './playerScore'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
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
    championId: 100 + id,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
}

function makeGame(participants: Participant[], gameDuration = 1500): Game {
  return {
    platformId: 'NA1',
    gameId: 9876,
    gameMode: 'CLASSIC',
    queueId: 420,
    gameVersion: '25.6',
    gameDuration,
    gameCreationDate: '2026-01-01T00:00:00Z',
    mvp: 'false',
    gameType: 'MATCHED_GAME',
    mapId: 11,
    queueName: 'Ranked Solo',
    gameDetail: undefined as unknown as Game['gameDetail'],
    participants,
    participantIdentities: participants.map((p, i) => ({
      player: {
        accountId: 'acc',
        platformId: 'NA1',
        gameName: `Player${p.participantId}`,
        tagLine: 'TAG',
        summonerName: `Player${p.participantId}#TAG`,
        summonerId: 'sid',
        puuid: `puuid-${p.participantId}`,
        summonerLevel: 30,
        profileIconId: 0
      },
      participantId: p.participantId ?? i + 1
    }))
  }
}

function makeScore(overrides: Partial<PlayerScore> = {}): PlayerScore {
  return {
    participantId: 1,
    championId: 101,
    teamId: 100,
    puuid: 'puuid-1',
    summonerName: 'Player1#TAG',
    win: true,
    total: 10,
    breakdown: {
      kda: 0.5,
      win: 1,
      damage: 1.5,
      damageTaken: 1,
      heal: 0.8,
      cs: 1.2,
      gold: 1,
      participation: 1.5,
      vision: 1
    },
    ...overrides
  }
}

describe('playerScore - 输入组装', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('将 LCU Game 拍平为 10 人评分输入（含补刀合计与时长）', () => {
    const game = makeGame([
      makeP(1, 100, makeStats({ win: true, kills: 3, deaths: 1, assists: 5, goldEarned: 12000 })),
      makeP(
        2,
        200,
        makeStats({
          win: false,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 20,
          totalDamageDealtToChampions: 9000,
          totalDamageTaken: 8000,
          totalHeal: 3000,
          visionScore: 40
        })
      )
    ])

    const inputs = buildScoreInputsFromGame(game)

    expect(inputs).toHaveLength(2)
    const a = inputs[0]
    expect(a).toMatchObject({
      participantId: 1,
      championId: 101,
      teamId: 100,
      puuid: 'puuid-1',
      summonerName: 'Player1#TAG',
      win: true,
      kills: 3,
      deaths: 1,
      assists: 5,
      goldEarned: 12000,
      gameDuration: 1500
    })
    const b = inputs[1]
    expect(b.cs).toBe(200)
    expect(b.damageDealtToChampions).toBe(9000)
    expect(b.damageTaken).toBe(8000)
    expect(b.totalHeal).toBe(3000)
    expect(b.visionScore).toBe(40)
  })

  it('gameDetail.participants 优先于顶层 participants（SGP 详情场景）', () => {
    const top = [makeP(1, 100, makeStats())]
    const detail = [makeP(1, 100, makeStats({ win: true, kills: 9 })), makeP(2, 200, makeStats())]
    const game = {
      ...makeGame(top),
      gameDetail: { participants: detail, participantIdentities: [] }
    } as unknown as Game

    const inputs = buildScoreInputsFromGame(game)
    expect(inputs).toHaveLength(2)
    expect(inputs[0].kills).toBe(9)
  })
})

describe('playerScore - invoke 转发', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('computePlayerScores 转发到 compute_player_scores 并透传输入', async () => {
    invokeMock.mockResolvedValue([makeScore()])
    const inputs = [{ participantId: 1 }] as never[]
    const result = await computePlayerScores(inputs)
    expect(invokeMock).toHaveBeenCalledWith('compute_player_scores', { inputs })
    expect(result).toHaveLength(1)
    expect(result[0]!.total).toBe(10)
  })

  it('fetchPlayerScoresByGameId 走 get_player_scores 且失败时返回 null', async () => {
    invokeMock.mockRejectedValueOnce(new Error('LCU offline'))
    expect(await fetchPlayerScoresByGameId(123)).toBeNull()
    invokeMock.mockResolvedValueOnce([makeScore()])
    const ok = await fetchPlayerScoresByGameId(123)
    expect(ok).toHaveLength(1)
    expect(invokeMock).toHaveBeenLastCalledWith('get_player_scores', { gameId: 123 })
  })
})

describe('playerScore - 排序', () => {
  it('按总分降序，总分相同按 participantId 升序（确定性）', () => {
    const scores = [
      makeScore({ participantId: 2, total: 12 }),
      makeScore({ participantId: 1, total: 12 }),
      makeScore({ participantId: 3, total: 15 })
    ]
    const sorted = sortScoresDesc(scores)
    expect(sorted.map(s => s.participantId)).toEqual([3, 1, 2])
  })

  it('PLAYER_SCORE_MAX 为 17', () => {
    expect(PLAYER_SCORE_MAX).toBe(17)
  })
})
