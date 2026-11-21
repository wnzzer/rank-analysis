/**
 * BP 操作台快照 → 面板展示数据的纯映射。
 *
 * 后端只给结构化结果（英雄 ID、分数、理由类型），文案、头像、伤害类型分档都在这里生成，
 * 这样改措辞不用动后端，也不用重新编译。
 *
 * @module services/bpPanelView
 */
import type {
  BpCandidate,
  BpDamageMix,
  BpDamageType,
  BpPanelAction,
  BpPanelSnapshot,
  BpPanelStage,
  BpReason,
  BpSnapshotCandidate,
  BpSnapshotReason
} from '@renderer/types/bpPanel'

/** 物理占比高于此值算物理英雄，低于 1 - 此值算魔法英雄，其间为混合 */
const PHYSICAL_THRESHOLD = 0.65

/**
 * 映射所需的外部能力（注入以保持纯函数）
 * @property name - 英雄 ID → 中文名
 * @property icon - 英雄 ID → 头像 URL
 */
export interface BpPanelViewDeps {
  name: (championId: number) => string
  icon: (championId: number) => string
}

/**
 * 面板本地状态：后端快照还没反映出来的用户操作
 * @property hoverId - 用户在面板上刚点的英雄；没点过为 null
 * @property overridden - 用户是否已在面板上接管
 */
export interface BpPanelLocalState {
  hoverId: number | null
  overridden: boolean
}

/** 面板除倒计时与事件外的全部展示属性，可直接 v-bind 到 BpCommandPanel */
export interface BpPanelView {
  action: BpPanelAction
  stage: BpPanelStage
  candidates: BpCandidate[]
  autoTargetId: number | null
  hoveredId: number | null
  overridden: boolean
  allyMix: BpDamageMix
  enemyMix: BpDamageMix
  resultName: string
}

/**
 * 物理占比 → 伤害类型分档
 * @param share - 物理占比 0~1；未知传 null
 * @returns 未知时按混合处理（卡片描边用中性色）
 */
export function damageTypeOf(share: number | null): BpDamageType {
  if (share === null) return 'mixed'
  if (share >= PHYSICAL_THRESHOLD) return 'physical'
  if (share <= 1 - PHYSICAL_THRESHOLD) return 'magic'
  return 'mixed'
}

/** 后端理由 → 带文案的展示理由 */
function toReason(
  r: BpSnapshotReason,
  candidate: BpSnapshotCandidate,
  action: BpPanelAction,
  name: (id: number) => string
): BpReason {
  const delta = r.delta ?? undefined
  switch (r.kind) {
    case 'Meta': {
      const tier = r.tier > 0 ? `T${r.tier}` : '版本强度'
      if (action === 'ban' && r.ban_rate !== null)
        return { kind: 'meta', label: `${tier} · Ban 率 ${Math.round(r.ban_rate * 100)}%`, delta }
      return { kind: 'meta', label: r.tier > 0 ? `版本 ${tier}` : tier, delta }
    }
    case 'Mastery':
      return { kind: 'mastery', label: (r.delta ?? 0) < 0 ? '不熟练' : '熟练度', delta }
    case 'Counters':
      return { kind: 'counter', label: `克制${name(r.champion_id)}`, delta }
    case 'CounteredBy':
      return { kind: 'counter', label: `被${name(r.champion_id)}克制`, delta }
    case 'Risk':
      return { kind: 'risk', label: '先手风险', delta }
    case 'CompSkew':
      return { kind: 'comp', label: '阵容偏科', delta }
    case 'CompFill':
      return {
        kind: 'comp',
        label: (candidate.physical_share ?? 0.5) < 0.5 ? '补魔法伤害' : '补物理伤害',
        delta
      }
    case 'ThreatToPick':
      return { kind: 'counter', label: `克制你的${name(r.champion_id)}`, delta }
  }
}

/** 后端候选 → 展示卡片 */
function toCandidate(
  c: BpSnapshotCandidate,
  action: BpPanelAction,
  deps: BpPanelViewDeps
): BpCandidate {
  const base = {
    championId: c.champion_id,
    name: deps.name(c.champion_id),
    icon: deps.icon(c.champion_id),
    inPool: c.in_pool,
    damage: damageTypeOf(c.physical_share),
    reasons: c.reasons.map(r => toReason(r, c, action, deps.name))
  }
  if (action === 'ban') return { ...base, headline: String(Math.round(c.score)), caption: '威胁度' }
  return {
    ...base,
    headline: `${(c.score * 100).toFixed(1)}%`,
    caption: '评估胜率',
    mastery:
      c.games === 0 ? '没玩过' : `近期 ${c.games} 场 ${Math.round((c.wins / c.games) * 100)}%`,
    unfamiliar: c.unfamiliar,
    warning:
      c.warning === 'LackMagic'
        ? '选它全队缺魔法伤害'
        : c.warning === 'LackPhysical'
          ? '选它全队缺物理伤害'
          : undefined
  }
}

/**
 * 面板上应当显示为「当前预选」的英雄
 *
 * 优先级：用户刚点的（请求可能还没到客户端）→ 客户端里实际预选的 →
 * 自动化即将执行的目标（轮到我且未接管时，让用户可以一键提前确认）。
 * @param snapshot - 后端快照
 * @param localHoverId - 用户在面板上刚点的英雄；没点过为 null
 * @param overridden - 是否已接管
 * @returns 英雄 ID；没有任何预选时为 null
 */
export function effectiveHoverId(
  snapshot: BpPanelSnapshot,
  localHoverId: number | null,
  overridden: boolean
): number | null {
  if (localHoverId) return localHoverId
  if (snapshot.hovered_id) return snapshot.hovered_id
  if (snapshot.stage === 'Acting' && !overridden) return snapshot.auto_target_id
  return null
}

/**
 * 后端快照 → 面板展示属性
 * @param snapshot - `get_bp_panel` 的返回值
 * @param deps - 英雄名与头像的取法
 * @param local - 面板本地状态（可选）
 * @returns 可直接 v-bind 到 BpCommandPanel 的属性（不含倒计时）
 * @example
 * ```ts
 * const view = toPanelView(snapshot, { name: getChampionName, icon: getChampionUrl })
 * ```
 */
export function toPanelView(
  snapshot: BpPanelSnapshot,
  deps: BpPanelViewDeps,
  local: BpPanelLocalState = { hoverId: null, overridden: false }
): BpPanelView {
  const action: BpPanelAction = snapshot.action_type === 'Ban' ? 'ban' : 'pick'
  const overridden = snapshot.overridden || local.overridden
  const hoveredId = effectiveHoverId(snapshot, local.hoverId, overridden)

  // 我方构成条把当前预选也算进去，点卡片能立刻看到阵容变化
  let allyMix = snapshot.ally_mix
  const hovered = snapshot.candidates.find(c => c.champion_id === hoveredId)
  if (action === 'pick' && hovered && hovered.physical_share !== null) {
    allyMix = {
      physical: allyMix.physical + hovered.physical_share,
      magic: allyMix.magic + 1 - hovered.physical_share,
      known: allyMix.known + 1
    }
  }

  return {
    action,
    stage: snapshot.stage.toLowerCase() as BpPanelStage,
    candidates: snapshot.candidates.map(c => toCandidate(c, action, deps)),
    autoTargetId: snapshot.auto_target_id,
    hoveredId,
    overridden,
    allyMix,
    enemyMix: snapshot.enemy_mix,
    resultName: snapshot.result_champion_id ? deps.name(snapshot.result_champion_id) : ''
  }
}

/**
 * 面板倒计时的基准
 *
 * 自动兜底生效时，倒计时指向「距离自动执行」（自动执行发生在回合结束前几秒）；
 * 否则指向回合结束。
 * @param snapshot - 后端快照
 * @param autoActive - 自动兜底是否仍然生效（有目标且未接管）
 * @returns 剩余秒数与总秒数，均 >= 0
 */
export function countdownOf(
  snapshot: BpPanelSnapshot,
  autoActive: boolean
): { secsLeft: number; totalSecs: number } {
  const offset = autoActive ? snapshot.execute_at_secs_left : 0
  return {
    secsLeft: Math.max(0, snapshot.time_left_secs - offset),
    totalSecs: Math.max(0, snapshot.total_secs - offset)
  }
}
