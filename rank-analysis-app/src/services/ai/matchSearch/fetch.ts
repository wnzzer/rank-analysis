/**
 * AI 搜战绩的数据拉取:SGP 深分页 + LCU 降级
 *
 * 为什么走 SGP:LCU 战绩列表最多 50 局且每局 participants 只有自己,
 * 查「队友有金克丝」需要全队数据;SGP 支持任意深分页且单次返回全队。
 * SGP 不可用(网关/权限/无对局)时降级 LCU 最近 50 局(enrich 后同样有全队)。
 */

import { invoke } from '@tauri-apps/api/core'
import type { Game, MatchHistory } from '@renderer/types/domain/match'
import type { ParsedMatchQuery } from './types'

/** SGP 单页条数 */
export const PAGE_SIZE = 20
/** 有时间窗时最多拉取的对局数(约 10 页) */
export const MAX_GAMES_WITH_RANGE = 200
/** 无时间窗时最多拉取的对局数 */
export const MAX_GAMES_NO_RANGE = 100

/** 分页进度(供 UI 展示「已拉 N 局 / 覆盖至某日」) */
export interface FetchProgress {
  fetched: number
  oldestDate: string | null
}

export interface FetchResult {
  games: Game[]
  /** 实际数据源:sgp = 深分页;lcu = 降级后仅最近 50 局 */
  source: 'sgp' | 'lcu'
  /** 因达到拉取上限而截断(提示用户可能还有更早的匹配对局) */
  truncated: boolean
  /** 被查玩家 gameName#tagLine */
  selfName: string
}

interface MySummoner {
  gameName: string
  tagLine: string
  puuid: string
}

/**
 * 按查询条件拉取当前登录玩家的对局(只做拉取,筛选交给 filter.ts)
 * @param q - 已解析的查询条件(只用 timeRange.from 决定翻页深度)
 * @param onProgress - 每页完成后的进度回调
 * @throws Error LCU 未连接等不可恢复错误(中文可展示信息)
 */
export async function fetchGamesForQuery(
  q: ParsedMatchQuery,
  onProgress?: (p: FetchProgress) => void
): Promise<FetchResult> {
  let me: MySummoner
  try {
    me = await invoke<MySummoner>('get_my_summoner')
  } catch {
    throw new Error('无法获取当前召唤师,请先启动并登录游戏客户端')
  }
  const selfName = `${me.gameName}#${me.tagLine}`
  const maxGames = q.timeRange.from ? MAX_GAMES_WITH_RANGE : MAX_GAMES_NO_RANGE
  const fromTs = q.timeRange.from ? new Date(`${q.timeRange.from}T00:00:00.000Z`).getTime() : null

  try {
    const games = await fetchViaSgp(selfName, maxGames, fromTs, onProgress)
    return { ...games, source: 'sgp', selfName }
  } catch (e) {
    console.warn('[matchSearch] SGP 拉取失败,降级 LCU 最近 50 局:', e)
  }

  const history = await invoke<MatchHistory>('get_match_history_by_puuid', {
    puuid: me.puuid,
    begIndex: 0,
    endIndex: 49
  })
  const games = history.games?.games ?? []
  onProgress?.({ fetched: games.length, oldestDate: oldestOf(games) })
  return { games, source: 'lcu', truncated: false, selfName }
}

function oldestOf(games: Game[]): string | null {
  return games.length > 0 ? games[games.length - 1].gameCreationDate : null
}

/** SGP 分页循环:空页/短页到头、越过时间下限、达到上限三类停止条件 */
async function fetchViaSgp(
  selfName: string,
  maxGames: number,
  fromTs: number | null,
  onProgress?: (p: FetchProgress) => void
): Promise<{ games: Game[]; truncated: boolean }> {
  const region = await invoke<string>('get_current_sgp_region')
  const all: Game[] = []
  let truncated = false

  while (all.length < maxGames) {
    const page = await invoke<MatchHistory>('get_sgp_match_history_by_name', {
      region,
      name: selfName,
      begIndex: all.length,
      count: PAGE_SIZE
    })
    const games = page.games?.games ?? []
    all.push(...games)
    onProgress?.({ fetched: all.length, oldestDate: oldestOf(all) })

    // 短页/空页 = 战绩到头
    if (games.length < PAGE_SIZE) return { games: all, truncated: false }

    // 页内最旧一局已越过时间下限,更早的对局不可能命中
    if (fromTs !== null) {
      const oldest = new Date(games[games.length - 1].gameCreationDate).getTime()
      if (!Number.isNaN(oldest) && oldest < fromTs) return { games: all, truncated: false }
    }
  }
  truncated = true
  return { games: all.slice(0, maxGames), truncated }
}
