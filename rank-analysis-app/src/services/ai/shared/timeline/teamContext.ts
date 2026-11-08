/**
 * 团队处境预计算：单人复盘需要知道"队友是不是先崩了"，否则模型会把全队的问题算在本人头上。
 * 纯函数，从时间线与名册算出每位玩家的 14 分钟对线经济差、阵亡总数、以及"队友先倒"的阵亡次数。
 */
import { frameAtMinute } from './geometry'
import { laneOpponent } from './cards/lane'
import type { CardInput, SlimFrame } from './types'

/** 队友先倒的统计窗口（毫秒） */
const TEAMMATES_DOWN_WINDOW_MS = 30000
/** 触发"被连累"的最少先倒队友数 */
const TEAMMATES_DOWN_MIN = 2
const LANE_CHECK_MS = 14 * 60000

/**
 * 单个玩家的团队处境
 * @property laneGoldDiff14 - 14 分钟与对位的经济差，正=领先；无分路/无对位/无数据为 null
 * @property deaths - 本人阵亡总数（时间线口径）
 * @property deathsAfterTeammatesDown - 本人阵亡前 30 秒内（含同一时刻）已有 ≥2 名队友阵亡的次数
 */
export interface PlayerTeamContext {
  /** 14 分钟（无该帧则取最后一个 ≤14 分钟的帧，再无则 null）与对位的经济差，正=领先；无分路/无对位为 null */
  laneGoldDiff14: number | null
  /** 本人阵亡总数（时间线口径） */
  deaths: number
  /** 本人阵亡前 30 秒内（含同一时刻）已有 ≥2 名队友阵亡的次数 */
  deathsAfterTeammatesDown: number
}

/**
 * 对线检查帧（14 分钟）：优先与 14 分钟相差 ≤30s 的最近帧，否则退回最后一个 ≤14 分钟的帧。
 * teamContext 与评分指标共用，保证两处对线差口径一致。
 */
export function laneCheckFrame(input: CardInput): SlimFrame | undefined {
  const near = frameAtMinute(input.tl, 14)
  if (near) return near
  let last: SlimFrame | undefined
  for (const f of input.tl.frames) {
    if (f.timestamp <= LANE_CHECK_MS && (!last || f.timestamp > last.timestamp)) last = f
  }
  return last
}

/**
 * 为名册中每位玩家计算团队处境。
 * @returns participantId → PlayerTeamContext
 */
export function buildTeamContext(input: CardInput): Record<number, PlayerTeamContext> {
  const { tl, roster, hasLanes } = input
  const kills = tl.events.flatMap(e => (e.type === 'CHAMPION_KILL' ? [e] : []))
  const frame = hasLanes ? laneCheckFrame(input) : undefined
  const out: Record<number, PlayerTeamContext> = {}

  for (const me of roster) {
    let laneGoldDiff14: number | null = null
    if (frame) {
      const opp = laneOpponent(roster, me.participantId)
      const a = frame.players.find(p => p.participantId === me.participantId)
      const b = opp && frame.players.find(p => p.participantId === opp.participantId)
      if (a && b) laneGoldDiff14 = a.totalGold - b.totalGold
    }

    const teammateIds = new Set(
      roster
        .filter(r => r.teamId === me.teamId && r.participantId !== me.participantId)
        .map(r => r.participantId)
    )
    const myDeaths = kills.filter(k => k.victimId === me.participantId)
    let deathsAfterTeammatesDown = 0
    for (const d of myDeaths) {
      const down = new Set(
        kills
          .filter(
            k =>
              teammateIds.has(k.victimId) &&
              k.timestamp >= d.timestamp - TEAMMATES_DOWN_WINDOW_MS &&
              k.timestamp <= d.timestamp
          )
          .map(k => k.victimId)
      )
      if (down.size >= TEAMMATES_DOWN_MIN) deathsAfterTeammatesDown++
    }

    out[me.participantId] = {
      laneGoldDiff14,
      deaths: myDeaths.length,
      deathsAfterTeammatesDown
    }
  }
  return out
}
