/**
 * AI 标签建议的输入特征提取：把 LCU 对局原始数据压成喂给 AI 的精简结构。
 */

// Common LCU queue IDs → Chinese mode names. Covers ranked, normal matchmaking, and the
// most popular entertainment / rotating modes. Unknown ids fall back to '娱乐模式'.
const QUEUE_NAMES: Record<number, string> = {
  // Ranked
  420: '单双排位',
  440: '灵活组排',
  // Normal matchmaking
  430: '匹配模式',
  480: '快速匹配',
  // Clash
  700: '冠军杯赛',
  720: '冠军杯赛大乱斗',
  // ARAM and ARAM variants
  450: '大乱斗',
  100: '旧版大乱斗',
  // Featured / rotating modes
  900: '无限火力',
  1900: '无限火力',
  920: '飞升',
  1010: '雪球大战',
  1020: '一拳超人',
  1300: '觉醒之战',
  1400: '终极魔典',
  1700: '斗魂竞技场',
  1810: '斗魂竞技场排位',
  // Hexakill (海克斯乱斗) — historically multiple ids
  75: '海克斯乱斗',
  98: '海克斯乱斗',
  // Co-op vs AI
  830: '新手 AI',
  840: '中级 AI',
  850: '高级 AI'
}

// Categories for the fallback when queue id isn't in the map.
// Anything outside ranked/matchmaking is almost certainly an entertainment / featured mode.
const KNOWN_RANKED: ReadonlySet<number> = new Set([420, 440])
const KNOWN_MATCHMAKING: ReadonlySet<number> = new Set([430, 480])

/**
 * 将 queueId 转换为对应的中文模式名。未知 id 返回 '娱乐模式'。
 */
export function queueIdToName(id: number): string {
  if (QUEUE_NAMES[id]) return QUEUE_NAMES[id]
  if (KNOWN_RANKED.has(id)) return '排位模式'
  if (KNOWN_MATCHMAKING.has(id)) return '匹配模式'
  return '娱乐模式'
}

export interface GameFeature {
  win: boolean
  championId: number
  queueId: number
  /** 中文模式名，如 '单双排位'、'大乱斗'，供 AI 直接识别 */
  queueName: string
  durationMin: number
  kda: { k: number; d: number; a: number; ratio: number }
  damage: number
  gold: number
}

interface RawParticipantStats {
  win?: boolean
  kills?: number
  deaths?: number
  assists?: number
  totalDamageDealtToChampions?: number
  goldEarned?: number
}

interface RawParticipant {
  championId?: number
  stats?: RawParticipantStats
}

interface RawIdentity {
  player?: { puuid?: string }
}

export interface RawGame {
  gameId: number
  queueId: number
  gameDuration: number // seconds
  participants: RawParticipant[]
  participantIdentities: RawIdentity[]
}

/**
 * 提取一场对局中指定玩家的特征。puuid 不在该场中时返回 null。
 *
 * 约定：deaths=0 时按 1 处理（避免除零、保持 KDA 仍可比较）。
 */
export function gameToFeature(game: RawGame, myPuuid: string): GameFeature | null {
  const idx = game.participantIdentities.findIndex(i => i.player?.puuid === myPuuid)
  if (idx < 0) return null
  const p = game.participants[idx]
  if (!p) return null
  const s = p.stats ?? {}
  const k = s.kills ?? 0
  const d = s.deaths ?? 0
  const a = s.assists ?? 0
  const dForRatio = d === 0 ? 1 : d
  return {
    win: s.win ?? false,
    championId: p.championId ?? 0,
    queueId: game.queueId,
    queueName: queueIdToName(game.queueId),
    durationMin: Math.round(game.gameDuration / 60),
    kda: { k, d, a, ratio: (k + a) / dForRatio },
    damage: s.totalDamageDealtToChampions ?? 0,
    gold: s.goldEarned ?? 0
  }
}

/**
 * 将特征列表按胜负拆分为两个数组。
 */
export function splitWinsLosses(features: GameFeature[]): {
  wins: GameFeature[]
  losses: GameFeature[]
} {
  const wins: GameFeature[] = []
  const losses: GameFeature[] = []
  for (const f of features) {
    if (f.win) wins.push(f)
    else losses.push(f)
  }
  return { wins, losses }
}
