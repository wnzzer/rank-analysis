/**
 * 从 BP 决策快照反推一条规则草稿。
 *
 * 选人期手上数据齐备，映射是机械的，无需 AI。唯一的设计难点是条件粒度：
 * 只取位置太宽（等于无条件）；取对面全部 5 个是死规则（要求五英雄完全一致，
 * 永不再命中）。因此只取**一个**关键敌方英雄，三级兜底见下。
 */
import type { BpDecision } from '@renderer/types/bpDecision'
import type { BanRule, PickRule, Position, RuleCondition } from '@renderer/types/rules'
import { POSITION_LABEL } from '@renderer/types/rules'

/** 与 RuleEditModal.vue 同一套 id 生成，项目未引入 uuid 依赖 */
const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function buildRuleDraft(args: {
  decision: BpDecision
  /** 我的分路，ARAM 等无分路模式为 null */
  myPosition: Position | null
  /** 同分路对位的敌方英雄 ID，无则 null */
  laneOpponentId: number | null
  championName: (id: number) => string
}): PickRule | BanRule | null {
  const { decision, myPosition, laneOpponentId, championName } = args
  const target = decision.target
  if (!target) return null

  const conditions: RuleCondition[] = []
  if (myPosition) conditions.push({ type: 'Position', value: myPosition })

  // 关键敌方英雄：优先取克制关系最强的那个——那大概率就是做出该选择的原因；
  // OP.GG 只给 top3 苦手，多数对局取不到，此时退回同分路对位英雄。
  const keyEnemy = target.evidence?.against_champion_id ?? laneOpponentId
  if (keyEnemy != null) {
    conditions.push({ type: 'EnemyChampionsContains', ids: [keyEnemy] })
  }

  const name = buildName(myPosition, keyEnemy, target.champion_id, championName)
  const base = { id: uuid(), name, enabled: true, conditions }

  return decision.action_type === 'Ban'
    ? { ...base, action: { champion_id: target.champion_id } }
    : { ...base, action: { champion_id: target.champion_id, lock: target.lock } }
}

/** 生成对用户自解释的规则名，让人一眼看出它什么时候会命中、该怎么改。 */
function buildName(
  myPosition: Position | null,
  keyEnemy: number | null,
  targetId: number,
  championName: (id: number) => string
): string {
  if (myPosition && keyEnemy != null) {
    return `${POSITION_LABEL[myPosition]} · 对位${championName(keyEnemy)}`
  }
  if (myPosition) return `${POSITION_LABEL[myPosition]} · 仅位置`
  return `${championName(targetId)} · 无条件`
}
