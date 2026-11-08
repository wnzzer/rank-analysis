/**
 * A/B 评测 V2 组材料：本人参与（击杀/阵亡/助攻）的每次击杀前后 30 秒内的精简原始事件行。
 * 生产路径不使用。
 */
import { fmtTime } from './geometry'
import { buildingLabel, monsterLabel, sideLabel, zoneOf } from './labels'
import type { CardInput } from './types'

const HALF_WINDOW_MS = 30000

/**
 * 渲染本人关键时刻原始事件。
 * @param input - 卡片提取器输入（时间线、名册、地图）
 * @param participantId - 本人 participantId
 * @returns 一行一条，时间升序；无相关事件时返回空串
 */
export function renderRawEventWindow(input: CardInput, participantId: number): string {
  const { tl, roster, mapId } = input
  const champ = (id: number) => roster.find(r => r.participantId === id)?.champion ?? '未知'
  const anchors = tl.events
    .filter(
      e =>
        e.type === 'CHAMPION_KILL' &&
        [e.killerId, e.victimId, ...e.assisting].includes(participantId)
    )
    .map(e => e.timestamp)
  const inWindow = (t: number) => anchors.some(a => Math.abs(t - a) <= HALF_WINDOW_MS)
  const lines: string[] = []
  for (const e of tl.events) {
    if (!inWindow(e.timestamp)) continue
    const t = fmtTime(e.timestamp)
    switch (e.type) {
      case 'CHAMPION_KILL':
        lines.push(
          `${t} 击杀 ${champ(e.killerId)}→${champ(e.victimId)}${e.assisting.length ? ` 助攻:${e.assisting.map(champ).join('+')}` : ''} @${zoneOf(e.x, e.y, mapId)}`
        )
        break
      case 'ELITE_MONSTER_KILL':
        lines.push(`${t} ${sideLabel(e.killerTeamId)}拿下${monsterLabel(e.monsterType)}`)
        break
      case 'BUILDING_KILL':
        lines.push(
          `${t} ${sideLabel(e.teamId === 100 ? 200 : 100)}推掉${sideLabel(e.teamId)}${buildingLabel(e)}`
        )
        break
      case 'ITEM_PURCHASED': {
        const meta = tl.items[String(e.itemId)]
        if (e.participantId === participantId && meta && meta.kind !== 'other')
          lines.push(`${t} ${champ(e.participantId)} 购买 ${meta.name}`)
        break
      }
      case 'WARD_PLACED':
        if (e.creatorId === participantId)
          lines.push(`${t} ${champ(e.creatorId)} 插眼(${e.wardType})`)
        break
      default:
        break
    }
  }
  return lines.join('\n')
}
