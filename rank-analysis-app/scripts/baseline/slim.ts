/**
 * Rust `lcu::api::timeline::slim_from_raw` 的 TS 移植，仅供基准构建脚本使用
 * （语料是 SGP 原始 DETAILS，构建在 node 里跑，不经 Tauri）。
 *
 * 与 Rust 的差异：不带物品表，`items` 恒为 {}（评分不用出装）。
 * 其余字段逐一对齐，由 __tests__/slim.spec.ts 对拍 Rust 输出保证。
 */
import type {
  DamageSource,
  SlimEvent,
  SlimFrame,
  SlimPlayerFrame,
  SlimTimeline
} from '../../src/services/ai/shared/timeline/types'

interface RawPosition {
  x?: number
  y?: number
}

interface RawDamage {
  participantId?: number
  magicDamage?: number
  physicalDamage?: number
  trueDamage?: number
  spellSlot?: number
}

interface RawEvent {
  type?: string
  timestamp?: number
  participantId?: number
  killerId?: number
  victimId?: number
  assistingParticipantIds?: number[]
  position?: RawPosition
  bounty?: number
  shutdownBounty?: number
  victimDamageReceived?: RawDamage[]
  itemId?: number
  beforeId?: number
  afterId?: number
  skillSlot?: number
  levelUpType?: string
  creatorId?: number
  wardType?: string
  monsterType?: string
  monsterSubType?: string
  killerTeamId?: number
  buildingType?: string
  towerType?: string
  laneType?: string
  teamId?: number
  killType?: string
  winningTeam?: number
}

interface RawParticipantFrame {
  participantId: number
  totalGold?: number
  xp?: number
  level?: number
  minionsKilled?: number
  jungleMinionsKilled?: number
  position?: RawPosition
  damageStats?: { totalDamageDoneToChampions?: number }
}

interface RawFrame {
  timestamp?: number
  participantFrames?: Record<string, RawParticipantFrame>
  events?: RawEvent[]
}

/** SGP DETAILS 的 `json` 部分（只声明用到的字段） */
export interface RawDetailsJson {
  gameId?: number
  frameInterval?: number
  frames?: RawFrame[]
  participants?: Array<{ participantId: number; puuid?: string }>
}

const n = (v: number | undefined): number => v ?? 0
const s = (v: string | undefined): string => v ?? ''

/**
 * 受害者承受伤害按来源聚合：剔除 participantId ≤ 0，按总伤害降序（并列保持 participantId 升序）。
 * topSlot 对齐 Rust：槽位升序遍历 + max_by_key（并列取最后一个）→ 并列时取槽位号大的。
 */
function aggregateDamage(list: RawDamage[]): DamageSource[] {
  const by = new Map<number, { total: number; slots: Map<number, number> }>()
  for (const d of list) {
    const pid = n(d.participantId)
    if (pid <= 0) continue
    const total = n(d.magicDamage) + n(d.physicalDamage) + n(d.trueDamage)
    const entry = by.get(pid) ?? { total: 0, slots: new Map<number, number>() }
    entry.total += total
    const slot = n(d.spellSlot)
    entry.slots.set(slot, (entry.slots.get(slot) ?? 0) + total)
    by.set(pid, entry)
  }
  const out = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([participantId, e]) => {
      let topSlot = -1
      let best = -Infinity
      for (const [slot, v] of [...e.slots.entries()].sort((a, b) => a[0] - b[0])) {
        if (v >= best) {
          best = v
          topSlot = slot
        }
      }
      return { participantId, total: e.total, topSlot }
    })
  return out.sort((a, b) => b.total - a.total)
}

/** 单个原始事件 → 裁剪事件；不保留的类型返回 null */
function convertEvent(e: RawEvent): SlimEvent | null {
  const timestamp = n(e.timestamp)
  const x = n(e.position?.x)
  const y = n(e.position?.y)
  switch (e.type) {
    case 'CHAMPION_KILL':
      return {
        type: 'CHAMPION_KILL',
        timestamp,
        killerId: n(e.killerId),
        victimId: n(e.victimId),
        assisting: e.assistingParticipantIds ?? [],
        x,
        y,
        bounty: n(e.bounty),
        shutdownBounty: n(e.shutdownBounty),
        damageReceived: aggregateDamage(e.victimDamageReceived ?? [])
      }
    case 'CHAMPION_SPECIAL_KILL':
      return {
        type: 'CHAMPION_SPECIAL_KILL',
        timestamp,
        killerId: n(e.killerId),
        killType: s(e.killType)
      }
    case 'ELITE_MONSTER_KILL':
      return {
        type: 'ELITE_MONSTER_KILL',
        timestamp,
        killerId: n(e.killerId),
        killerTeamId: n(e.killerTeamId),
        monsterType: s(e.monsterType),
        monsterSubType: s(e.monsterSubType),
        x,
        y
      }
    case 'BUILDING_KILL':
      return {
        type: 'BUILDING_KILL',
        timestamp,
        killerId: n(e.killerId),
        teamId: n(e.teamId),
        buildingType: s(e.buildingType),
        towerType: s(e.towerType),
        laneType: s(e.laneType)
      }
    case 'TURRET_PLATE_DESTROYED':
      return {
        type: 'TURRET_PLATE_DESTROYED',
        timestamp,
        killerId: n(e.killerId),
        teamId: n(e.teamId),
        laneType: s(e.laneType)
      }
    case 'ITEM_PURCHASED':
    case 'ITEM_SOLD':
      return {
        type: e.type as 'ITEM_PURCHASED' | 'ITEM_SOLD',
        timestamp,
        participantId: n(e.participantId),
        itemId: n(e.itemId)
      }
    case 'ITEM_UNDO':
      return {
        type: 'ITEM_UNDO',
        timestamp,
        participantId: n(e.participantId),
        beforeId: n(e.beforeId),
        afterId: n(e.afterId)
      }
    case 'SKILL_LEVEL_UP':
      return {
        type: 'SKILL_LEVEL_UP',
        timestamp,
        participantId: n(e.participantId),
        skillSlot: n(e.skillSlot),
        levelUpType: s(e.levelUpType)
      }
    case 'WARD_PLACED':
      return { type: 'WARD_PLACED', timestamp, creatorId: n(e.creatorId), wardType: s(e.wardType) }
    case 'WARD_KILL':
      return { type: 'WARD_KILL', timestamp, killerId: n(e.killerId), wardType: s(e.wardType) }
    case 'GAME_END':
      return { type: 'GAME_END', timestamp, winningTeam: n(e.winningTeam) }
    default:
      return null
  }
}

/**
 * 原始 DETAILS → 裁剪时间线（与 Rust 同形，items 恒空）。
 * @param raw - DETAILS 响应的 `json` 部分
 */
export function slimFromDetails(raw: RawDetailsJson): SlimTimeline {
  const frames: SlimFrame[] = []
  const events: SlimEvent[] = []
  for (const f of raw.frames ?? []) {
    const players: SlimPlayerFrame[] = Object.values(f.participantFrames ?? {})
      .map(p => ({
        participantId: p.participantId,
        totalGold: n(p.totalGold),
        xp: n(p.xp),
        level: n(p.level),
        cs: n(p.minionsKilled) + n(p.jungleMinionsKilled),
        jungleCs: n(p.jungleMinionsKilled),
        x: n(p.position?.x),
        y: n(p.position?.y),
        damageToChampions: n(p.damageStats?.totalDamageDoneToChampions)
      }))
      .sort((a, b) => a.participantId - b.participantId)
    frames.push({ timestamp: n(f.timestamp), players })
    for (const e of f.events ?? []) {
      const slim = convertEvent(e)
      if (slim) events.push(slim)
    }
  }
  events.sort((a, b) => a.timestamp - b.timestamp)
  return {
    gameId: n(raw.gameId),
    frameIntervalMs: n(raw.frameInterval),
    participants: (raw.participants ?? []).map(p => ({
      participantId: p.participantId,
      puuid: s(p.puuid),
      // DETAILS 不带分路；与 Rust 一致留空（真实分路由 SUMMARY 回填，构建脚本直接读 SUMMARY）
      teamPosition: ''
    })),
    frames,
    events,
    items: {}
  }
}
