/**
 * BP 操作台（选人期 ban/pick 推荐与交互面板）的展示层类型。
 *
 * 面板是纯展示 + 事件上抛：打分、排序、自动目标的判定都由调用方完成，
 * 这里只描述「已经算好的结果长什么样」。
 */

/** 当前阶段的动作类型，决定主题色与按钮文案。 */
export type BpPanelAction = 'ban' | 'pick'

/** 理由标签所属的打分项，决定标签图标与配色。 */
export type BpReasonKind = 'meta' | 'mastery' | 'counter' | 'risk' | 'comp' | 'nemesis'

/**
 * 一条推荐理由
 * @property kind - 来自哪个打分项
 * @property label - 展示文案，如「克制亚索」
 * @property delta - 对评估胜率的贡献（百分点，可正可负）；无法量化的理由省略
 */
export interface BpReason {
  kind: BpReasonKind
  label: string
  delta?: number
}

/** 英雄的主要伤害类型，用于卡片描边配色。 */
export type BpDamageType = 'physical' | 'magic' | 'mixed'

/**
 * 一张候选卡片
 * @property championId - 英雄 ID
 * @property name - 英雄名
 * @property icon - 头像 URL
 * @property splash - 立绘 URL，缺省时退回头像
 * @property headline - 主数字，如「55.5%」
 * @property caption - 主数字的含义，如「评估胜率」
 * @property inPool - 是否在用户英雄池内；池外卡片带角标且不参与自动执行
 * @property damage - 主要伤害类型
 * @property mastery - 熟练度文案，如「12 场 67%」「没玩过」
 * @property unfamiliar - 熟练度是否应以警示色展示
 * @property reasons - 理由标签，调用方已按重要性排序
 * @property warning - 卡片级警告，如「全队缺魔法伤害」
 */
export interface BpCandidate {
  championId: number
  name: string
  icon: string
  splash?: string
  headline: string
  caption: string
  inPool: boolean
  damage: BpDamageType
  mastery?: string
  unfamiliar?: boolean
  reasons: BpReason[]
  warning?: string
}

/**
 * 一方的伤害构成
 * @property physical - 物理占比 0~1
 * @property magic - 魔法占比 0~1
 * @property known - 已亮出的英雄数（0 时构成条显示为未知）
 */
export interface BpDamageMix {
  physical: number
  magic: number
  known: number
}

/**
 * 面板所处的状态
 * - `waiting`: 选人期已开始但还没轮到我，收起为窄栏
 * - `acting`: 轮到我，展开完整操作台
 * - `done`: 本动作已完成，收起并显示结果
 */
export type BpPanelStage = 'waiting' | 'acting' | 'done'

/** 搜索框选项，与 `get_champion_options` 的返回同构。 */
export interface BpChampionOption {
  value: number
  label: string
}
