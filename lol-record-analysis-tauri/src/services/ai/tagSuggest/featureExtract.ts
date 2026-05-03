/**
 * AI 标签建议的输入特征提取：把 LCU 对局原始数据压成喂给 AI 的精简结构。
 */

// 队列分类兜底：未在动态 map 里、又落在已知 ranked / matchmaking 范围 → 给类别名；
// 其余统一视为娱乐模式（绝大多数未列出的 LCU queue id 都是娱乐 / 限时模式）。
const KNOWN_RANKED: ReadonlySet<number> = new Set([420, 440])
const KNOWN_MATCHMAKING: ReadonlySet<number> = new Set([430, 480, 490])

/** queueId → 中文模式名映射，运行时从 Rust 端 get_game_modes 拉取后传入。 */
export type QueueNameMap = Record<number, string>

/**
 * queueId 解析中文名。优先使用注入的 nameMap（来自项目的 QUEUE_ID_TO_CN），
 * 没有命中再走分类兜底。
 */
export function queueIdToName(id: number, nameMap?: QueueNameMap): string {
  if (nameMap?.[id]) return nameMap[id]
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
export function gameToFeature(
  game: RawGame,
  myPuuid: string,
  nameMap?: QueueNameMap
): GameFeature | null {
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
    queueName: queueIdToName(game.queueId, nameMap),
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
