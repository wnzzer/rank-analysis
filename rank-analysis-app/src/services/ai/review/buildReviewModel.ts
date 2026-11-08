/**
 * 赛后复盘仪表盘的视图模型：快照 + 评分 + 时间线 → 各图表组件直接渲染的只读结构。
 *
 * 只读组合已有模块，不新增任何判断逻辑：
 * - 个人卡的等级词/驱动数据/分位来自 toBrief（与喂模型的【表现评估】同源）；
 * - 阵亡责任分档沿用 plainScore.DEATH_PLAIN 的归类（自身问题/部分责任/情有可原），
 *   无责任标注的两类单列为「团战中」「其他」；
 * - 异常小标签只读 S 卡 weight（大招晚点 = 1）与成型装时间（completedBuilds）；
 * - 胜负关键 = winReasonSkeleton，把 [T1]/[F2] 编号换成卡片里的时间（人话版）。
 * 纯函数，同输入同输出。
 */
import type { Game } from '@renderer/types/domain/match'
import { DEATH_PLAIN, type ScoreLevel } from '../matchDetail/plainScore'
import { toBrief, winReasonSkeleton } from '../matchDetail/scoredAttribution'
import type { VerdictLabel } from '../matchDetail/types'
import { baselineQueue } from '../shared/scoring/baseline'
import type { DeathKind } from '../shared/scoring/deathAttribution'
import { DEFAULT_SCORING_DATA, scoreSnapshot } from '../shared/scoring/match'
import type { PlayerScore, ScoringData } from '../shared/scoring/scorePlayers'
import type { SubScoreKey } from '../shared/scoring/weights'
import { buildMatchSnapshot, type MatchSnapshot } from '../shared/snapshot'
import { completedBuilds, medianOrNull } from '../shared/timeline/cards/item'
import { laneOpponent } from '../shared/timeline/cards/lane'
import { fmtTime } from '../shared/timeline/geometry'
import { monsterLabel, sideLabel, zoneOf } from '../shared/timeline/labels'
import type {
  CardInput,
  ItemKind,
  SlimEvent,
  SlimTimeline,
  TimelineCard
} from '../shared/timeline/types'

/** 阵营（固定配色：蓝/红） */
export type Side = 'blue' | 'red'

/** teamId → 阵营（100 = 蓝方，其余按红方，与 sideLabel 一致） */
export const sideOf = (teamId: number): Side => (teamId === 100 ? 'blue' : 'red')

/** 阵亡责任分档（颜色：自身问题红 / 部分黄 / 情有可原绿 / 团战中与其他灰） */
export type Responsibility = 'self' | 'partial' | 'excused' | 'fight' | 'other'

/** 阵亡类型 → 责任分档（与 DEATH_PLAIN 的 tag 一一对应，单测守护） */
export const RESPONSIBILITY_OF: Record<DeathKind, Responsibility> = {
  isolated: 'self',
  solo: 'self',
  ganked: 'partial',
  collapse: 'excused',
  fight: 'fight',
  other: 'other'
}

/** 责任分档中文 */
export const RESPONSIBILITY_CN: Record<Responsibility, string> = {
  self: '自身问题',
  partial: '部分责任',
  excused: '情有可原',
  fight: '团战中',
  other: '其他'
}

/** 责任分档展示顺序 */
export const RESPONSIBILITY_ORDER: Responsibility[] = [
  'self',
  'partial',
  'excused',
  'fight',
  'other'
]

/** 分项水平条的截断范围（单位：基准标准差） */
export const BAR_LIMIT = 3

/** 第一件传说装比参照晚多少分钟算异常 */
export const LATE_ITEM_MINUTES = 2

/** 曲线纵轴的最小半幅（经济差都很小时不把噪声放大成大起伏） */
const MIN_CURVE_RANGE = 1000

/** 阵亡找不到对应击杀事件（无坐标）时的地点文案 */
const UNKNOWN_ZONE = '位置未知'

const LANE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export type LanePosition = (typeof LANE_ORDER)[number]
const LANE_CN: Record<LanePosition, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅'
}

/**
 * 标题行
 * @property winner - 胜方阵营；胜负缺失为 null
 * @property keyReason - 系统生成的胜负关键（无分数、无卡片编号）
 */
export interface ReviewHeader {
  winner: Side | null
  queueName: string
  durationText: string
  kills: { blue: number; red: number }
  keyReason: string
}

/**
 * 对位总览的一行（有分路模式）
 * @property goldDiff14 - 14 分钟对位经济差，以蓝方为正；无时间线为 null
 */
export interface LaneRow {
  position: LanePosition
  posCn: string
  blue: number
  red: number
  goldDiff14: number | null
}

/** 对位总览：有分路按五路成行；无分路（或分路凑不齐）按队伍并列、队内按总分降序 */
export type Matchup =
  | { kind: 'lanes'; rows: LaneRow[] }
  | { kind: 'teams'; teams: Array<{ teamId: number; side: Side; players: number[] }> }

/**
 * 个人卡的一个分项
 * @property value - 分项分（一位小数，只用于画条，不展示数字）
 * @property bar - 截断到 ±BAR_LIMIT 的条长
 * @property stats - 1~2 条驱动该分项的真实数据
 */
export interface ScorePartView {
  key: SubScoreKey
  cn: string
  value: number
  bar: number
  level: ScoreLevel
  stats: string[]
}

/**
 * 一次阵亡
 * @property index - 该玩家阵亡序号（0 起），列表/地图/曲线联动用
 * @property cardId - 对应 D 卡编号（AI 引用定位）；无卡为 null
 * @property x / y - 地图坐标（召唤师峡谷 0~14870）；时间线里找不到对应击杀事件时为 null（地图不画点）
 */
export interface DeathView {
  index: number
  cardId: string | null
  ms: number
  time: string
  zone: string
  killer: string
  assists: string[]
  kind: DeathKind
  kindCn: string
  resp: Responsibility
  x: number | null
  y: number | null
}

/** 一件成型装（传说装或成型鞋） */
export interface ItemMark {
  itemId: number
  name: string
  kind: Exclude<ItemKind, 'other'>
  ms: number
  time: string
}

/**
 * 一名玩家的视图
 * @property rank - 「大约处于同位置玩家的前/后 X%」；本队列无国服基准时为 null
 * @property flags - 异常小标签（大招晚点、第一件传说装偏晚）
 * @property deathList / deathCounts - 无时间线时为 null
 * @property deathSummary - 阵亡归类小结（无时间线时为「阵亡 N 次（无时间线，无法细分）」）
 * @property opponentId - 同分路对位；无分路/缺对位为 null
 */
export interface PlayerView {
  participantId: number
  teamId: number
  side: Side
  name: string
  champion: string
  championId: number
  isMe: boolean
  win: boolean
  kills: number
  deaths: number
  assists: number
  position: string
  roleCn: string
  label: VerdictLabel
  rank: string | null
  parts: ScorePartView[]
  flags: string[]
  deathList: DeathView[] | null
  deathCounts: Record<Responsibility, number> | null
  deathSummary: string
  items: ItemMark[]
  opponentId: number | null
}

/** 经济差曲线上的一点（diff 以蓝方为正） */
export interface CurvePoint {
  minute: number
  diff: number
}

/**
 * 曲线标记：团战（id = F 卡编号，lines = 卡片各段：人头比/参战/缺席/团后资源）或资源（id = O 序号）
 */
export type CurveMarker =
  | { kind: 'fight'; id: string; minute: number; title: string; lines: string[] }
  | {
      kind: 'objective'
      id: string
      minute: number
      side: Side
      /** monsterType，如 DRAGON / BARON_NASHOR / RIFTHERALD / HORDE / ATAKHAN */
      monster: string
      /** monsterSubType，如 FIRE_DRAGON；非龙为空串 */
      subType: string
      title: string
    }

/**
 * 经济差曲线
 * @property maxAbs - 纵轴半幅（≥ MIN_CURVE_RANGE）
 * @property endMinute - 横轴终点（对局时长）
 */
export interface GoldCurve {
  points: CurvePoint[]
  markers: CurveMarker[]
  maxAbs: number
  endMinute: number
}

/**
 * 复盘视图模型
 * @property defaultPid - 默认选中（本人；找不到本人取第一名玩家；无玩家为 null）
 * @property goldCurve - 无时间线为 null
 * @property medianFirstLegendaryMs - 全场第一件传说装中位时刻（无分路的出装对比参照）
 * @property hasBaseline - 本队列是否有国服基准（无则个人卡不显示分位）
 */
export interface ReviewModel {
  header: ReviewHeader
  matchup: Matchup
  players: Record<number, PlayerView>
  defaultPid: number | null
  goldCurve: GoldCurve | null
  medianFirstLegendaryMs: number | null
  durationMs: number
  mapId: number
  hasTimeline: boolean
  hasLanes: boolean
  hasItemBuild: boolean
  hasBaseline: boolean
}

type Kill = Extract<SlimEvent, { type: 'CHAMPION_KILL' }>
type Elite = Extract<SlimEvent, { type: 'ELITE_MONSTER_KILL' }>

function buildHeader(
  snapshot: MatchSnapshot,
  scores: PlayerScore[],
  cards: TimelineCard[]
): ReviewHeader {
  const winnerTeam = snapshot.players.find(p => p.win)?.teamId
  const killsOf = (teamId: number) =>
    snapshot.players.filter(p => p.teamId === teamId).reduce((s, p) => s + p.kills, 0)
  const byId = new Map(cards.map(c => [c.id, c]))
  // 卡片编号对玩家没有意义：换成卡片开头的时间（T 卡「11:00-13:00」，F 卡「6:53」）
  const keyReason = winReasonSkeleton(snapshot, scores).replace(
    /\[([A-Z]\d+)\] /g,
    (_m, id: string) => {
      const card = byId.get(id)
      return card ? `${card.text.split(' ')[0]} ` : ''
    }
  )
  return {
    winner: winnerTeam === undefined ? null : sideOf(winnerTeam),
    queueName: snapshot.queueName || '对局',
    durationText: `${Math.floor(snapshot.durationSeconds / 60)} 分钟`,
    kills: { blue: killsOf(100), red: killsOf(200) },
    keyReason
  }
}

function buildMatchup(snapshot: MatchSnapshot, totals: Map<number, number>): Matchup {
  const players = snapshot.players
  if (snapshot.modeContext.hasLanes) {
    const rows: LaneRow[] = []
    for (const pos of LANE_ORDER) {
      const blue = players.filter(p => p.teamId === 100 && p.teamPosition === pos)
      const red = players.filter(p => p.teamId === 200 && p.teamPosition === pos)
      if (blue.length !== 1 || red.length !== 1) break
      rows.push({
        position: pos,
        posCn: LANE_CN[pos],
        blue: blue[0].participantId,
        red: red[0].participantId,
        goldDiff14: snapshot.timeline?.metrics[blue[0].participantId]?.goldDiff14 ?? null
      })
    }
    if (rows.length === LANE_ORDER.length) return { kind: 'lanes', rows }
  }
  const teamIds = [...new Set(players.map(p => p.teamId))].sort((a, b) => a - b)
  return {
    kind: 'teams',
    teams: teamIds.map(teamId => ({
      teamId,
      side: sideOf(teamId),
      players: players
        .filter(p => p.teamId === teamId)
        .sort(
          (a, b) =>
            (totals.get(b.participantId) ?? 0) - (totals.get(a.participantId) ?? 0) ||
            a.participantId - b.participantId
        )
        .map(p => p.participantId)
    }))
  }
}

function buildItems(input: CardInput | null): Map<number, ItemMark[]> {
  const out = new Map<number, ItemMark[]>()
  if (!input) return out
  for (const [pid, list] of completedBuilds(input)) {
    out.set(
      pid,
      list.map(b => {
        const meta = input.tl.items[String(b.itemId)]
        return {
          itemId: b.itemId,
          name: meta.name,
          kind: meta.kind === 'boots' ? 'boots' : 'legendary',
          ms: b.ts,
          time: fmtTime(b.ts)
        }
      })
    )
  }
  return out
}

/** 各责任分档的阵亡次数（0 次的分档也在） */
function countResponsibility(list: DeathView[]): Record<Responsibility, number> {
  const out: Record<Responsibility, number> = {
    self: 0,
    partial: 0,
    excused: 0,
    fight: 0,
    other: 0
  }
  for (const d of list) out[d.resp]++
  return out
}

const firstLegendaryMs = (items: ItemMark[] | undefined): number | undefined =>
  items?.find(i => i.kind === 'legendary')?.ms

function buildGoldCurve(
  tl: SlimTimeline,
  snapshot: MatchSnapshot,
  cards: TimelineCard[]
): GoldCurve {
  const teamOf = new Map(snapshot.players.map(p => [p.participantId, p.teamId]))
  // 与转折卡同一口径：蓝方总经济 − 红方总经济
  const points = tl.frames.map(f => ({
    minute: f.timestamp / 60000,
    diff: f.players.reduce(
      (s, p) => s + (teamOf.get(p.participantId) === 100 ? p.totalGold : -p.totalGold),
      0
    )
  }))
  const fights: CurveMarker[] = cards
    .filter(c => c.kind === 'fight')
    .map(c => {
      const [title, ...lines] = c.text.split('｜')
      return { kind: 'fight', id: c.id, minute: c.minute, title, lines }
    })
  const objectives: CurveMarker[] = tl.events
    .filter((e): e is Elite => e.type === 'ELITE_MONSTER_KILL')
    .map((e, i) => ({
      kind: 'objective',
      id: `O${i + 1}`,
      minute: e.timestamp / 60000,
      side: sideOf(e.killerTeamId),
      monster: e.monsterType,
      subType: e.monsterSubType,
      title: `${fmtTime(e.timestamp)} ${sideLabel(e.killerTeamId)}拿下${monsterLabel(e.monsterType)}`
    }))
  const last = points[points.length - 1]
  return {
    points,
    markers: [...fights, ...objectives].sort((a, b) => a.minute - b.minute),
    maxAbs: Math.max(MIN_CURVE_RANGE, ...points.map(p => Math.abs(p.diff))),
    endMinute: Math.max(snapshot.durationSeconds / 60, last?.minute ?? 0)
  }
}

/**
 * 组装复盘视图模型。
 * @param snapshot - buildMatchSnapshot(game, _, timeline) 的结果
 * @param scores - scoreSnapshot(snapshot, data) 的结果（顺序不限）
 * @param timeline - 与 snapshot 同一份时间线；无为 null
 * @param data - 基准与阈值（与 scores 同一份；默认入库数据）
 */
export function buildReviewModel(
  snapshot: MatchSnapshot,
  scores: PlayerScore[],
  timeline: SlimTimeline | null,
  data: ScoringData = DEFAULT_SCORING_DATA
): ReviewModel {
  const { hasLanes, hasItemBuild } = snapshot.modeContext
  const cards = snapshot.timeline?.cards ?? []
  const deathCards = cards.filter(c => c.kind === 'death')
  const fightCards = cards.filter(c => c.kind === 'fight')
  const skillLate = new Set(
    cards.filter(c => c.kind === 'skill' && c.weight === 1).map(c => c.subjects[0])
  )
  const hasTimeline = !!snapshot.timeline && timeline !== null
  const input: CardInput | null =
    hasTimeline && timeline
      ? { tl: timeline, roster: snapshot.players, hasLanes, hasItemBuild, mapId: snapshot.mapId }
      : null
  const kills = (timeline?.events ?? []).filter((e): e is Kill => e.type === 'CHAMPION_KILL')
  const items = buildItems(input)
  const median = medianOrNull(
    [...items.values()].flatMap(list => {
      const ms = firstLegendaryMs(list)
      return ms === undefined ? [] : [ms]
    })
  )
  const hasBaseline = baselineQueue(snapshot.queueId) !== null
  const byId = new Map(snapshot.players.map(p => [p.participantId, p]))
  const champ = (pid: number): string | undefined => byId.get(pid)?.champion

  const players: Record<number, PlayerView> = {}
  for (const s of scores) {
    const p = byId.get(s.participantId)
    if (!p) continue
    const brief = toBrief(s, p, snapshot, data, deathCards, fightCards)
    const opp = hasLanes ? laneOpponent(snapshot.players, p.participantId) : undefined
    const mine = items.get(p.participantId) ?? []

    const flags: string[] = []
    if (skillLate.has(p.participantId)) flags.push('大招晚点')
    const firstMine = firstLegendaryMs(mine)
    const refMs = hasLanes
      ? opp && firstLegendaryMs(items.get(opp.participantId))
      : (median ?? undefined)
    if (firstMine !== undefined && refMs !== undefined) {
      const gap = (firstMine - refMs) / 60000
      if (gap >= LATE_ITEM_MINUTES)
        flags.push(`第一件传说装比${hasLanes ? '对位' : '全场中位'}晚 ${gap.toFixed(1)} 分钟`)
    }

    const deathList: DeathView[] | null =
      input && s.deaths
        ? s.deaths.map((d, index) => {
            const e = kills.find(k => k.victimId === d.victimId && k.timestamp === d.timestamp)
            // 无对应击杀事件：坐标未知，不能拿 0,0 冒充（会落在蓝方基地）
            const x = e ? e.x : null
            const y = e ? e.y : null
            return {
              index,
              cardId: brief.deaths?.[index]?.cardId ?? null,
              ms: d.timestamp,
              time: fmtTime(d.timestamp),
              zone: x !== null && y !== null ? zoneOf(x, y, snapshot.mapId) : UNKNOWN_ZONE,
              killer: (e && champ(e.killerId)) ?? '防御塔/小兵',
              assists: (e?.assisting ?? []).flatMap(id => {
                const n = champ(id)
                return n ? [n] : []
              }),
              kind: d.kind,
              kindCn: DEATH_PLAIN[d.kind].name,
              resp: RESPONSIBILITY_OF[d.kind],
              x,
              y
            }
          })
        : null

    players[p.participantId] = {
      participantId: p.participantId,
      teamId: p.teamId,
      side: sideOf(p.teamId),
      name: p.name,
      champion: p.champion,
      championId: p.championId,
      isMe: p.isMe,
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      position: p.teamPosition,
      roleCn: brief.role,
      label: s.label,
      rank: hasBaseline ? brief.rank : null,
      parts: brief.parts.map(x => ({
        // toBrief 只产出 SUB_SCORE_KEYS 里的键（ScorePart.key 声明为 string 是给 prompt 层留的宽类型）
        key: x.key as SubScoreKey,
        cn: x.cn,
        value: x.value,
        bar: Math.max(-BAR_LIMIT, Math.min(BAR_LIMIT, x.value)),
        level: x.level,
        stats: x.stats
      })),
      flags,
      deathList,
      deathCounts: deathList ? countResponsibility(deathList) : null,
      deathSummary: brief.deathSummary,
      items: mine,
      opponentId: opp?.participantId ?? null
    }
  }

  const me = snapshot.players.find(p => p.isMe) ?? snapshot.players[0]
  return {
    header: buildHeader(snapshot, scores, cards),
    matchup: buildMatchup(snapshot, new Map(scores.map(s => [s.participantId, s.total]))),
    players,
    defaultPid: me?.participantId ?? null,
    goldCurve: input && timeline ? buildGoldCurve(timeline, snapshot, cards) : null,
    medianFirstLegendaryMs: median,
    durationMs: snapshot.durationSeconds * 1000,
    mapId: snapshot.mapId,
    hasTimeline,
    hasLanes,
    hasItemBuild,
    hasBaseline
  }
}

/**
 * 便捷入口：对局 + 时间线 → 视图模型（快照与评分在内部构建）。
 * 调用前应已 loadChampionNames()，否则英雄名为「英雄N」占位。
 */
export function reviewModelFromGame(
  game: Game,
  timeline: SlimTimeline | null,
  data: ScoringData = DEFAULT_SCORING_DATA
): ReviewModel {
  const snapshot = buildMatchSnapshot(game, undefined, timeline)
  return buildReviewModel(snapshot, scoreSnapshot(snapshot, data), timeline, data)
}
