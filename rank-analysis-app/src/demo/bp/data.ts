/**
 * BP 操作台演示数据：全部为手写假数据，仅用于无客户端验收视觉与交互。
 * 胜率、场次、登场率都不是真实统计，不进入正式应用数据源。
 */

/** 演示英雄的全部假属性。 */
export interface DemoChampion {
  id: number
  name: string
  /** Data Dragon 资源名 */
  alias: string
  /** 中路基础胜率 0~1 */
  base: number
  /** 物理伤害占比 0~1，其余视为魔法 */
  physical: number
  /** 打中路的占比 0~1，用作「他是我对位」的概率 */
  midRate: number
  /** 登场率 0~1 */
  pickRate: number
  /** Ban 率 0~1 */
  banRate: number
  /** OP.GG T 级 1~5 */
  tier: number
}

const c = (
  id: number,
  name: string,
  alias: string,
  base: number,
  physical: number,
  midRate: number,
  pickRate: number,
  banRate: number,
  tier: number
): DemoChampion => ({ id, name, alias, base, physical, midRate, pickRate, banRate, tier })

export const CHAMPIONS: DemoChampion[] = [
  c(103, '阿狸', 'Ahri', 0.51, 0.05, 0.98, 0.09, 0.04, 2),
  c(90, '玛尔扎哈', 'Malzahar', 0.52, 0.05, 0.97, 0.05, 0.06, 2),
  c(134, '辛德拉', 'Syndra', 0.502, 0.05, 0.96, 0.07, 0.03, 3),
  c(61, '奥莉安娜', 'Orianna', 0.505, 0.05, 0.99, 0.06, 0.01, 3),
  c(238, '劫', 'Zed', 0.498, 0.95, 0.9, 0.08, 0.31, 2),
  c(112, '维克托', 'Viktor', 0.515, 0.05, 0.95, 0.06, 0.03, 2),
  c(3, '加里奥', 'Galio', 0.522, 0.1, 0.8, 0.04, 0.02, 1),
  c(127, '丽桑卓', 'Lissandra', 0.508, 0.05, 0.92, 0.03, 0.01, 3),
  c(711, '薇古丝', 'Vex', 0.525, 0.05, 0.97, 0.04, 0.05, 1),
  c(1, '安妮', 'Annie', 0.518, 0.05, 0.85, 0.03, 0.01, 2),
  c(91, '泰隆', 'Talon', 0.507, 0.95, 0.7, 0.03, 0.04, 3),
  c(157, '亚索', 'Yasuo', 0.495, 0.9, 0.62, 0.11, 0.22, 3),
  c(84, '阿卡丽', 'Akali', 0.49, 0.25, 0.75, 0.07, 0.18, 3),
  c(7, '乐芙兰', 'Leblanc', 0.488, 0.05, 0.95, 0.06, 0.2, 3),
  c(55, '卡特琳娜', 'Katarina', 0.51, 0.3, 0.96, 0.05, 0.14, 2),
  c(777, '永恩', 'Yone', 0.497, 0.75, 0.55, 0.09, 0.16, 3),
  c(92, '锐雯', 'Riven', 0.5, 0.95, 0.03, 0.05, 0.03, 3),
  c(64, '李青', 'LeeSin', 0.49, 0.9, 0.01, 0.12, 0.08, 3),
  c(86, '盖伦', 'Garen', 0.51, 0.85, 0.03, 0.06, 0.02, 2),
  c(222, '金克丝', 'Jinx', 0.512, 0.95, 0, 0.14, 0.03, 2)
]

export const BY_ID: Record<number, DemoChampion> = Object.fromEntries(
  CHAMPIONS.map(champion => [champion.id, champion])
)

/** 我的英雄池（顺序即用户拖拽的优先级）。 */
export const MY_POOL = [103, 90, 134, 61, 238]

/** 会进入 pick 候选的中路英雄（池内 + 池外）。 */
export const PICK_CANDIDATES = [103, 90, 134, 61, 238, 112, 3, 127, 711, 1, 91]

/** 会进入 ban 候选的英雄。 */
export const BAN_CANDIDATES = [157, 238, 84, 7, 55, 777, 711]

/** 候选对敌方的对位胜率（候选自身视角）：VS[候选][敌方]。 */
export const VS: Record<number, Record<number, number>> = {
  103: { 157: 0.48, 238: 0.47, 55: 0.47, 777: 0.49, 84: 0.5, 7: 0.51 },
  90: { 157: 0.55, 238: 0.54, 55: 0.56, 84: 0.53, 7: 0.49, 777: 0.54 },
  134: { 157: 0.47, 238: 0.46, 84: 0.47, 7: 0.48 },
  61: { 157: 0.49, 238: 0.47, 84: 0.48, 55: 0.5 },
  238: { 157: 0.5, 84: 0.51, 7: 0.52, 777: 0.5 },
  112: { 157: 0.49, 238: 0.47, 84: 0.48 },
  3: { 157: 0.52, 238: 0.53, 84: 0.54, 7: 0.55, 55: 0.56, 777: 0.52 },
  127: { 157: 0.53, 238: 0.55, 84: 0.54, 55: 0.55, 777: 0.53 },
  711: { 157: 0.56, 238: 0.53, 84: 0.55, 7: 0.54, 55: 0.55, 777: 0.56 },
  1: { 157: 0.53, 238: 0.5, 84: 0.52, 55: 0.54 },
  91: { 157: 0.5, 84: 0.5 }
}

/** 我近期各英雄的战绩：英雄 → [场次, 胜场]。 */
export const MY_GAMES: Record<number, [number, number]> = {
  103: [12, 8],
  90: [3, 2],
  134: [9, 5],
  61: [6, 3],
  238: [7, 4],
  112: [4, 2]
}

/** 近期败局里敌方英雄出现次数。 */
export const NEMESIS: Record<number, number> = { 238: 4, 84: 3, 55: 2 }

/** 我的总体胜率，熟练度项的基准。 */
export const MY_AVG = 0.5

/** 我方已亮出的队友（上单已锁、打野已预选），下路两人未亮。 */
export const ALLIES = [92, 64]

/** 演示里可以逐个亮出的敌方英雄。 */
export const ENEMY_REVEALS = [157, 86, 222]

const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn'

/**
 * 英雄头像地址
 * @param id - 英雄 ID
 * @returns 版本固定的 Riot 公共头像 URL；未知英雄返回空串
 */
export function demoIcon(id: number): string {
  const champion = BY_ID[id]
  return champion ? `${DDRAGON}/16.21.1/img/champion/${champion.alias}.png` : ''
}

/**
 * 英雄竖版立绘地址（载入界面用图，比例适合卡片）
 * @param id - 英雄 ID
 * @returns Riot 公共立绘 URL；未知英雄返回空串
 */
export function demoSplash(id: number): string {
  const champion = BY_ID[id]
  return champion ? `${DDRAGON}/img/champion/loading/${champion.alias}_0.jpg` : ''
}
