/**
 * 对局中实时数据的确定性聚合（D-P2 对局中 tab 的事实来源）。
 *
 * 原则：AI 只做解释层——装备匹配/经济差/团战/死亡模式全部由代码确定性计算，
 * prompt 只能引用这些数字，不得改写。聚合是纯函数，便于单测；取数与推荐
 * （getBuildStats）在 composable/页面层完成。
 */

import { WARD_ITEM_IDS } from '@renderer/components/record/tabs/detailsTable'
import type { BuildStats, ItemStat } from './builds'
import type { LiveEvent, LiveGameSnapshot, LiveItem, LivePlayer } from './liveGame'

/**
 * PUGG 出装统计 → 推荐序列（7 槽各取第一名；无数据返回 null）。
 *
 * 出装诊断只比「7 槽第一」——副选项是玩家风格偏好，不该拿来判"没出推荐装"。
 */
export function recommendedItemsOf(stats: BuildStats | null): (ItemStat | null)[] | null {
  if (!stats) return null
  return stats.items.map(slot => slot[0] ?? null)
}

/** 召唤师名匹配（liveclientdata 的 summonerName 大小写与 LCU 可能不一致） */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 我方召唤师在快照中的玩家与阵营；找不到（对局刚加载/名字不匹配）时 null */
export function myPlayer(
  snapshot: LiveGameSnapshot,
  myGameName: string
): { player: LivePlayer; side: 'ORDER' | 'CHAOS' } | null {
  for (const player of snapshot.players) {
    if (sameName(player.summonerName, myGameName)) {
      return { player, side: player.team === 'ORDER' ? 'ORDER' : 'CHAOS' }
    }
  }
  return null
}

export function playersOf(snapshot: LiveGameSnapshot, side: string): LivePlayer[] {
  return snapshot.players.filter(p => p.team === side)
}

export function teamGold(snapshot: LiveGameSnapshot, side: string): number {
  return playersOf(snapshot, side).reduce((acc, p) => acc + (p.gold?.total ?? 0), 0)
}

export interface GoldGap {
  mySide: 'ORDER' | 'CHAOS'
  myTeamGold: number
  enemyTeamGold: number
  /** 我方相对敌方的经济差百分比（1 位小数；敌方 0 经济时为 null） */
  diffPct: number | null
}

/** 双方总经济对比（含 0 玩家时的降级）。 */
export function goldGap(snapshot: LiveGameSnapshot, myGameName: string): GoldGap | null {
  const me = myPlayer(snapshot, myGameName)
  if (!me) return null
  const enemySide = me.side === 'ORDER' ? 'CHAOS' : 'ORDER'
  const myTeamGold = teamGold(snapshot, me.side)
  const enemyTeamGold = teamGold(snapshot, enemySide)
  const diffPct =
    enemyTeamGold > 0
      ? Math.round(((myTeamGold - enemyTeamGold) / enemyTeamGold) * 1000) / 10
      : null
  return { mySide: me.side, myTeamGold, enemyTeamGold, diffPct }
}

/** 剔除饰品后的主装备（槽位序 = 快照顺序）。 */
export function mainItems(player: LivePlayer): LiveItem[] {
  return player.items.filter(i => !WARD_ITEM_IDS.has(i.itemID))
}

export interface BuildMatch {
  /** 已出主装备中命中推荐的件数 */
  matched: number
  /** 已出主装备件数（剔除饰品） */
  total: number
  /** 推荐前 N 件里还没出的（按槽位序，去重）——「缺了关键装」 */
  missing: ItemStat[]
}

/**
 * 出装对比：实际主装备 vs PUGG 推荐（7 槽位第一名）。
 *
 * 只对比「已出件数」对应的前 N 个推荐槽——玩家才 3 件装时不会把第 6 槽推荐
 * 判为"缺装"。缺失列表按槽位序取，去重。
 */
export function buildMatch(actual: LiveItem[], recommended: (ItemStat | null)[]): BuildMatch {
  const builtIds = new Set(actual.filter(i => !WARD_ITEM_IDS.has(i.itemID)).map(i => i.itemID))
  const builtCount = builtIds.size
  const recommendedTop = recommended.slice(0, builtCount)
  const matched = recommendedTop.filter(slot => slot && builtIds.has(slot.itemId)).length
  const missing: ItemStat[] = []
  const seen = new Set<number>()
  for (const slot of recommendedTop) {
    if (slot && !builtIds.has(slot.itemId) && !seen.has(slot.itemId)) {
      seen.add(slot.itemId)
      missing.push(slot)
    }
  }
  return { matched, total: builtCount, missing }
}

export interface TeamfightCluster {
  /** 团战起始时刻（秒） */
  timeSecs: number
  /** 团战死亡总数（双方合计） */
  deaths: number
  /** 其中我方死亡数 */
  myDeaths: number
}

export interface ClusterOptions {
  /** 团战判定窗口（秒），默认 45 */
  windowSecs?: number
  /** 至少多少死亡才算团战，默认 3 */
  minDeaths?: number
}

/**
 * 团战时间点检测：ChampionKill 事件按时间贪婪聚类，窗口内死亡数达到阈值即一团。
 *
 * 从事件流取「击杀=某人死亡」的语义：VictimName 即死亡者。
 */
export function teamfightClusters(
  events: LiveEvent[],
  myGameName: string,
  options: ClusterOptions = {}
): TeamfightCluster[] {
  const windowSecs = options.windowSecs ?? 45
  const minDeaths = options.minDeaths ?? 3
  const deaths = events
    .filter(e => e.eventName === 'ChampionKill' && e.eventTime > 0)
    .sort((a, b) => a.eventTime - b.eventTime)

  const clusters: TeamfightCluster[] = []
  let current: { timeSecs: number; deaths: number; myDeaths: number } | null = null
  for (const d of deaths) {
    if (!current || d.eventTime - current.timeSecs > windowSecs) {
      if (current && current.deaths >= minDeaths) {
        clusters.push(current)
      }
      current = { timeSecs: d.eventTime, deaths: 0, myDeaths: 0 }
    }
    current.deaths += 1
    if (sameName(d.victimName, myGameName)) {
      current.myDeaths += 1
    }
  }
  if (current && current.deaths >= minDeaths) {
    clusters.push(current)
  }
  return clusters
}

export interface MyDeath {
  timeSecs: number
  killer: string
  assisters: string[]
}

/** 我方所有死亡事件（victim = 我），按时间升序。 */
export function myDeaths(events: LiveEvent[], myGameName: string): MyDeath[] {
  return events
    .filter(e => e.eventName === 'ChampionKill' && sameName(e.victimName, myGameName))
    .sort((a, b) => a.eventTime - b.eventTime)
    .map(e => ({
      timeSecs: e.eventTime,
      killer: e.killerName,
      assisters: e.assisters ?? []
    }))
}

/** 秒 → mm:ss（分/秒都补零两位）。 */
export function formatGameClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 团战时间点文案：`08:12 一波（双方共 4 死，我方 1）` */
export function clusterLine(cluster: TeamfightCluster): string {
  const my = cluster.myDeaths > 0 ? `，我方 ${cluster.myDeaths}` : ''
  return `${formatGameClock(cluster.timeSecs)} 一波（双方共 ${cluster.deaths} 死${my}）`
}

/** 我方死亡事件文案：`04:33 被 XXX 击杀（+2 助攻）` */
export function deathLine(d: MyDeath): string {
  const assists = d.assisters.length > 0 ? `（+${d.assisters.length} 助攻）` : ''
  return `${formatGameClock(d.timeSecs)} 被 ${d.killer || '未知'} 击杀${assists}`
}

export interface LiveIntelOptions {
  /** 团战/死亡最多列出的条数，默认 3（取最近的） */
  maxItems?: number
}

/**
 * 生成确定性事实块（供对局中 prompt 引用）。
 *
 * 只输出代码能算出的数字：经济差、我的状态、出装匹配、团战、死亡记录。
 * 无对应数据（快照里没有我 / 无推荐）时不写该行——宁缺毋滥，禁止编造。
 */
export function liveIntelText(
  snapshot: LiveGameSnapshot,
  myGameName: string,
  recommendedItems: (ItemStat | null)[] | null,
  options: LiveIntelOptions = {}
): string {
  const maxItems = options.maxItems ?? 3
  const lines: string[] = []

  const me = myPlayer(snapshot, myGameName)
  const gap = me ? goldGap(snapshot, myGameName) : null
  if (gap) {
    const dir =
      gap.diffPct === null
        ? '双方经济持平（敌方 0 经济）'
        : gap.diffPct > 0
          ? `我方领先 ${gap.diffPct}%`
          : `我方落后 ${Math.abs(gap.diffPct)}%`
    lines.push(
      `经济：我方（${gap.mySide}）${gap.myTeamGold} vs 敌方 ${gap.enemyTeamGold}（${dir}）`
    )
  }

  if (me) {
    const p = me.player
    const s = p.scores ?? { assists: 0, creepScore: 0, deaths: 0, kills: 0, wardScore: 0 }
    const state = p.isDead ? '（阵亡中）' : '（存活）'
    let status = `我：${p.championName}（${p.position}）Lv${p.level}，${s.kills}/${s.deaths}/${s.assists} KDA，补刀 ${s.creepScore}${state}`
    const match = recommendedItems ? buildMatch(p.items, recommendedItems) : null
    if (match && match.total > 0) {
      status += `；出装 ${match.matched}/${match.total} 件匹配推荐${
        match.missing.length > 0 ? `，未出推荐 ${match.missing.length} 件` : ''
      }`
    }
    lines.push(status)
  }

  const clusters = me ? teamfightClusters(snapshot.events, myGameName) : []
  if (clusters.length > 0) {
    lines.push(`团战时间点：${clusters.slice(-maxItems).map(clusterLine).join('；')}`)
  }

  const deaths = me ? myDeaths(snapshot.events, myGameName) : []
  if (deaths.length > 0) {
    lines.push(`我的死亡：${deaths.slice(-maxItems).map(deathLine).join('；')}`)
  }

  if (lines.length === 0) return ''
  return `【对局实时数据（确定性计算，只可引用）】\n${lines.join('\n')}`
}
