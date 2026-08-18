import { describe, it, expect, vi } from 'vitest'
import { mergeGamesByGameId, collectSgpHistoryAll, type SgpFetchPage } from '../sgp'
import type {
  Game,
  MatchHistory,
  Participant,
  ParticipantStats
} from '@renderer/types/domain/match'

/** collectMode 单测：sgp.ts 的合并去重与全量收集循环（fetchPage 注入，不触 IPC） */

function makeGame(gameId: number): Game {
  const stats: ParticipantStats = {
    win: true,
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
    subteamPlacement: 0
  }
  const participant: Participant = {
    win: true,
    participantId: 1,
    teamId: 0,
    championId: 1,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
  return {
    mvp: '',
    gameDetail: { participants: [], participantIdentities: [], endOfGameResult: '' },
    gameId,
    gameCreationDate: new Date(1_700_000_000_000 - gameId).toISOString(),
    gameDuration: 1800,
    gameMode: '',
    gameType: '',
    mapId: 0,
    queueId: 420,
    queueName: '',
    platformId: '',
    participantIdentities: [],
    participants: [participant]
  }
}

function pageResponse(ids: number[]): MatchHistory {
  return {
    platformId: 'HN10',
    begIndex: 0,
    endIndex: 0,
    games: { games: ids.map(makeGame) }
  }
}

/** 顺序生成 N 页 x 每页 pageSize 场（id = startIndex 起连续），尾页可指定条数 */
function makePagedFetch(
  pages: number[],
  opts: { failAt?: number; overlap?: number } = {}
): { fetchPage: SgpFetchPage; calls: Array<[string, string, number, number]> } {
  const calls: Array<[string, string, number, number]> = []
  let pageNum = 0
  const fetchPage: SgpFetchPage = (_region, _name, begIndex, count) => {
    calls.push([_region, _name, begIndex, count])
    if (opts.failAt !== undefined && pageNum === opts.failAt) {
      pageNum++
      return Promise.resolve(null)
    }
    const size = pages[Math.min(pageNum, pages.length - 1)]
    pageNum++
    // overlap 只作用于「第 2 页起」（模拟翻页边界重叠），首页不受影响
    const overlap = pageNum > 1 ? (opts.overlap ?? 0) : 0
    const ids: number[] = []
    for (let i = 0; i < size; i++) {
      // overlap = 与上一页重复的条数；id 从 begIndex - overlap 起
      ids.push(begIndex - overlap + i)
    }
    return Promise.resolve(pageResponse(ids))
  }
  return { fetchPage, calls }
}

describe('mergeGamesByGameId', () => {
  it('追加 fresh 到 prev 尾部，保持时间降序', () => {
    const prev = [makeGame(3), makeGame(2)]
    const merged = mergeGamesByGameId(prev, [makeGame(1), makeGame(0)])
    expect(merged.map(g => g.gameId)).toEqual([3, 2, 1, 0])
  })

  it('重叠对局只保留先到的（按 gameId 去重）', () => {
    const prev = [makeGame(3), makeGame(2), makeGame(1)]
    const merged = mergeGamesByGameId(prev, [makeGame(2), makeGame(1), makeGame(0)])
    expect(merged.map(g => g.gameId)).toEqual([3, 2, 1, 0])
    expect(merged.length).toBe(4)
  })

  it('空 incoming 原样返回 prev 引用', () => {
    const prev = [makeGame(1)]
    expect(mergeGamesByGameId(prev, [])).toBe(prev)
  })

  it('全重复页（数据源异常）原样返回 prev 引用', () => {
    const prev = [makeGame(1), makeGame(2)]
    expect(mergeGamesByGameId(prev, [makeGame(2), makeGame(1)])).toBe(prev)
  })
})

describe('collectSgpHistoryAll', () => {
  it('整段收集：多页拉完 + 空批次自然终止，nextStartIndex 如实推进', async () => {
    const { fetchPage, calls } = makePagedFetch([50, 50, 50, 0])
    const onPage = vi.fn()
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage,
      onPage
    })
    expect(result.games.map(g => g.gameId)).toEqual(Array.from({ length: 150 }, (_, i) => i))
    expect(result.reachedEnd).toBe(true)
    expect(result.cancelled).toBe(false)
    expect(result.nextStartIndex).toBe(150)
    expect(calls.map(c => c[2])).toEqual([0, 50, 100, 150])
    expect(onPage).toHaveBeenCalledTimes(3)
    expect(onPage.mock.calls[2][0]).toHaveLength(150)
  })

  it('尾页不足一页也视为自然终止', async () => {
    const { fetchPage } = makePagedFetch([50, 20])
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage
    })
    expect(result.games).toHaveLength(70)
    expect(result.reachedEnd).toBe(true)
    expect(result.nextStartIndex).toBe(70)
  })

  it('达 maxGames 截断：reachedEnd=false，续收游标 = 已请求条数', async () => {
    const { fetchPage, calls } = makePagedFetch([50, 50, 50])
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage,
      maxGames: 120
    })
    expect(result.games).toHaveLength(150) // 第 3 页被拉回但整体超上限即停
    expect(result.reachedEnd).toBe(false)
    expect(result.nextStartIndex).toBe(150)
    expect(calls).toHaveLength(3)
  })

  it('shouldContinue=false 立即中断：保留已收集部分并标记 cancelled', async () => {
    const { fetchPage, calls } = makePagedFetch([50, 50, 50])
    let allow = true
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage,
      shouldContinue: () => {
        const cont = allow
        allow = false
        return cont
      }
    })
    expect(result.games).toHaveLength(50)
    expect(result.cancelled).toBe(true)
    expect(result.reachedEnd).toBe(false)
    expect(result.nextStartIndex).toBe(50)
    expect(calls).toHaveLength(1) // 第 2 页请求前的检查即退出
  })

  it('翻页失败（null）：按已收集部分交付，不整批作废', async () => {
    const { fetchPage, calls } = makePagedFetch([50, 50, 50], { failAt: 2 })
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage
    })
    expect(result.games).toHaveLength(100)
    expect(result.reachedEnd).toBe(false)
    expect(result.cancelled).toBe(false)
    expect(result.nextStartIndex).toBe(100)
    expect(calls).toHaveLength(3)
  })

  it('跨页重叠：added===0 时终止防死循环', async () => {
    const { fetchPage } = makePagedFetch([50, 50], { overlap: 50 })
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      fetchPage
    })
    expect(result.games).toHaveLength(50) // 第 2 页与第 1 页全重复
    expect(result.reachedEnd).toBe(true) // 按末尾处理，续收游标已推进不会死循环
  })

  it('续收：startIndex 从上次终止处继续', async () => {
    const { fetchPage, calls } = makePagedFetch([30])
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      startIndex: 50,
      fetchPage
    })
    expect(result.games).toHaveLength(30)
    expect(calls[0][2]).toBe(50)
    expect(result.nextStartIndex).toBe(80)
  })

  it('initialGames 种子：结果以既有列表为基础追加，重叠页去重', async () => {
    const { fetchPage } = makePagedFetch([50, 0])
    const initial = [makeGame(0), makeGame(1)] // 与后续页无重叠的既有数据
    const result = await collectSgpHistoryAll({
      region: 'HN10',
      name: 'Tester#0001',
      startIndex: 50,
      initialGames: initial,
      fetchPage
    })
    expect(result.games.map(g => g.gameId)).toEqual([
      0,
      1,
      ...Array.from({ length: 50 }, (_, i) => 50 + i)
    ])
    expect(result.games).toHaveLength(52)
    expect(result.reachedEnd).toBe(true)
  })
})
