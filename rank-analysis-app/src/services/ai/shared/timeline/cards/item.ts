/**
 * 出装卡（I）：每位玩家的成型装（传说装 + 成型鞋）时间线（剔除被撤销的购买），
 * 第一件传说装与对位（有分路）或全场中位数（无分路）的时间差，以及卖出的传说装。
 */
import { fmtTime } from '../geometry'
import type { CardDraft, CardInput } from '../types'
import { laneOpponent } from './lane'

/**
 * 一条保留下来的购买记录
 * @property ts - 购买时刻（毫秒）
 */
export interface ItemBuy {
  itemId: number
  ts: number
}

type Buy = ItemBuy

/** 删除列表中最近一条同物品记录（撤销只回滚最后一次操作） */
function removeLatest<T extends { itemId: number }>(list: T[], itemId: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].itemId === itemId) {
      list.splice(i, 1)
      return
    }
  }
}

/**
 * 按玩家回放购买与撤销，返回最终保留的购买记录（时间升序）。
 * 撤销购买为 beforeId=物品、afterId=0。
 */
function resolvePurchases(input: CardInput): Map<number, Buy[]> {
  const out = new Map<number, Buy[]>()
  for (const e of input.tl.events) {
    if (e.type === 'ITEM_PURCHASED') {
      const list = out.get(e.participantId) ?? []
      list.push({ itemId: e.itemId, ts: e.timestamp })
      out.set(e.participantId, list)
    } else if (e.type === 'ITEM_UNDO' && e.beforeId > 0 && e.afterId === 0) {
      const list = out.get(e.participantId)
      if (list) removeLatest(list, e.beforeId)
    }
  }
  return out
}

/**
 * 按玩家回放卖出与撤销卖出，返回仍有效的卖出记录（时间升序）。
 * 撤销卖出为 beforeId=0、afterId=物品。
 */
function resolveSales(input: CardInput): Map<number, Buy[]> {
  const out = new Map<number, Buy[]>()
  for (const e of input.tl.events) {
    if (e.type === 'ITEM_SOLD') {
      const list = out.get(e.participantId) ?? []
      list.push({ itemId: e.itemId, ts: e.timestamp })
      out.set(e.participantId, list)
    } else if (e.type === 'ITEM_UNDO' && e.beforeId === 0 && e.afterId > 0) {
      const list = out.get(e.participantId)
      if (list) removeLatest(list, e.afterId)
    }
  }
  return out
}

/**
 * 每位玩家的成型装（传说装 + 成型鞋；同一物品只记首次；已剔除被撤销的购买），时间升序。
 * @returns 无成型装的玩家不在 map 中；hasItemBuild=false 或无物品元数据时为空 map
 */
export function completedBuilds(input: CardInput): Map<number, ItemBuy[]> {
  const { tl, hasItemBuild } = input
  const out = new Map<number, ItemBuy[]>()
  if (!hasItemBuild || Object.keys(tl.items).length === 0) return out
  for (const [pid, list] of resolvePurchases(input)) {
    const seen = new Set<number>()
    const done = list.filter(b => {
      const meta = tl.items[String(b.itemId)]
      if (!meta || meta.kind === 'other' || seen.has(b.itemId)) return false
      seen.add(b.itemId)
      return true
    })
    if (done.length) out.set(pid, done)
  }
  return out
}

/**
 * 中位数。
 * @returns 少于 2 个值时为 null（中位数就是玩家自己，不作比较）
 */
export function medianOrNull(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length < 2) return null
  const mid = sorted.length / 2
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 生成出装卡。
 * @returns weight = 第一件传说装时间差（分钟）的绝对值
 */
export function buildItemCards(input: CardInput): CardDraft[] {
  const { tl, roster, hasItemBuild, hasLanes } = input
  if (!hasItemBuild || Object.keys(tl.items).length === 0) return []
  const sales = resolveSales(input)

  const completed = completedBuilds(input)
  const firstLegendary = new Map<number, number>()
  for (const [pid, done] of completed) {
    const fl = done.find(b => tl.items[String(b.itemId)].kind === 'legendary')
    if (fl) firstLegendary.set(pid, fl.ts)
  }
  const median = medianOrNull([...firstLegendary.values()])

  const out: CardDraft[] = []
  for (const me of roster) {
    const done = completed.get(me.participantId)
    if (!done) continue
    const list = done.map(b => `${tl.items[String(b.itemId)].name} ${fmtTime(b.ts)}`).join('、')
    const mine = firstLegendary.get(me.participantId)
    let compare = ''
    let weight = 0
    if (mine !== undefined) {
      const opp = hasLanes ? laneOpponent(roster, me.participantId) : undefined
      const oppTs = opp ? firstLegendary.get(opp.participantId) : undefined
      const ref = hasLanes ? oppTs : (median ?? undefined)
      const refLabel = hasLanes ? `对位 ${opp?.champion ?? ''}` : '全场中位'
      if (ref !== undefined) {
        const diff = (mine - ref) / 60000
        const gap = Math.abs(diff)
        weight = gap
        compare =
          gap < 0.05
            ? `，与${refLabel}（${fmtTime(ref)}）同时`
            : `，比${refLabel}（${fmtTime(ref)}）${diff > 0 ? '晚' : '早'} ${gap.toFixed(1)} 分钟`
      }
      compare = `｜第一件传说装 ${fmtTime(mine)}${compare}`
    }
    const sold = (sales.get(me.participantId) ?? [])
      .filter(s => tl.items[String(s.itemId)]?.kind === 'legendary')
      .map(s => `｜卖出 ${tl.items[String(s.itemId)].name}`)
      .join('')
    out.push({
      kind: 'item',
      subjects: [me.participantId],
      minute: (mine ?? done[0].ts) / 60000,
      weight,
      text: `${me.champion} 出装｜${list}${compare}${sold}`
    })
  }
  return out
}
