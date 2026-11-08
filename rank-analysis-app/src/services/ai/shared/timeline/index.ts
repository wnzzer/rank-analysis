/**
 * 时间线事实卡片入口：汇总各提取器、统一编号、选卡、渲染成 prompt 行、被针对资格判定。
 *
 * 编号规则：同类卡片按时间升序编号（D1、D2…），前缀见 PREFIX。
 * 选卡规则（spec §2）：整局 = 全部 T、F + 每位玩家按 weight 取前 1 张自有卡；
 * 单人 = 该玩家全部自有卡 + 全部 T + F。两种模式的 F 都只留 weight 最高的前 8 张（同权重取更早的）。
 */
import { extractNumbers } from '../../matchDetail/postprocess'
import { buildDeathCards } from './cards/death'
import { buildFightCards } from './cards/fight'
import { buildItemCards } from './cards/item'
import { buildLaneCards } from './cards/lane'
import { buildSkillCards } from './cards/skill'
import { buildTurnCards } from './cards/turn'
import { buildVisionCards } from './cards/vision'
import type { CardDraft, CardInput, CardKind, TimelineCard } from './types'

export type * from './types'
export { buildTeamContext, type PlayerTeamContext } from './teamContext'

const PREFIX: Record<CardKind, string> = {
  lane: 'L',
  death: 'D',
  item: 'I',
  skill: 'S',
  vision: 'V',
  fight: 'F',
  turn: 'T'
}

/** 卡片引用标记，如 [D3] */
export const CITATION_RE = /\[([LDISVFT]\d+)\]/g

/** 团队级卡片（无"主人"） */
const TEAM_KINDS = new Set<CardKind>(['fight', 'turn'])
const OVERVIEW_PER_PLAYER = 1
const MAX_FIGHT_CARDS = 8

/**
 * 从时间线生成全部事实卡片。
 * @returns 按 minute 升序；每张带 id 与 numbers
 */
export function buildTimelineCards(input: CardInput): TimelineCard[] {
  const drafts: CardDraft[] = [
    ...buildTurnCards(input),
    ...buildFightCards(input),
    ...buildDeathCards(input),
    ...buildItemCards(input),
    ...buildSkillCards(input),
    ...buildLaneCards(input),
    ...buildVisionCards(input)
  ]
  const counters = new Map<CardKind, number>()
  return drafts
    .map((d, order) => ({ d, order }))
    .sort((a, b) => a.d.minute - b.d.minute || a.order - b.order)
    .map(({ d }) => {
      const n = (counters.get(d.kind) ?? 0) + 1
      counters.set(d.kind, n)
      return { ...d, id: `${PREFIX[d.kind]}${n}`, numbers: [...extractNumbers(d.text)] }
    })
}

/** weight 最高的前 N 张团战卡 id（同权重取更早的，cards 本身按时间升序） */
function topFightIds(cards: TimelineCard[]): Set<string> {
  return new Set(
    cards
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === 'fight')
      .sort((a, b) => b.c.weight - a.c.weight || a.i - b.i)
      .slice(0, MAX_FIGHT_CARDS)
      .map(({ c }) => c.id)
  )
}

/**
 * 按复盘模式挑卡。
 * @param opts.mode - overview 整局 / player 单人（需 participantId）
 */
export function selectCards(
  cards: TimelineCard[],
  opts: { mode: 'overview' | 'player'; participantId?: number }
): TimelineCard[] {
  if (opts.mode === 'player' && opts.participantId != null) {
    const pid = opts.participantId
    const fights = topFightIds(cards)
    return cards.filter(
      c =>
        c.kind === 'turn' ||
        (c.kind === 'fight' && fights.has(c.id)) ||
        (!TEAM_KINDS.has(c.kind) && c.subjects[0] === pid)
    )
  }
  const fights = topFightIds(cards)
  const keep = new Set<string>(
    cards.filter(c => c.kind === 'turn' || fights.has(c.id)).map(c => c.id)
  )
  const byOwner = new Map<number, TimelineCard[]>()
  for (const c of cards) {
    if (TEAM_KINDS.has(c.kind) || c.subjects.length === 0) continue
    const list = byOwner.get(c.subjects[0]) ?? []
    list.push(c)
    byOwner.set(c.subjects[0], list)
  }
  for (const list of byOwner.values()) {
    ;[...list]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, OVERVIEW_PER_PLAYER)
      .forEach(c => keep.add(c.id))
  }
  return cards.filter(c => keep.has(c.id))
}

/**
 * 模型实际看到的卡片（单次模型调用，无 Stage 1）。
 * - overview：整局选卡；
 * - player：该玩家的单人选卡 ∪ winReason 文本里引用到的卡片（winReason 随输入 JSON 进 prompt）。
 * 引用校验与角标只认这个集合——全量卡片里存在但 prompt 没给的编号是模型猜的。
 * @param cards - 全部卡片（buildTimelineCards 的结果）
 * @param mode - 复盘模式；player 需 participantId，缺省时退化为整局
 * @param participantId - 目标玩家
 * @param winReason - 归因骨架的 winReason；其中 `[T1]`/`[F2]` 形式的编号视为模型可见
 * @returns 按 cards 原顺序（时间升序）去重后的集合
 */
export function visibleCards(
  cards: TimelineCard[],
  mode: 'overview' | 'player',
  participantId?: number,
  winReason?: string
): TimelineCard[] {
  if (mode !== 'player' || participantId == null) {
    const ids = new Set(selectCards(cards, { mode: 'overview' }).map(c => c.id))
    return cards.filter(c => ids.has(c.id))
  }
  const ids = new Set(selectCards(cards, { mode: 'player', participantId }).map(c => c.id))
  for (const m of winReason?.matchAll(/\[([A-Z]\d+)\]/g) ?? []) ids.add(m[1])
  return cards.filter(c => ids.has(c.id))
}

/** 渲染成 prompt 行：`[D3] 文本` */
export function renderCardLines(cards: TimelineCard[]): string {
  return cards.map(c => `[${c.id}] ${c.text}`).join('\n')
}

/**
 * "被针对"资格：该玩家至少 3 次阵亡，且 ≥60% 的阵亡有 ≥3 名敌方参与。
 * 仅对有分路的模式成立：大乱斗类模式绝大多数击杀本就是多人团战，按此口径几乎人人达标。
 * @param cards - 全部卡片（不是选过的）
 * @param hasLanes - snapshot.modeContext.hasLanes；false 时恒不成立
 */
export function isTargetedEligible(
  cards: TimelineCard[],
  participantId: number,
  hasLanes: boolean
): boolean {
  if (!hasLanes) return false
  const deaths = cards.filter(c => c.kind === 'death' && c.subjects[0] === participantId)
  if (deaths.length < 3) return false
  const ganked = deaths.filter(c => c.subjects.length - 1 >= 3).length
  return ganked / deaths.length >= 0.6
}
