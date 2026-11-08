/**
 * 赛后复盘时间线拉取：读开关 → invoke Rust → puuid 对齐。任何失败都降级为 null。
 *
 * 结果按 gameId 在本次会话内记忆（含失败）：SGP 慢或不可用时，切 tab / 切单人复盘
 * 不会每次重新等 8s 超时。开关关闭（disabled）不记忆，用户可能随时打开。
 */
import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@renderer/types/domain/match'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { buildPuuidMap, remapTimeline } from './remap'
import type { SlimTimeline, TimelineStatus } from './types'

type FetchResult = { timeline: SlimTimeline | null; status: TimelineStatus }

/** 记忆上限：时间线对象较大，只留最近若干局（插入序淘汰最旧） */
const MEMO_LIMIT = 30

/** gameId → 拉取结果（进行中的请求也在内，并发调用共享同一个 Promise） */
const memo = new Map<number, Promise<FetchResult>>()

/**
 * 是否支持时间线卡片：仅召唤师峡谷（11）与嚎哭深渊（12）。
 * 斗魂竞技场（30）等地图的坐标/对线/团战口径不适用，卡片只会是噪音。
 */
export function supportsTimeline(game: Game): boolean {
  return game.mapId === 11 || game.mapId === 12
}

/** 清空会话记忆（测试用） */
export function clearTimelineMemo(): void {
  memo.clear()
}

/**
 * 拉取对局时间线。
 * @param game - LCU 对局（需 platformId）
 * @returns timeline 与状态；开关关闭（键不存在视为开）→ disabled，失败 → unavailable
 */
export async function fetchMatchTimeline(game: Game): Promise<FetchResult> {
  try {
    const enabled = (await getConfigByIpc<boolean>(CONFIG_KEYS.aiUseTimeline)) !== false
    if (!enabled) return { timeline: null, status: 'disabled' }
  } catch (err) {
    console.warn('match timeline switch unreadable, falling back to end-of-game data', err)
    return { timeline: null, status: 'unavailable' }
  }
  const hit = memo.get(game.gameId)
  if (hit) return hit
  const pending = loadTimeline(game)
  memo.set(game.gameId, pending)
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as number)
  return pending
}

/** 实际拉取 + 对齐；永不 reject（失败折成 unavailable，便于记忆） */
async function loadTimeline(game: Game): Promise<FetchResult> {
  if (!game.platformId) return { timeline: null, status: 'unavailable' }
  try {
    const raw = await invoke<SlimTimeline>('get_match_timeline', {
      platformId: game.platformId,
      gameId: game.gameId
    })
    return { timeline: remapTimeline(raw, buildPuuidMap(game)), status: 'ok' }
  } catch (err) {
    console.warn('match timeline unavailable, falling back to end-of-game data', err)
    return { timeline: null, status: 'unavailable' }
  }
}
