/**
 * 时间线中文标签：地图区域、野怪、建筑、技能槽、阵营。
 *
 * 召唤师峡谷坐标约 0~14870，蓝方基地在左下 (0,0)，红方在右上；中路沿 x=y，
 * 河道与中路垂直（x+y≈14800）。区域划分是近似值，卡片文本据此只写"在哪附近"。
 */
import { dist } from './geometry'

/** 召唤师峡谷 / 嚎哭深渊（大乱斗、海斗同图） */
const SUMMONERS_RIFT = 11
const HOWLING_ABYSS = 12
const DRAGON_PIT = { x: 9866, y: 4414 }
const BARON_PIT = { x: 5007, y: 10471 }
/** 河道所在的反对角线 x+y 值 */
const RIVER_SUM = 14800

/** 阵营中文 */
export function sideLabel(teamId: number): '蓝方' | '红方' {
  return teamId === 100 ? '蓝方' : '红方'
}

/**
 * 坐标 → 区域中文名。
 * @param mapId - 11 召唤师峡谷 / 12 嚎哭深渊；其他地图返回"未知区域"
 */
export function zoneOf(x: number, y: number, mapId: number): string {
  if (mapId === SUMMONERS_RIFT) {
    if (dist(x, y, DRAGON_PIT.x, DRAGON_PIT.y) <= 1000) return '小龙坑'
    if (dist(x, y, BARON_PIT.x, BARON_PIT.y) <= 1000) return '大龙坑'
    if (x <= 3000 && y <= 3000) return '蓝方基地'
    if (x >= 11800 && y >= 11800) return '红方基地'
    const half = x + y < RIVER_SUM ? '（蓝方半场）' : '（红方半场）'
    if (x <= 2000 || y >= 12800) return `上路${half}`
    if (y <= 2000 || x >= 12800) return `下路${half}`
    if (Math.abs(x - y) <= 1300) return `中路${half}`
    if (Math.abs(x + y - RIVER_SUM) <= 1300) return x < y ? '上半河道' : '下半河道'
    const side = x + y < RIVER_SUM ? '蓝方' : '红方'
    return `${side}${y > x ? '上半' : '下半'}野区`
  }
  if (mapId === HOWLING_ABYSS) {
    const t = (x + y) / 2 / 12800
    if (t < 0.12) return '蓝方基地'
    if (t < 0.3) return '蓝方塔区'
    if (t < 0.5) return '蓝方半桥'
    if (t < 0.7) return '红方半桥'
    if (t < 0.88) return '红方塔区'
    return '红方基地'
  }
  return '未知区域'
}

const MONSTER: Record<string, string> = {
  DRAGON: '小龙',
  BARON_NASHOR: '大龙',
  RIFTHERALD: '先锋',
  HORDE: '虚空巢虫',
  ATAKHAN: '阿塔坎'
}

/** 野怪类型中文（未知类型原样返回） */
export function monsterLabel(type: string): string {
  return MONSTER[type] ?? type
}

const LANE: Record<string, string> = { TOP_LANE: '上路', MID_LANE: '中路', BOT_LANE: '下路' }
const TOWER: Record<string, string> = {
  OUTER_TURRET: '一塔',
  INNER_TURRET: '二塔',
  BASE_TURRET: '高地塔',
  NEXUS_TURRET: '门牙塔'
}

/** 建筑中文（如"下路一塔""中路水晶"） */
export function buildingLabel(e: {
  buildingType: string
  towerType: string
  laneType: string
}): string {
  const lane = LANE[e.laneType] ?? ''
  if (e.buildingType === 'INHIBITOR_BUILDING') return `${lane}水晶`
  return `${lane}${TOWER[e.towerType] ?? '塔'}`
}

const SLOT: Record<number, string> = {
  0: 'Q',
  1: 'W',
  2: 'E',
  3: 'R',
  4: '召唤师技能',
  5: '召唤师技能',
  63: '被动',
  64: '普攻'
}

/** 伤害来源技能槽中文 */
export function slotLabel(slot: number): string {
  return SLOT[slot] ?? '其他'
}
