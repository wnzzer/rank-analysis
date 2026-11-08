/**
 * 团战卡（F）：把 20 秒内、2500 码内的连续击杀聚成一场团战（≥3 个击杀才算），
 * 记录时间、区域、人头交换、参战/缺席名单（帧插值近似）与团后 90 秒的资源。
 */
import { dist, fmtTime, positionAt } from '../geometry'
import { buildingLabel, monsterLabel, sideLabel, zoneOf } from '../labels'
import type { CardDraft, CardInput, SlimEvent } from '../types'

type Kill = Extract<SlimEvent, { type: 'CHAMPION_KILL' }>

/** 聚类后的团战 */
export interface Fight {
  start: number
  end: number
  /** 击杀坐标质心 */
  x: number
  y: number
  kills: Kill[]
}

const CHAIN_GAP_MS = 20000
const FIGHT_RADIUS = 2500
const MIN_KILLS = 3
const AFTERMATH_MS = 90000

/**
 * 击杀聚类（时间链式 + 质心距离）。
 * @returns 击杀数 ≥3 的团战，按时间升序
 */
export function clusterFights(input: CardInput): Fight[] {
  const kills = input.tl.events.filter((e): e is Kill => e.type === 'CHAMPION_KILL')
  const fights: Fight[] = []
  let cur: Kill[] = []
  const centroid = (ks: Kill[]) => ({
    x: ks.reduce((s, k) => s + k.x, 0) / ks.length,
    y: ks.reduce((s, k) => s + k.y, 0) / ks.length
  })
  const flush = () => {
    if (cur.length >= MIN_KILLS) {
      const c = centroid(cur)
      fights.push({
        start: cur[0].timestamp,
        end: cur[cur.length - 1].timestamp,
        x: c.x,
        y: c.y,
        kills: cur
      })
    }
    cur = []
  }
  for (const k of kills) {
    if (cur.length) {
      const c = centroid(cur)
      const last = cur[cur.length - 1]
      if (k.timestamp - last.timestamp > CHAIN_GAP_MS || dist(k.x, k.y, c.x, c.y) > FIGHT_RADIUS)
        flush()
    }
    cur.push(k)
  }
  flush()
  return fights
}

/**
 * 参战名单（近似）：参与任一击杀的人 + 团战开始时距质心 ≤2500 码的人（帧插值）。
 * @returns 名册中参战玩家的 participantId 集合
 */
export function fightPresence(input: CardInput, f: Fight): Set<number> {
  const involved = new Set<number>()
  for (const k of f.kills) [k.killerId, k.victimId, ...k.assisting].forEach(id => involved.add(id))
  return new Set(
    input.roster
      .filter(r => {
        if (involved.has(r.participantId)) return true
        const p = positionAt(input.tl, r.participantId, f.start)
        return !!p && dist(p.x, p.y, f.x, f.y) <= FIGHT_RADIUS
      })
      .map(r => r.participantId)
  )
}

/**
 * 生成团战卡。
 * @returns weight = 击杀数 + 团后资源数 × 2
 */
export function buildFightCards(input: CardInput): CardDraft[] {
  const { tl, roster, mapId } = input
  const byId = new Map(roster.map(r => [r.participantId, r]))
  return clusterFights(input).map(f => {
    const presentSet = fightPresence(input, f)
    const present = [...presentSet].sort((a, b) => a - b)
    const names = (team: number, inFight: boolean) =>
      roster
        .filter(r => r.teamId === team && presentSet.has(r.participantId) === inFight)
        .map(r => r.champion)
        .join('、') || '无'

    const blueKills = f.kills.filter(k => byId.get(k.victimId)?.teamId === 200).length
    const redKills = f.kills.filter(k => byId.get(k.victimId)?.teamId === 100).length

    const after: string[] = []
    for (const e of tl.events) {
      if (e.timestamp <= f.end || e.timestamp > f.end + AFTERMATH_MS) continue
      if (e.type === 'ELITE_MONSTER_KILL')
        after.push(`${sideLabel(e.killerTeamId)}拿下${monsterLabel(e.monsterType)}`)
      if (e.type === 'BUILDING_KILL') {
        after.push(
          `${sideLabel(e.teamId === 100 ? 200 : 100)}推掉${sideLabel(e.teamId)}${buildingLabel(e)}`
        )
      }
    }

    return {
      kind: 'fight' as const,
      subjects: present,
      minute: f.start / 60000,
      weight: f.kills.length + after.length * 2,
      text:
        `${fmtTime(f.start)} ${zoneOf(Math.round(f.x), Math.round(f.y), mapId)}团战（${Math.round((f.end - f.start) / 1000)} 秒）` +
        `｜人头 蓝方${blueKills}:${redKills}红方` +
        `｜参战（约）：蓝方 ${names(100, true)} / 红方 ${names(200, true)}` +
        `｜缺席（约）：蓝方 ${names(100, false)} / 红方 ${names(200, false)}` +
        `｜团后 90 秒：${after.join('、') || '无资源变动'}`
    }
  })
}
