/**
 * Stage 2 单人复盘 prompt。
 *
 * 与 stage2-critique（整局锐评）共享同一份 Stage 1 归因，但视角聚焦单个玩家：
 * 目标玩家完整快照行 + 同分路对位玩家行（数字对比）+ 目标的 verdict。
 * 输出 JSON 草案；名册由代码确定性映射，模型只填文案。
 * 硬规则沿用整局版：材料照抄、禁编造数字、禁材料外比较。
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

/** 有对线意义的分路值（UNKNOWN/'' 等一律视为无对位） */
const LANE_POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])

/** 单个玩家 → 喂给模型的紧凑 JSON（剔除 isMe 等无关字段，保留全量数值证据） */
function playerBrief(p: MatchSnapshot['players'][number]): string {
  return JSON.stringify({
    name: p.name,
    champion: p.champion,
    teamPosition: p.teamPosition,
    result: p.win ? '胜方' : '败方',
    kda: p.kda,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    damageShare: p.damageShare,
    damageTakenShare: p.damageTakenShare,
    goldShare: p.goldShare,
    killParticipation: p.killParticipation,
    dpm: p.dpm,
    gpm: p.gpm,
    csm: p.csm,
    wardScore: p.wardScore,
    multiKills: p.multiKills,
    recentProfile: p.recentProfile
  })
}

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
  const targetBlock = targetPlayer ? playerBrief(targetPlayer) : '（未找到目标玩家快照）'

  const opponent =
    targetPlayer && LANE_POSITIONS.has(targetPlayer.teamPosition)
      ? players.find(
          p => p.teamId !== targetPlayer.teamId && p.teamPosition === targetPlayer.teamPosition
        )
      : undefined
  const opponentBlock = opponent
    ? playerBrief(opponent)
    : '无同位对位数据（该模式无分路概念，或对面缺同分路玩家）。'

  const targetVerdict = attribution.verdicts.find(v => v.participantId === participantId)
  const verdictBlock = targetVerdict
    ? JSON.stringify(targetVerdict)
    : '该玩家未被列入整局归因（表现不在整局关键点名单里，属正常情况）。'

  const vocabHint =
    vocabSamples.length > 0
      ? `【词库提示】（可采用、可创造新词）\n${vocabSamples.join('、')}`
      : `【词库提示】\n本次无固定词库，自由发挥，但保持网感与梗感。`

  return `你是 LOL 锐评写手。基于下面的材料，为**目标玩家一个人**写一份单人复盘 JSON 草案。

【模式上下文】
${snapshot.modeContext.description}

【整局胜负因果】
${attribution.winReason}

【目标玩家】（快照事实，本次复盘的唯一主角）
${targetBlock}

【对位玩家】（同分路的对面玩家，用于数字对比）
${opponentBlock}

【整局归因中的判定】
${verdictBlock}

【输出必须是 JSON 对象（不要 markdown / 前后缀 / 解释），字段如下】
{
  "verdict": "win" | "loss" | "neutral",  // 目标玩家本局定性：carry / 合格 / 拖后腿
  "oneLiner": "一句话给目标玩家本局定性，要有梗感",
  "rating": 1-10,           // 目标玩家本局评分
  "metrics": ["3-4 条目标玩家最突出的数字解读（好坏都要说），每条带数字"],
  "evidence": ["2-3 条关键证据，每条至少 1 个数字"],
  "improvements": [
    { "title": "改进点短标题", "evidence": "支撑的数字证据", "suggestion": "可执行建议（只谈操作/决策/团战取舍/资源节奏，不谈出装）" }
  ]
}

【硬规则（违反任意一条即为废稿）】
- 玩家的分路、英雄、胜负方只能照抄材料，禁止写材料之外的分路或英雄定位。
- 数字证据只能来自上面的材料，不能编造新数字；禁止做材料里没有字段支撑的数据性比较或断言（含击杀归属、"第几高"类排名、时间点——材料里都没有）。
- 禁止推荐或点评具体装备/符文/强化——材料未提供出装数据，装备名一律不许出现。
- 材料字段值为 null 表示无数据（如国服战绩不下发视野数据），禁止当 0 解读、禁止据此评价。
- recentProfile 为 null 时禁止评价熟练度/补位；isOffRole=true 时用"补位"宽容措辞。
- 禁止编造技能机制或版本改动——材料没给就不提。${
    snapshot.modeContext.hasLanes
      ? ''
      : '\n- 本模式无分路：全文禁止出现任何分路词（上单/中单/下路/打野/辅助位/上路/中路/对线）。'
  }

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击（生理特征、家庭关系、外貌等）

${vocabHint}
`
}
