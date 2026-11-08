/**
 * DETAILS participantId → LCU participantId 对齐（按 puuid，不假设顺序一致）。
 */
import type { Game } from '@renderer/types/domain/match'
import type { SlimEvent, SlimTimeline } from './types'

/**
 * 从 LCU 对局取 puuid → participantId（身份数组下标 + 1，与 snapshot 的约定一致）。
 * 空 puuid 忽略；出现多次的 puuid 整体丢弃（宁可对不上记 0，也不能把两人并成一人）。
 * @param game - LCU 对局（优先 gameDetail 的全量身份）
 */
export function buildPuuidMap(game: Game): Map<string, number> {
  const ids = game.gameDetail?.participantIdentities?.length
    ? game.gameDetail.participantIdentities
    : game.participantIdentities
  const out = new Map<string, number>()
  const dup = new Set<string>()
  ids.forEach((identity, i) => {
    const puuid = identity?.player?.puuid
    if (!puuid) return
    if (out.has(puuid)) dup.add(puuid)
    else out.set(puuid, i + 1)
  })
  for (const puuid of dup) out.delete(puuid)
  return out
}

/**
 * 把时间线里所有 participantId 改写成 LCU 编号；对不上的玩家记为 0（提取器忽略 0）。
 * DETAILS 侧 puuid 为空或重复的玩家同样记 0。
 * @param tl - Rust 返回的裁剪时间线
 * @param lcuPidByPuuid - {@link buildPuuidMap} 的结果
 */
export function remapTimeline(tl: SlimTimeline, lcuPidByPuuid: Map<string, number>): SlimTimeline {
  const seen = new Map<string, number>()
  for (const p of tl.participants) seen.set(p.puuid, (seen.get(p.puuid) ?? 0) + 1)
  const byDetails = new Map<number, number>()
  for (const p of tl.participants) {
    const trusted = !!p.puuid && seen.get(p.puuid) === 1
    byDetails.set(p.participantId, trusted ? (lcuPidByPuuid.get(p.puuid) ?? 0) : 0)
  }
  const m = (pid: number): number => (pid > 0 ? (byDetails.get(pid) ?? 0) : pid)

  const events: SlimEvent[] = tl.events.map(e => {
    switch (e.type) {
      case 'CHAMPION_KILL':
        return {
          ...e,
          killerId: m(e.killerId),
          victimId: m(e.victimId),
          assisting: e.assisting.map(m),
          damageReceived: e.damageReceived.map(d => ({ ...d, participantId: m(d.participantId) }))
        }
      case 'WARD_PLACED':
        return { ...e, creatorId: m(e.creatorId) }
      case 'ITEM_PURCHASED':
      case 'ITEM_SOLD':
      case 'ITEM_UNDO':
      case 'SKILL_LEVEL_UP':
        return { ...e, participantId: m(e.participantId) }
      case 'GAME_END':
        return e
      default:
        return { ...e, killerId: m(e.killerId) }
    }
  })

  return {
    ...tl,
    participants: tl.participants.map(p => ({ ...p, participantId: m(p.participantId) })),
    frames: tl.frames.map(f => ({
      ...f,
      players: f.players
        .map(p => ({ ...p, participantId: m(p.participantId) }))
        .filter(p => p.participantId > 0)
        .sort((a, b) => a.participantId - b.participantId)
    })),
    events
  }
}
