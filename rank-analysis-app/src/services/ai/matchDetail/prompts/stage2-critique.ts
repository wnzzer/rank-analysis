/**
 * Stage 2 锐评 prompt。
 *
 * 输入：Stage 1 已校验的 AttributionResult + 同一 MatchSnapshot + 可选词库样本
 * 输出：JSON mode 草案（CritiqueDraft）——名册分组由代码从 verdicts 确定性映射，
 *      模型只填文案（oneLiner / comments / evidence）。严禁模型改判名册。
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

/** LCU teamPosition → 中文分路（与选人 prompt 的用词一致） */
const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/**
 * 名册一行：`- 名字｜英雄｜分路｜胜负方｜label｜participantId`。
 * 三个快照回填字段（champion/teamPosition/teamResult）缺席的段直接省略——
 * 无分路模式 teamPosition 为空串，participantId 不在快照时三者都 undefined。
 */
function rosterLine(v: {
  participantId: number
  name: string
  champion?: string
  teamPosition?: string
  teamResult?: string
  label: string
}): string {
  const segments = [
    `${v.participantId}`,
    v.name,
    v.champion,
    v.teamPosition ? POSITION_CN[v.teamPosition] : undefined,
    v.teamResult,
    v.label
  ]
  return '- ' + segments.filter(Boolean).join('｜')
}

export function buildStage2Prompt(
  attribution: AttributionResult,
  snapshot: MatchSnapshot,
  vocabSamples: string[]
): string {
  const vocabHint =
    vocabSamples.length > 0
      ? `【词库提示】（可采用、可创造新词）
${vocabSamples.join('、')}`
      : `【词库提示】
本次无固定词库，自由发挥，但保持网感与梗感。`

  return `你是 LOL 锐评写手。基于已经给出的归因 JSON，输出 JSON 草案，给玩家看的锐评文案在这里。

【输入：归因结果】
${JSON.stringify(attribution)}

【玩家名册】（快照事实：participantId｜名字｜英雄｜分路｜胜负方｜label，禁止偏离）
${attribution.verdicts.map(rosterLine).join('\n')}

【模式上下文】
${snapshot.modeContext.description}

【输出必须是 JSON 对象（不要 markdown / 前后缀 / 解释），字段如下】
{
  "verdict": "win" | "loss" | "neutral",  // 这场谁决定胜负（依据归因 winReason 与胜方定）
  "oneLiner": "一句话定论：一句锐评点明胜负 + 当局最显眼的人，要有梗感",
  "comments": {
    "participantId": "该玩家的锐评一句 — 数字证据",
    "..." 
  },
  "evidence": ["3-5 条关键证据，每条至少 1 个数字；优先选 evidenceMetrics 里 teamRank 极端的指标"]
}

【硬规则（违反任意一条即为废稿）】
- comments 的 key 只能是【玩家名册】里出现的 participantId（字符串形式）；名册外 id 一律丢弃。
- 章节归属（谁尽力/谁背锅/谁被打爆）由系统按 label 固定映射，你**不要输出名册分组**，不要提到"谁尽力了""谁要背锅"这类章节词。
- 玩家的分路、英雄、胜负方只能照抄【玩家名册】——禁止写名册之外的分路（例如把下路玩家写成"中路"），禁止臆造英雄定位。
- 禁止编造材料外的数据性比较或断言——任何"A 比 B 多/少"式说法，A 和 B 都必须是 evidenceMetrics 里给出的数字；夸张修辞必须建立在已给出的数字上。
- 禁止推荐或点评具体装备/符文/强化——材料未提供出装数据，装备名一律不许出现。${
    snapshot.modeContext.hasLanes
      ? ''
      : '\n- 本模式无分路：全文禁止出现任何分路词（上单/中单/下路/打野/辅助位/上路/中路/对线）。'
  }
- evidence 里不得编造新数字；mitigatingFactors 必须体现在对应玩家 comment 中（如 off-role → 应有"在补位"或"非主玩位置"的宽容措辞）。

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系、外貌等）
- finalCall 是 Stage 1 给的判定，comment 中可以化用但不要原样照搬

${vocabHint}
`
}
