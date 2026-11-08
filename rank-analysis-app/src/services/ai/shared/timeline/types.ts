/**
 * 对局时间线（SGP DETAILS 裁剪版，Rust `lcu::api::timeline::SlimTimeline`）与事实卡片类型。
 *
 * 时间线字段与 Rust 端 serde camelCase 输出一一对应；participantId 在 remap 之后
 * 均为 LCU 编号（与快照 players[].participantId 一致）。
 */

/** 某帧中单个玩家的状态。cs = 小兵 + 野怪 */
export interface SlimPlayerFrame {
  participantId: number
  totalGold: number
  xp: number
  level: number
  cs: number
  jungleCs: number
  x: number
  y: number
  damageToChampions: number
}

/** 每分钟一帧 */
export interface SlimFrame {
  timestamp: number
  players: SlimPlayerFrame[]
}

/** 受害者承受伤害的来源。topSlot：0-3=QWER，4/5=召唤师技能，63=被动，64=普攻，-1=未知 */
export interface DamageSource {
  participantId: number
  total: number
  topSlot: number
}

/** 保留的事件（判别联合，按 type 区分） */
export type SlimEvent =
  | {
      type: 'CHAMPION_KILL'
      timestamp: number
      killerId: number
      victimId: number
      assisting: number[]
      x: number
      y: number
      bounty: number
      shutdownBounty: number
      damageReceived: DamageSource[]
    }
  | { type: 'CHAMPION_SPECIAL_KILL'; timestamp: number; killerId: number; killType: string }
  | {
      type: 'ELITE_MONSTER_KILL'
      timestamp: number
      killerId: number
      killerTeamId: number
      monsterType: string
      monsterSubType: string
      x: number
      y: number
    }
  | {
      /** teamId = 被推建筑的所属队伍 */
      type: 'BUILDING_KILL'
      timestamp: number
      killerId: number
      teamId: number
      buildingType: string
      towerType: string
      laneType: string
    }
  | {
      /** teamId = 被打镀层的塔所属队伍 */
      type: 'TURRET_PLATE_DESTROYED'
      timestamp: number
      killerId: number
      teamId: number
      laneType: string
    }
  | { type: 'ITEM_PURCHASED'; timestamp: number; participantId: number; itemId: number }
  | { type: 'ITEM_SOLD'; timestamp: number; participantId: number; itemId: number }
  | {
      type: 'ITEM_UNDO'
      timestamp: number
      participantId: number
      beforeId: number
      afterId: number
    }
  | {
      type: 'SKILL_LEVEL_UP'
      timestamp: number
      participantId: number
      skillSlot: number
      levelUpType: string
    }
  | { type: 'WARD_PLACED'; timestamp: number; creatorId: number; wardType: string }
  | { type: 'WARD_KILL'; timestamp: number; killerId: number; wardType: string }
  | { type: 'GAME_END'; timestamp: number; winningTeam: number }

/** 物品分类 */
export type ItemKind = 'legendary' | 'boots' | 'other'

/** 物品元数据（仅本局被购买过的） */
export interface ItemMeta {
  name: string
  priceTotal: number
  kind: ItemKind
}

/**
 * 时间线里的玩家条目（SGP 单局 SUMMARY 真值）
 * @property teamPosition - 真实分路；旧缓存/拉取失败为空或缺省
 * @property visionScore - 视野得分（国服 LCU 不下发，SGP 才有）；缺失为 null/缺省
 * @property damageDealtToObjectives - 对野怪+建筑总伤害
 * @property timeCCingOthers - 控制他人总时长（秒）
 */
export interface SlimParticipant {
  participantId: number
  puuid: string
  teamPosition?: string
  visionScore?: number | null
  damageDealtToObjectives?: number | null
  timeCCingOthers?: number | null
}

/** 裁剪时间线 */
export interface SlimTimeline {
  gameId: number
  frameIntervalMs: number
  /** teamPosition：SGP 单局 SUMMARY 的真实分路；旧缓存/拉取失败为空或缺省 */
  participants: Array<SlimParticipant>
  frames: SlimFrame[]
  /** 按 timestamp 升序 */
  events: SlimEvent[]
  /** 键为 itemId 字符串 */
  items: Record<string, ItemMeta>
}

/** 卡片类别 */
export type CardKind = 'lane' | 'death' | 'item' | 'skill' | 'vision' | 'fight' | 'turn'

/**
 * 事实卡片：TS 从时间线算好的一行事实，模型只能转述并用 [id] 引用。
 * @property id - 前缀 + 序号，如 D3（前缀见 index.ts 的 PREFIX）
 * @property subjects - 涉及玩家；subjects[0] 是卡片"主人"（死者/出装者等），F/T 卡无主人语义
 * @property minute - 事件分钟（浮点，排序用）
 * @property numbers - text 中出现的全部数字（validator 核对用）
 * @property weight - 重要度，选卡排序用（越大越重要）
 */
export interface TimelineCard {
  id: string
  kind: CardKind
  subjects: number[]
  minute: number
  text: string
  numbers: number[]
  weight: number
}

/** 提取器产物（编号与数字由 index.ts 统一补） */
export type CardDraft = Omit<TimelineCard, 'id' | 'numbers'>

/** 卡片需要的玩家最小信息（MatchSnapshot.players 的结构子集） */
export interface RosterPlayer {
  participantId: number
  teamId: number
  teamPosition: string
  champion: string
  name: string
}

/** 提取器输入 */
export interface CardInput {
  tl: SlimTimeline
  roster: RosterPlayer[]
  hasLanes: boolean
  hasItemBuild: boolean
  mapId: number
}

/** 时间线拉取结果：ok=拿到；disabled=开关关闭或不需要；unavailable=拉取失败已降级 */
export type TimelineStatus = 'ok' | 'disabled' | 'unavailable'
