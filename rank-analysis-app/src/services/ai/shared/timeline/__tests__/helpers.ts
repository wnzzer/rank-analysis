/**
 * 卡片提取器单测的最小构造器（测试专用，不进生产包）。
 * 提供 10 人名册、单玩家帧、整帧、提取器输入的默认值，便于各用例只覆盖关心的字段。
 */
import type { CardInput, RosterPlayer, SlimFrame, SlimPlayerFrame } from '../types'

const BLUE = ['剑魔', '盲僧', '发条', '卡莎', '锤石']
const RED = ['诺手', '皇子', '妖姬', 'EZ', '璐璐']
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

/** 10 人名册：1-5 蓝方、6-10 红方，按槽位上/野/中/下/辅 */
export const ROSTER: RosterPlayer[] = Array.from({ length: 10 }, (_, i) => ({
  participantId: i + 1,
  teamId: i < 5 ? 100 : 200,
  teamPosition: POS[i % 5],
  champion: (i < 5 ? BLUE : RED)[i % 5],
  name: `玩家${i + 1}`
}))

/** 单个玩家帧（默认站在 (0,0)、全 0） */
export function pf(participantId: number, over: Partial<SlimPlayerFrame> = {}): SlimPlayerFrame {
  return {
    participantId,
    totalGold: 0,
    xp: 0,
    level: 1,
    cs: 0,
    jungleCs: 0,
    x: 0,
    y: 0,
    damageToChampions: 0,
    ...over
  }
}

/** 一帧：未指定的玩家用默认帧补齐 10 人 */
export function frame(timestamp: number, players: SlimPlayerFrame[] = []): SlimFrame {
  const byId = new Map(players.map(p => [p.participantId, p]))
  return { timestamp, players: ROSTER.map(r => byId.get(r.participantId) ?? pf(r.participantId)) }
}

/** 提取器输入（召唤师峡谷、有分路、有出装） */
export function input(
  over: Partial<CardInput['tl']> = {},
  opts: Partial<Omit<CardInput, 'tl'>> = {}
): CardInput {
  return {
    tl: {
      gameId: 1,
      frameIntervalMs: 60000,
      participants: [],
      frames: [],
      events: [],
      items: {},
      ...over
    },
    roster: ROSTER,
    hasLanes: true,
    hasItemBuild: true,
    mapId: 11,
    ...opts
  }
}
