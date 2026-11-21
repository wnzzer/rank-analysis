/**
 * 「评分说明」：喂给 AI 的固定材料，说明复盘评分看什么、**不看什么**。
 *
 * 玩家反驳模型结论时，AI 靠这份说明判断该认账还是该摆数据：理由指向「不看」清单里的东西，
 * 就是评分确实没算，应当认账，而不是硬找数据反驳。
 *
 * ⚠️ 评分逻辑（`services/ai/shared/scoring/`）每次变化都要同步改这里。
 * 清单过时的后果是 AI 对已经算进去的东西认账——比如哪天做了团战缺席归责，
 * 就必须把 NOT_SCORED 的第一条删掉。
 *
 * @module services/ai/review/scoringNotes
 */

/** 每个分项看什么（与 `scoring/subScores.ts` 的 computeSubScores 对应） */
export const SCORED: readonly string[] = [
  '对线：前 14 分钟与对位的经济、经验、补刀差，以及对线期阵亡里本人该负的责任',
  '团战：击杀参与率、团战缺席率、团战里是不是第一个倒下、伤害与经济是否相称',
  '死亡质量：每次阵亡的代价与本人该负的责任（被多人包抄、队友先倒下、搭档不在身边会减责）',
  '发育：每分钟经济与补刀',
  '资源：对大小龙、先锋、防御塔的伤害，以及己方拿资源时是否在场',
  '视野（辅助）：每分钟视野分与控制守卫',
  '职责：打野的线上抓人、中单的支援、辅助的游走'
]

/** 评分明确不看的东西：玩家的理由指向这些时，AI 应当认账 */
export const NOT_SCORED: readonly string[] = [
  '团战缺席只拉低本人的团战分项，不追究「因为他不在，队友少打多输了」的后果（全程单带不参团属于这一条）',
  '推塔伤害直接算进资源分项，不和同一时间队伍丢掉的东西对冲',
  '不看英雄克制与阵容搭配',
  '不看语音、打字、信号等沟通，也看不出挂机、故意送、摆烂这类态度问题',
  '不看装备选择与出装顺序',
  '不看时机：只数到没到场、参与了几次击杀，看不出该来的时候来没来、是不是只在安全的时候才出现'
]

/**
 * 只在这局确实没有时间线时才给模型看的一条。
 *
 * 不能无条件放进 NOT_SCORED：真机（2026-11-21）模型把「没有时间线数据时……」这句条件句
 * 读成了陈述，在一局有完整时间线的对局里回复「这局没时间线数据，具体时点我也核不出来」。
 */
export const NO_TIMELINE_NOTE = '这局没有时间线数据：没有逐次阵亡的归责，只能看终局数据'

/**
 * 拼成给模型看的一段文本
 * @param hasTimeline - 这局有没有时间线；没有时多给一条 {@link NO_TIMELINE_NOTE}
 * @returns 两个小节：评分看什么 / 评分不看什么
 */
export function scoringNotesText(hasTimeline: boolean): string {
  const list = (items: readonly string[]): string => items.map(s => `- ${s}`).join('\n')
  const notScored = hasTimeline ? NOT_SCORED : [...NOT_SCORED, NO_TIMELINE_NOTE]
  return `【评分看什么】\n${list(SCORED)}\n\n【评分不看什么】\n${list(notScored)}`
}
