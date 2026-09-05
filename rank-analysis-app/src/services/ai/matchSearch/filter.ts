/**
 * 对局本地筛选与相遇统计(纯函数)
 *
 * 数据形状约定(LCU enrich 与 SGP 映射后一致):
 * - `game.participants[0]` = 被查玩家(我),胜负/我的英雄从这里取
 * - `game.gameDetail.participants` = 全队 10 人,与
 *   `game.gameDetail.participantIdentities` 按下标对齐
 * - 在 gameDetail 中定位「我」用 championId + teamId 双匹配
 *   (两条数据链路都不保证 detail 里有我的 puuid)
 */

import type { Game, Participant, MatchPlayerIdentity } from '@renderer/types/domain/match'
import { assignTeamPositions } from '../shared/positionAssign'
import { inferTeamPosition } from '../shared/positionInfer'
import type { ParsedMatchQuery, EncounterStats } from './types'

/** 一局对局按「我」的视角拆出的双方成员(带 identities 对齐下标) */
interface TeamSplit {
  /** 我方成员(含我)在 gameDetail 中的下标 */
  myTeam: number[]
  /** 对面成员下标 */
  enemyTeam: number[]
  /** 「我」在 gameDetail 中的下标,找不到为 -1 */
  selfIndex: number
}

/** 拆分双方;gameDetail 缺数据时返回空阵容(调用方按不命中处理) */
function splitTeams(game: Game): TeamSplit {
  const self = game.participants[0]
  const detail = game.gameDetail?.participants ?? []
  if (!self || detail.length === 0) return { myTeam: [], enemyTeam: [], selfIndex: -1 }

  const selfIndex = detail.findIndex(
    p => p.championId === self.championId && p.teamId === self.teamId
  )
  const myTeam: number[] = []
  const enemyTeam: number[] = []
  detail.forEach((p, i) => {
    ;(p.teamId === self.teamId ? myTeam : enemyTeam).push(i)
  })
  return { myTeam, enemyTeam, selfIndex }
}

/** 指定下标集合内是否出现了 wanted 中的每一个英雄(且语义) */
function containsAllChampions(detail: Participant[], indexes: number[], wanted: number[]): boolean {
  return wanted.every(id => indexes.some(i => detail[i]?.championId === id))
}

/** 时间窗判断:from 起于当日 00:00,to 含当日整天 */
function inTimeRange(game: Game, from: string | null, to: string | null): boolean {
  const t = new Date(game.gameCreationDate).getTime()
  if (Number.isNaN(t)) return false
  if (from && t < new Date(`${from}T00:00:00.000Z`).getTime()) return false
  if (to && t > new Date(`${to}T23:59:59.999Z`).getTime()) return false
  return true
}

/** 玩家名匹配:名#tag 或纯名全等(大小写不敏感),再退化到子串 */
function identityMatches(identity: MatchPlayerIdentity, wanted: string): boolean {
  const w = wanted.toLowerCase()
  const gameName = (identity.player?.gameName ?? '').toLowerCase()
  const full = `${gameName}#${(identity.player?.tagLine ?? '').toLowerCase()}`
  if (!gameName) return false
  return full === w || gameName === w || full.includes(w)
}

/**
 * 推断「我」这一局的分路:优先对我方整队做排除法(与 AI 复盘同一套
 * positionAssign 逻辑),gameDetail 缺阵容时退化为逐人启发式。
 */
function selfPositionOf(game: Game): string {
  const self = game.participants[0]
  if (!self) return 'UNKNOWN'
  const myTeam = (game.gameDetail?.participants ?? []).filter(p => p.teamId === self.teamId)
  if (myTeam.length > 0) {
    const selfIdx = myTeam.findIndex(
      p => p.championId === self.championId && p.teamId === self.teamId
    )
    if (selfIdx >= 0) {
      const assigned = assignTeamPositions(
        myTeam.map(p => ({
          championId: p.championId,
          spellIds: [p.spell1Id, p.spell2Id],
          minionsKilled: p.stats?.totalMinionsKilled ?? 0,
          jungleMinionsKilled: p.stats?.neutralMinionsKilled ?? 0
        }))
      )
      return assigned[selfIdx]
    }
  }
  return inferTeamPosition({
    teamPosition: '',
    spellIds: [self.spell1Id, self.spell2Id],
    championId: self.championId
  })
}

/** 时间窗 + 队列的前置过滤(list 与 count 两种意图共用) */
function baseFilter(game: Game, q: ParsedMatchQuery): boolean {
  if (!inTimeRange(game, q.timeRange.from, q.timeRange.to)) return false
  if (q.queueIds.length > 0 && !q.queueIds.includes(game.queueId)) return false
  return true
}

/** 单局是否命中全部条件 */
function gameMatches(game: Game, q: ParsedMatchQuery): boolean {
  if (!baseFilter(game, q)) return false

  const self = game.participants[0]
  if (!self) return false

  if (q.result !== 'any' && self.stats?.win !== (q.result === 'win')) return false

  // 我用的英雄:多个是「其中之一」(用户记不清备选)
  if (q.selfChampionIds.length > 0 && !q.selfChampionIds.includes(self.championId)) return false

  // 我玩的位置:多个是「其中之一」
  if (q.selfPositions.length > 0 && !(q.selfPositions as string[]).includes(selfPositionOf(game)))
    return false

  const detail = game.gameDetail?.participants ?? []
  const { myTeam, enemyTeam, selfIndex } = splitTeams(game)

  // 队友 = 我方去掉我
  if (q.allyChampionIds.length > 0) {
    const allies = myTeam.filter(i => i !== selfIndex)
    if (!containsAllChampions(detail, allies, q.allyChampionIds)) return false
  }
  if (q.myTeamChampionIds.length > 0) {
    if (!containsAllChampions(detail, myTeam, q.myTeamChampionIds)) return false
  }
  if (q.enemyChampionIds.length > 0) {
    if (!containsAllChampions(detail, enemyTeam, q.enemyChampionIds)) return false
  }

  if (q.playerNames.length > 0) {
    const identities = game.gameDetail?.participantIdentities ?? []
    const others = identities.filter((_, i) => i !== selfIndex)
    const everyNamePresent = q.playerNames.every(name =>
      others.some(idn => identityMatches(idn, name))
    )
    if (!everyNamePresent) return false
  }

  return true
}

/**
 * 按查询条件筛选对局(list 意图)
 * @param games - 待筛对局(participants[0] 为被查玩家)
 * @param q - 已校验的查询条件
 */
export function filterGames(games: Game[], q: ParsedMatchQuery): Game[] {
  return games.filter(g => gameMatches(g, q))
}

/**
 * 统计与目标玩家的相遇次数(count_encounters 意图)
 *
 * 只应用时间窗与队列前置过滤(胜负/英雄条件不参与——「碰见几次」与胜负无关),
 * 每局按 identities 判断各目标玩家是否在场,并按同队/对面分计。
 * @returns stats 为分计结果;games 为命中任一目标玩家的对局(供列表展示)
 */
export function countEncounters(
  games: Game[],
  q: ParsedMatchQuery
): { stats: EncounterStats; games: Game[] } {
  const perName: EncounterStats['perName'] = {}
  for (const name of q.playerNames) perName[name] = { ally: 0, enemy: 0 }

  const hitGames: Game[] = []
  for (const game of games) {
    if (!baseFilter(game, q)) continue
    const identities = game.gameDetail?.participantIdentities ?? []
    const { myTeam, selfIndex } = splitTeams(game)
    const myTeamSet = new Set(myTeam)

    let anyHit = false
    for (const name of q.playerNames) {
      const idx = identities.findIndex((idn, i) => i !== selfIndex && identityMatches(idn, name))
      if (idx < 0) continue
      anyHit = true
      if (myTeamSet.has(idx)) perName[name].ally++
      else perName[name].enemy++
    }
    if (anyHit) hitGames.push(game)
  }

  return { stats: { total: hitGames.length, perName }, games: hitGames }
}
