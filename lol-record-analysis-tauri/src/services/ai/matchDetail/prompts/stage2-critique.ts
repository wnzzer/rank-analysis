/**
 * Stage 2 锐评 prompt。
 *
 * 输入：Stage 1 已校验的 AttributionResult + 同一 MatchSnapshot + 可选词库样本
 * 输出：流式 markdown，严格遵循 5 段模板
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult, Verdict } from '../types'

/** LCU teamPosition → 中文分路（与选人 prompt 的用词一致） */
const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/**
 * 名册一行：`- 名字｜英雄｜分路｜胜负方｜label`。
 * 三个快照回填字段（champion/teamPosition/teamResult）缺席的段直接省略——
 * 无分路模式 teamPosition 为空串，participantId 不在快照时三者都 undefined。
 */
function rosterLine(v: Verdict): string {
  const segments = [
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

  return `你是 LOL 锐评写手。基于已经给出的归因 JSON，转写为锐评 markdown 给玩家看。

【输入：归因结果】
${JSON.stringify(attribution)}

【玩家名册】（快照事实：名字｜英雄｜分路｜胜负方｜label，禁止偏离）
${attribution.verdicts.map(rosterLine).join('\n')}

【模式上下文】
${snapshot.modeContext.description}

【输出严格按下面 markdown 模板，章节顺序与标题不可改】

## 一句话定论
{用一句锐评点明胜负 + 当局最显眼的人，要有梗感}

## 谁尽力了
- {名字}：{锐评一句} — {数字证据}
- 没有特别尽力的人时，写"本局都是混子局，没人称得上扛把子"

## 谁要背锅
- {名字}：{锐评一句} — {数字证据}
- 没有明显背锅时，写"本局没人能甩锅，混战自有命数"

## 谁被打爆 / 被连累
- {名字 + 哪类}：{锐评一句} — {数字证据 + 申辩理由（如有）}
- 没有则写"无明显被针对者"

## 关键证据
- 3-5 条 bullet，每条带至少 1 个数字
- 优先选 evidenceMetrics 里 teamRank 极端的指标

【硬规则（违反任意一条即为废稿）】
- 章节归属由名册里的 label 固定映射，禁止自行挪动：尽力 →「谁尽力了」；犯罪/缚地灵 →「谁要背锅」；被爆/被连累 →「谁被打爆 / 被连累」；正常 → 不单独上榜（只可出现在关键证据）。败方玩家绝不出现在「谁尽力了」。每名玩家只能出现在自己 label 对应的那一个章节，禁止同一人重复上榜多个章节。
- 玩家的分路、英雄、胜负方只能照抄【玩家名册】——禁止写名册之外的分路（例如把下路玩家写成"中路"），禁止臆造英雄定位。
- 禁止编造材料外的数据性比较或断言——任何"A 比 B 多/少"式说法，A 和 B 都必须是 evidenceMetrics 里给出的数字；夸张修辞必须建立在已给出的数字上。
- 禁止推荐或点评具体装备/符文/强化——材料未提供出装数据，装备名一律不许出现。${
    snapshot.modeContext.hasLanes
      ? ''
      : '\n- 本模式无分路：全文禁止出现任何分路词（上单/中单/下路/打野/辅助位/上路/中路/对线）。'
  }

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系、外貌等）
- mitigatingFactors 必须体现在评价中（如 'off-role' → 应有"在补位"或"非主玩位置"的宽容措辞）
- 数字证据必须来自归因 JSON 的 evidenceMetrics 字段，不能编造新数字
- finalCall 是 Stage 1 给的判定，markdown 中可以化用但不要原样照搬

${vocabHint}
`
}
