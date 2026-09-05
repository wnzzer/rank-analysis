/**
 * 查询条件 ↔ 可视化 chips 的互转
 *
 * 结果页把解析出的条件渲染成一排可删除的 chip,让用户看见「AI 理解成了什么」
 * 并能手动修正(删 chip → removeChipFromQuery → 本地重筛,不重打模型)。
 */

import type { ParsedMatchQuery, QueryChip } from './types'

/** 分路 → 中文展示名 */
const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/**
 * 把查询条件展开为 chips
 * @param q - 查询条件
 * @param championName - 英雄 id → 展示名
 * @param queueName - 队列 id → 展示名
 */
export function queryToChips(
  q: ParsedMatchQuery,
  championName: (id: number) => string,
  queueName: (id: number) => string
): QueryChip[] {
  const chips: QueryChip[] = []

  const { from, to } = q.timeRange
  if (from || to) {
    const label =
      from && to ? `时间: ${from} ~ ${to}` : from ? `时间: ${from} 起` : `时间: 截至 ${to}`
    chips.push({ key: 'time', label })
  }

  for (const id of q.selfChampionIds)
    chips.push({ key: `self:${id}`, label: `我用: ${championName(id)}` })
  for (const id of q.allyChampionIds)
    chips.push({ key: `ally:${id}`, label: `队友: ${championName(id)}` })
  for (const id of q.enemyChampionIds)
    chips.push({ key: `enemy:${id}`, label: `对面: ${championName(id)}` })
  for (const id of q.myTeamChampionIds)
    chips.push({ key: `team:${id}`, label: `我方有: ${championName(id)}` })

  if (q.result !== 'any')
    chips.push({ key: 'result', label: `结果: ${q.result === 'win' ? '胜' : '负'}` })

  for (const p of q.selfPositions)
    chips.push({ key: `pos:${p}`, label: `我玩: ${POSITION_CN[p] ?? p}` })

  for (const id of q.queueIds) chips.push({ key: `queue:${id}`, label: `模式: ${queueName(id)}` })
  for (const name of q.playerNames) chips.push({ key: `player:${name}`, label: `玩家: ${name}` })

  return chips
}

/**
 * 删除一枚 chip 对应的条件,返回新查询对象(不修改原对象)。
 * 未知 key 原样返回;删光 playerNames 时 count 意图退回 list(统计对象没了)。
 */
export function removeChipFromQuery(q: ParsedMatchQuery, key: string): ParsedMatchQuery {
  const next: ParsedMatchQuery = {
    ...q,
    timeRange: { ...q.timeRange },
    selfChampionIds: [...q.selfChampionIds],
    allyChampionIds: [...q.allyChampionIds],
    enemyChampionIds: [...q.enemyChampionIds],
    myTeamChampionIds: [...q.myTeamChampionIds],
    queueIds: [...q.queueIds],
    playerNames: [...q.playerNames],
    selfPositions: [...q.selfPositions]
  }

  if (key === 'time') {
    next.timeRange = { from: null, to: null }
    return next
  }
  if (key === 'result') {
    next.result = 'any'
    return next
  }

  const sep = key.indexOf(':')
  if (sep < 0) return next
  const kind = key.slice(0, sep)
  const value = key.slice(sep + 1)

  const dropId = (arr: number[]) => arr.filter(id => String(id) !== value)
  switch (kind) {
    case 'self':
      next.selfChampionIds = dropId(next.selfChampionIds)
      break
    case 'ally':
      next.allyChampionIds = dropId(next.allyChampionIds)
      break
    case 'enemy':
      next.enemyChampionIds = dropId(next.enemyChampionIds)
      break
    case 'team':
      next.myTeamChampionIds = dropId(next.myTeamChampionIds)
      break
    case 'queue':
      next.queueIds = dropId(next.queueIds)
      break
    case 'player':
      next.playerNames = next.playerNames.filter(n => n !== value)
      if (next.playerNames.length === 0) next.intent = 'list'
      break
    case 'pos':
      next.selfPositions = next.selfPositions.filter(p => p !== value)
      break
  }
  return next
}
