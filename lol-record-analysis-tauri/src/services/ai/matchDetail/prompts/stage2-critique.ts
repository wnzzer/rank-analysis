/**
 * Stage 2 锐评 prompt。
 *
 * 输入：Stage 1 已校验的 AttributionResult + 同一 MatchSnapshot + 可选词库样本
 * 输出：流式 markdown，严格遵循 5 段模板
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

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
${JSON.stringify(attribution, null, 2)}

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

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系、外貌等）
- mitigatingFactors 必须体现在评价中（如 'off-role' → 应有"在补位"或"非主玩位置"的宽容措辞）
- 数字证据必须来自归因 JSON 的 evidenceMetrics 字段，不能编造新数字
- finalCall 是 Stage 1 给的判定，markdown 中可以化用但不要原样照搬

${vocabHint}
`
}
