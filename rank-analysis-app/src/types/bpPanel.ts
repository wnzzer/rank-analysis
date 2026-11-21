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

// ── 后端快照（与 src-tauri/src/bp_decision/panel.rs 同构，字段保持 snake_case） ──

/** 后端理由类型；前端据此生成文案并归到 {@link BpReasonKind} */
export type BpSnapshotReasonKind =
  | 'Meta'
  | 'Mastery'
  | 'Counters'
  | 'CounteredBy'
  | 'Risk'
  | 'CompSkew'
  | 'CompFill'
  | 'ThreatToPick'

/**
 * 后端给出的一条理由
 * @property champion_id - 理由涉及的另一个英雄；与英雄无关时为 0
 * @property delta - 对评估胜率的贡献（百分点）；无法量化为 null
 * @property tier - OP.GG T 级（仅 Meta；无数据为 0）
 * @property ban_rate - Ban 率 0~1（仅 ban 阶段的 Meta）
 */
export interface BpSnapshotReason {
  kind: BpSnapshotReasonKind
  champion_id: number
  delta: number | null
  tier: number
  ban_rate: number | null
}

/**
 * 后端给出的一张候选卡片
 * @property score - pick：评估胜率 0~1；ban：威胁度 0~95
 * @property physical_share - 物理伤害占比 0~1；伤害类型未知为 null
 * @property games - 近期场次（ban 阶段恒为 0）
 * @property wins - 近期胜场（ban 阶段恒为 0）
 */
export interface BpSnapshotCandidate {
  champion_id: number
  score: number
  in_pool: boolean
  physical_share: number | null
  games: number
  wins: number
  unfamiliar: boolean
  reasons: BpSnapshotReason[]
  warning: 'LackMagic' | 'LackPhysical' | null
}

/**
 * 操作台快照（`get_bp_panel` 的返回值）
 * @property auto_target_id - 到点会被自动执行的英雄；null = 不会自动执行
 * @property hovered_id - 客户端里当前实际预选的英雄，0 = 未预选
 * @property time_left_secs - 快照生成时本回合的剩余秒数
 * @property execute_at_secs_left - 自动执行发生在剩余多少秒时
 * @property ally_mix - 我方伤害构成，不含我自己
 * @property result_champion_id - Done 状态下我最终选定的英雄，其余为 0
 */
export interface BpPanelSnapshot {
  action_type: 'Ban' | 'Pick'
  stage: 'Waiting' | 'Acting' | 'Done'
  candidates: BpSnapshotCandidate[]
  auto_target_id: number | null
  hovered_id: number
  overridden: boolean
  time_left_secs: number
  total_secs: number
  execute_at_secs_left: number
  ally_mix: BpDamageMix
  enemy_mix: BpDamageMix
  result_champion_id: number
}
