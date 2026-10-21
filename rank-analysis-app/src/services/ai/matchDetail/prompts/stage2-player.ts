/**
 * Stage 2 单人复盘 prompt。
 *
 * 与 stage2-critique（整局锐评）共享同一份 Stage 1 归因，但视角聚焦单个玩家：
 * 目标玩家完整快照行 + 同分路对位玩家行（数字对比）+ 目标的 verdict。
 * 硬规则沿用整局版：材料照抄、禁编造数字、禁材料外比较。
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'
import { identity, laneDiffText, playerFactCard, teamFactLines } from './factCard'
import { STAGE2_PLAIN_LANGUAGE_RULE } from './plainLanguage'

/** 有对线意义的分路值（UNKNOWN/'' 等一律视为无对位） */
const LANE_POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])

/**
 * 构建单人复盘 prompt
 * @param attribution - Stage 1 归因结果（与整局锐评共享，含 validator 回填的名册字段）
 * @param snapshot - 对局快照
 * @param participantId - 目标玩家
 * @param vocabSamples - 词库样本
 */
export function buildStage2PlayerPrompt(
  attribution: AttributionResult,
  snapshot: MatchSnapshot,
  participantId: number,
  vocabSamples: string[]
): string {
  const players = snapshot.players
  const targetPlayer = players.find(p => p.participantId === participantId)
  const targetBlock = targetPlayer
    ? `${identity(targetPlayer)}\n${playerFactCard(targetPlayer)}`
    : '（未找到目标玩家快照）'

  const opponent =
    targetPlayer && LANE_POSITIONS.has(targetPlayer.teamPosition)
      ? players.find(
          p => p.teamId !== targetPlayer.teamId && p.teamPosition === targetPlayer.teamPosition
        )
      : undefined
  const opponentBlock = opponent
    ? `${identity(opponent)}\n${playerFactCard(opponent)}`
    : '无同位对位数据（该模式无分路概念，或对面缺同分路玩家）。'
  const laneDiff = (targetPlayer && laneDiffText(targetPlayer)) || '无对位差数据。'

  const targetVerdict = attribution.verdicts.find(v => v.participantId === participantId)
  const verdictBlock = targetVerdict
    ? JSON.stringify(targetVerdict)
    : '该玩家未被列入整局归因（表现不在整局关键点名单里，属正常情况）。'

  const vocabHint =
    vocabSamples.length > 0
      ? `【词库提示】（可采用、可创造新词）\n${vocabSamples.join('、')}`
      : `【词库提示】\n本次无固定词库，自由发挥，但保持网感与梗感。`

  return `你是 LOL 锐评写手。基于下面的材料，为**目标玩家一个人**写一份单人复盘 markdown。

【模式上下文】
${snapshot.modeContext.description}

【整局胜负因果】
${attribution.winReason}

【双方队伍】（提到队伍总数据只能照抄这里，并分清是哪一方的）
${teamFactLines(snapshot, targetPlayer?.teamId)}

【目标玩家】（快照事实，本次复盘的唯一主角；每行开头的英雄名就是该行数字的主人）
${targetBlock}

【对位玩家】（同分路的对面玩家，用于数字对比；这里的数字属于对位玩家，不是目标玩家的）
${opponentBlock}

【对位差】（已算好，对比时直接照抄，禁止自己做减法）
${laneDiff}

【整局归因中的判定】
${verdictBlock}

【输出严格按下面 markdown 模板，章节顺序与标题不可改】

## 一句话定档
{一句话给目标玩家本局定性：carry / 合格 / 拖后腿，要有梗感}

## 数据面板解读
- 3-4 条 bullet，逐项解读目标玩家最突出的数字（好坏都要说），每条带数字

## 对位对比
- 与对位玩家的关键数字对比（KDA/伤害占比/经济/补刀），谁压谁一目了然；
  差值只能照抄【对位差】，禁止自己做减法
- 无对位数据时写"无同位对位数据，跳过对比"

## 责任归因
{结合整局胜负因果与目标玩家的判定，说清这局的锅/功有多少在他；判定的 label 与 finalCall
是结论基准，不得推翻——label 为"正常"时本段结论必须是中性（既不定罪也不吹捧），
只许描述数字事实；未列入归因时基于快照数据独立判断}

## 改进建议
- 2-3 条针对目标玩家的可执行改进建议，必须建立在上面的数字证据上；
  只谈操作/决策/团战取舍/资源节奏，不谈出装

【硬规则（违反任意一条即为废稿）】
- 玩家的分路、英雄、胜负方只能照抄材料，禁止写材料之外的分路或英雄定位。
- **每个数字只能写在它的主人名下**：事实卡每行开头的英雄名就是该行数字的主人，【对位玩家】的数字属于对位玩家，【双方队伍】的数字属于对应的一方。把别人的数字写成目标玩家的（或反过来）即为废稿。
- 数字证据只能来自上面的材料，不能编造新数字；禁止做材料里没有字段支撑的数据性比较或断言（含击杀归属、"第几高"类排名、时间点——材料里都没有）。
- 禁止推荐或点评具体装备/符文/强化——材料未提供出装数据，装备名一律不许出现。
- 材料字段值为 null 表示无数据（如国服战绩不下发视野数据），禁止当 0 解读、禁止据此评价。
- **禁止把材料没有的过程行为当作本局事实**：材料无 timeline，"他一直在刷野""对线被压""没参与团战"这类过程描述全是编造。解读只能落在数字本身；「改进建议」可以给"多参团/少单带"式的未来建议，但不得断言本局发生过什么行为。
  禁例：×「被越塔成渣」×「每次开团都在」×「游走支援不及时」;合规：「14 次死亡、参团率 25%，数字上是团队的负资产」。
- 位置职责以事实卡括号里的位置水平为准：标注「属于该位置正常水平」「高于该位置常见水平」的项不构成负面证据（如辅助伤害占比低、打野补刀低），不要据此定档；只有「低于该位置常见水平」才能说"低"（roleBenchmark 判定）。
- 近期画像为「无数据」时禁止评价熟练度/补位；标注「补位」时用"补位"宽容措辞。
- 禁止编造技能机制或版本改动——材料没给就不提。${
    snapshot.modeContext.hasLanes
      ? ''
      : '\n- 本模式无分路：全文禁止出现任何分路词（上单/中单/下路/打野/辅助位/上路/中路/对线）。'
  }

${STAGE2_PLAIN_LANGUAGE_RULE}

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系、外貌等）

${vocabHint}
`
}
