import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { emptyQuery } from '../schema'
import { filterGames, countEncounters } from '../filter'

// ─── fixtures ────────────────────────────────────────────────────────────────

interface PlayerSpec {
  championId: number
  teamId: number
  gameName?: string
  tagLine?: string
}

/**
 * 造一局对局:players[0] 视为「我」(同时充当顶层 participants[0] 与
 * gameDetail 中的对应成员),其余为全队/对面成员。
 */
function gameOf(opts: {
  gameId?: number
  date?: string
  queueId?: number
  win?: boolean
  players: PlayerSpec[]
}): Game {
  const me = opts.players[0]
  const stats = (win: boolean) => ({ win }) as Game['participants'][0]['stats']
  return {
    mvp: '',
    gameId: opts.gameId ?? Math.floor(Math.random() * 1e9),
    gameCreationDate: opts.date ?? '2026-08-15T12:00:00.000Z',
    gameDuration: 1800,
    gameMode: 'CLASSIC',
    gameType: 'MATCHED_GAME',
    mapId: 11,
    queueId: opts.queueId ?? 420,
    queueName: '',
    platformId: 'HN1',
    participants: [
      {
        win: opts.win ?? true,
        participantId: 1,
        teamId: me.teamId,
        championId: me.championId,
        spell1Id: 4,
        spell2Id: 14,
        stats: stats(opts.win ?? true)
      }
    ],
    participantIdentities: [],
    gameDetail: {
      endOfGameResult: 'GameComplete',
      participants: opts.players.map((p, i) => ({
        win: p.teamId === me.teamId ? (opts.win ?? true) : !(opts.win ?? true),
        participantId: i + 1,
        teamId: p.teamId,
        championId: p.championId,
        spell1Id: 4,
        spell2Id: 14,
        stats: stats(p.teamId === me.teamId ? (opts.win ?? true) : !(opts.win ?? true))
      })),
      participantIdentities: opts.players.map((p, i) => ({
        player: {
          accountId: i,
          platformId: 'HN1',
          gameName: p.gameName ?? `player${i}`,
          tagLine: p.tagLine ?? '10000',
          summonerName: p.gameName ?? `player${i}`,
          summonerId: i,
          puuid: `puuid-${i}`
        }
      }))
    }
  }
}

/** 常用布阵:我(51 女警) + 队友(222 金克丝, 64 盲僧) vs 对面(36 蒙多, 1 安妮) */
function standardGame(opts: { date?: string; queueId?: number; win?: boolean } = {}): Game {
  return gameOf({
    ...opts,
    players: [
      { championId: 51, teamId: 100, gameName: '我自己', tagLine: '11111' },
      { championId: 222, teamId: 100, gameName: '金克丝队友', tagLine: '22222' },
      { championId: 64, teamId: 100, gameName: '打野哥', tagLine: '33333' },
      { championId: 36, teamId: 200, gameName: '蒙多对面', tagLine: '44444' },
      { championId: 1, teamId: 200, gameName: '安妮对面', tagLine: '55555' }
    ]
  })
}

// ─── filterGames ─────────────────────────────────────────────────────────────

describe('filterGames', () => {
  it('空条件返回全部', () => {
    const games = [standardGame(), standardGame()]
    expect(filterGames(games, emptyQuery())).toHaveLength(2)
  })

  it('按我用的英雄筛选(任一命中)', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), selfChampionIds: [51] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), selfChampionIds: [64] })).toHaveLength(0)
    // 多个 = 或的关系(可能是这几个英雄之一)
    expect(filterGames(games, { ...emptyQuery(), selfChampionIds: [64, 51] })).toHaveLength(1)
  })

  it('队友英雄不含我:队友有金克丝命中,队友有女警(是我自己)不命中', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), allyChampionIds: [222] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), allyChampionIds: [51] })).toHaveLength(0)
  })

  it('队友多英雄是且的关系:222+64 命中,222+36(36 在对面)不命中', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), allyChampionIds: [222, 64] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), allyChampionIds: [222, 36] })).toHaveLength(0)
  })

  it('对面英雄筛选', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), enemyChampionIds: [36] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), enemyChampionIds: [222] })).toHaveLength(0)
  })

  it('我方(含我)筛选:「忘了自己玩的啥」场景女警+金克丝都在我方即命中', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), myTeamChampionIds: [51, 222] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), myTeamChampionIds: [51, 36] })).toHaveLength(0)
  })

  it('按胜负筛选', () => {
    const games = [standardGame({ win: true }), standardGame({ win: false })]
    expect(filterGames(games, { ...emptyQuery(), result: 'win' })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), result: 'loss' })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), result: 'any' })).toHaveLength(2)
  })

  it('按队列筛选', () => {
    const games = [standardGame({ queueId: 420 }), standardGame({ queueId: 450 })]
    expect(filterGames(games, { ...emptyQuery(), queueIds: [450] })).toHaveLength(1)
  })

  it('时间窗含端点:to 当天整天算在内', () => {
    const games = [
      standardGame({ date: '2026-08-01T00:30:00.000Z' }),
      standardGame({ date: '2026-08-31T23:00:00.000Z' }),
      standardGame({ date: '2026-09-01T08:00:00.000Z' })
    ]
    const q = { ...emptyQuery(), timeRange: { from: '2026-08-01', to: '2026-08-31' } }
    expect(filterGames(games, q)).toHaveLength(2)
  })

  it('玩家名匹配:全名#tag、纯名、大小写不敏感均可', () => {
    const games = [standardGame()]
    expect(filterGames(games, { ...emptyQuery(), playerNames: ['金克丝队友#22222'] })).toHaveLength(
      1
    )
    expect(filterGames(games, { ...emptyQuery(), playerNames: ['蒙多对面'] })).toHaveLength(1)
    expect(filterGames(games, { ...emptyQuery(), playerNames: ['不存在的人'] })).toHaveLength(0)
  })

  it('gameDetail 缺全队数据时,队友/对面条件按不命中处理而非报错', () => {
    const g = standardGame()
    g.gameDetail.participants = []
    g.gameDetail.participantIdentities = []
    expect(() => filterGames([g], { ...emptyQuery(), allyChampionIds: [222] })).not.toThrow()
    expect(filterGames([g], { ...emptyQuery(), allyChampionIds: [222] })).toHaveLength(0)
    // 但只有 self 条件时仍可命中(顶层 participants[0] 可用)
    expect(filterGames([g], { ...emptyQuery(), selfChampionIds: [51] })).toHaveLength(1)
  })
})

// ─── countEncounters ─────────────────────────────────────────────────────────

describe('countEncounters', () => {
  it('统计与指定玩家的相遇次数,分同队/对面', () => {
    const asAlly = standardGame({ date: '2026-08-10T10:00:00.000Z' })
    const asEnemy = gameOf({
      date: '2026-08-12T10:00:00.000Z',
      players: [
        { championId: 51, teamId: 100, gameName: '我自己', tagLine: '11111' },
        { championId: 64, teamId: 100, gameName: '打野哥', tagLine: '33333' },
        { championId: 222, teamId: 200, gameName: '金克丝队友', tagLine: '22222' }
      ]
    })
    const unrelated = gameOf({
      date: '2026-08-13T10:00:00.000Z',
      players: [
        { championId: 51, teamId: 100, gameName: '我自己', tagLine: '11111' },
        { championId: 36, teamId: 200, gameName: '路人', tagLine: '66666' }
      ]
    })
    const q = {
      ...emptyQuery(),
      playerNames: ['金克丝队友#22222'],
      intent: 'count_encounters' as const
    }
    const { stats, games } = countEncounters([asAlly, asEnemy, unrelated], q)
    expect(stats.total).toBe(2)
    expect(stats.perName['金克丝队友#22222']).toEqual({ ally: 1, enemy: 1 })
    expect(games).toHaveLength(2)
  })

  it('先应用时间窗与队列过滤再统计', () => {
    const inRange = standardGame({ date: '2026-08-10T10:00:00.000Z' })
    const outOfRange = standardGame({ date: '2026-07-01T10:00:00.000Z' })
    const q = {
      ...emptyQuery(),
      playerNames: ['金克丝队友'],
      timeRange: { from: '2026-08-01', to: null },
      intent: 'count_encounters' as const
    }
    const { stats } = countEncounters([inRange, outOfRange], q)
    expect(stats.total).toBe(1)
  })
})
