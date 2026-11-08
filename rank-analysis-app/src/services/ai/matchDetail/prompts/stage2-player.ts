/**
 * Stage 2 单人复盘 prompt。
 *
 * 与 stage2-critique（整局锐评）共享同一份 Stage 1 归因，但视角聚焦单个玩家：
 * 目标玩家完整快照行 + 同分路对位玩家行（数字对比）+ 目标的 verdict。
 * 硬规则沿用整局版：材料照抄、禁编造数字、禁材料外比较。
 */

import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'
import { renderCardLines, selectCards } from '../../shared/timeline'
import { PLAIN_SCORE_RULES, renderScoreBlock } from '../scoredAttribution'
import { identity, playerFactCard, teamFactLines } from './factCard'
import { STAGE2_PLAIN_LANGUAGE_RULE } from './plainLanguage'

/** 有目标玩家表现评估时：定档与归因的立场随 label；后接共用的人话规则 */
const PLAYER_SCORE_RULE =
  '- 「一句话定档」与「责任归因」必须与【表现评估】的 label 立场一致，「责任归因」至少引用一项的等级词与数据或一类阵亡；label 为被连累时「责任归因」与「改进建议」必须点出【表现评估】里的「短板」；结论照抄，禁止另编。\n' +
  PLAIN_SCORE_RULES

/** 无时间线时的出装禁令（原文，降级路径逐字不变） */
const NO_TIMELINE_EQUIP_RULE = `- 禁止推荐或点评具体装备/符文/强化——材料未提供出装数据，装备名一律不许出现。`

/** 无时间线时的过程行为禁令（原文，含禁例行） */
const NO_TIMELINE_PROCESS_RULE = `- **禁止把材料没有的过程行为当作本局事实**：材料无 timeline，"他一直在刷野""对线被压""没参与团战"这类过程描述全是编造。解读只能落在数字本身；「改进建议」可以给"多参团/少单带"式的未来建议，但不得断言本局发生过什么行为。
  禁例：×「被越塔成渣」×「每次开团都在」×「游走支援不及时」;合规：「14 次死亡、参团率 25%，数字上是团队的负资产」。`

/** 无时间线时数字规则里的括注（原文） */
const NO_TIMELINE_NUMBER_NOTE = `（含击杀归属、"第几高"类排名、时间点——材料里都没有）`

/** 有时间线时的出装规则 */
const TIMELINE_EQUIP_RULE =
  '- 禁止推荐具体装备/符文/强化；出装只能引用 I 卡片里的成型时间与时间差。'

/** 有时间线时的过程描述规则 */
const TIMELINE_PROCESS_RULE =
  '- **过程性描述必须带卡片编号**：本局过程只能来自【时间线事实卡片】，写到时刻、地点、团战、死亡时必须标编号，时间与数字照抄卡片；卡片没有的过程一律不许写。\n' +
  '- 引用卡片只能写成方括号+卡片编号（如 [D4]、[F2]）；其他材料里的数字直接写，禁止发明任何别的方括号标记（如 [TS]）。'

/** 有时间线时的责任归因规则：队友先崩时本人不背全队的锅，但不推翻整局判定 */
const TIMELINE_BLAME_RULE =
  '- 「责任归因」必须结合【队友状况】与【团队处境】：队友先崩或多人对线大幅落后时，要写清本人有多少是被连累（措辞参考"被连累"立场），不能把全队的问题算在本人头上；但不得推翻整局判定的 label——label 为犯罪/缚地灵时仍要指出本人的问题。'

/** 有时间线时附在「责任归因」描述后的引用要求 */
const TIMELINE_BLAME_CITE = '（必须引用【团队处境】里的至少一个数字）'

/** 队友对线落后多少经济以上才点名（严格大于） */
const LANE_BEHIND_THRESHOLD = 1500

/** 有对线意义的分路值（UNKNOWN/'' 等一律视为无对位） */
const LANE_POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])

/** 差值绝对值小于该值视为持平 */
const TIE_EPSILON = 0.05

/** 对位对比项：[字段, 中文名, 是否百分比, 差值小数位] */
const COMPARE_FIELDS: Array<[string, string, boolean, number]> = [
  ['damageShare', '伤害占比', true, 1],
  ['goldShare', '经济占比', true, 1],
  ['kda', 'KDA', false, 2],
  ['csm', '每分钟补刀', false, 1]
]

/**
 * 【对位对比】：目标 vs 对位逐项算好方向与差值，模型照抄（真机：模型把经济占比
 * 27.7% vs 20.1% 写成"仅 27.7%、装备慢了一个版本"，大小比反）
 * @param me - 目标玩家快照行
 * @param opp - 对位玩家快照行
 * @returns 如「- 伤害占比 30.2% vs 13.8%：高 16.4 个百分点」，字段缺失的项跳过
 */
function laneCompareBlock(me: Record<string, unknown>, opp: Record<string, unknown>): string {
  const lines = COMPARE_FIELDS.flatMap(([key, cn, percent, digits]) => {
    const a = me[key]
    const b = opp[key]
    if (typeof a !== 'number' || typeof b !== 'number') return []
    const diff = a - b
    const unit = percent ? '%' : ''
    const head = `${cn} ${a}${unit} vs ${b}${unit}`
    if (Math.abs(diff) < TIE_EPSILON) return [`- ${head}：持平`]
    const mag = Number(Math.abs(diff).toFixed(digits))
    return [`- ${head}：${diff > 0 ? '高' : '低'} ${mag}${percent ? ' 个百分点' : ''}`]
  })
  if (lines.length === 0) return ''
  return `
【对位对比（系统已算好，照抄结论，禁止自行比较大小）】（前者为目标玩家，后者为对位玩家）
${lines.join('\n')}
`
}

/**
 * 14 分钟对位经济的文字表述：用「领先/落后」代替带正负号的数字，避免模型把 +2283 读成落后
 * @param diff - 对位经济差（正数=领先，负数=落后，0=持平）
 */
const laneEconText = (diff: number): string => {
  if (diff > 0) return `14分钟对位经济领先 ${diff}`
  if (diff < 0) return `14分钟对位经济落后 ${-diff}`
  return '14分钟与对位经济持平'
}

/** 【队友状况】：同队队友（不含目标）按 participantId 一人一行 */
function teammateBlock(
  mates: any[],
  snapshot: MatchSnapshot,
  attribution: AttributionResult
): string {
  if (mates.length === 0) return ''
  const hasLanes = snapshot.modeContext.hasLanes
  const ctx = snapshot.timeline?.teamContext
  const lines = mates.map(p => {
    const parts = [p.name, p.champion]
    if (hasLanes) parts.push(p.teamPosition)
    parts.push(`KDA ${p.kills}/${p.deaths}/${p.assists}`)
    parts.push(`经济占比 ${p.goldShare}%`)
    const label = attribution.verdicts.find(v => v.participantId === p.participantId)?.label
    if (label) parts.push(`整局判定 ${label}`)
    const diff = ctx?.[p.participantId]?.laneGoldDiff14
    if (hasLanes && diff != null) parts.push(laneEconText(diff))
    return `- ${parts.join('｜')}`
  })
  return `
【队友状况】（系统预先算好的事实）
${lines.join('\n')}
`
}

/**
 * 【团队处境】：目标的阵亡中有多少发生在队友先崩之后；有分路时点名对线大幅落后的队友
 * @param lcuDeaths - 目标的战绩死亡数（与【目标玩家】快照一致；时间线死亡数口径可能不同，故不用）
 */
function teamSituationBlock(
  mates: any[],
  snapshot: MatchSnapshot,
  participantId: number,
  lcuDeaths: number | undefined
): string {
  const ctx = snapshot.timeline?.teamContext
  const mine = ctx?.[participantId]
  if (!mine) return ''
  const lines = [
    `- 你阵亡 ${lcuDeaths ?? mine.deaths} 次，其中 ${mine.deathsAfterTeammatesDown} 次发生在 ≥2 名队友已先阵亡（30 秒内）之后`
  ]
  if (snapshot.modeContext.hasLanes) {
    const behind = mates.flatMap(p => {
      const diff = ctx?.[p.participantId]?.laneGoldDiff14
      return diff != null && diff < -LANE_BEHIND_THRESHOLD ? [`${p.name}（落后 ${-diff}）`] : []
    })
    if (behind.length > 0) {
      lines.push(
        `- 队友中 ${behind.length} 人 14 分钟对线落后超过 ${LANE_BEHIND_THRESHOLD} 经济：${behind.join('、')}`
      )
    }
  }
  return `
【团队处境】
${lines.join('\n')}
`
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
  vocabSamples: string[],
  extraMaterial?: string
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
  const compareBlock = targetPlayer && opponent ? laneCompareBlock(targetPlayer, opponent) : ''

  const targetVerdict = attribution.verdicts.find(v => v.participantId === participantId)
  const verdictBlock = targetVerdict
    ? JSON.stringify(targetVerdict)
    : '该玩家未被列入整局归因（表现不在整局关键点名单里，属正常情况）。'

  const targetBrief = attribution.scores?.[participantId]
  const cardsForScore = snapshot.timeline?.cards
  const scoreBlock =
    targetBrief && targetPlayer
      ? renderScoreBlock(
          [{ name: targetPlayer.name, brief: targetBrief }],
          cardsForScore?.length
            ? new Set(selectCards(cardsForScore, { mode: 'player', participantId }).map(c => c.id))
            : null
        )
      : ''

  const vocabHint =
    vocabSamples.length > 0
      ? `【词库提示】（可采用、可创造新词）\n${vocabSamples.join('、')}`
      : `【词库提示】\n本次无固定词库，自由发挥，但保持网感与梗感。`

  const cards = snapshot.timeline?.cards
  const hasTimeline = !!cards?.length
  const timelineBlock = hasTimeline
    ? `
【时间线事实卡片】（系统从官方时间线预先算好的事实，引用时写编号；F 卡里的"缺席"也可用于建议）
${renderCardLines(selectCards(cards!, { mode: 'player', participantId }))}
`
    : ''
  const mates = targetPlayer
    ? players.filter(p => p.teamId === targetPlayer.teamId && p.participantId !== participantId)
    : []
  mates.sort((a, b) => a.participantId - b.participantId)
  const teamSituation = hasTimeline
    ? teamSituationBlock(mates, snapshot, participantId, targetPlayer?.deaths)
    : ''
  const teamBlock = hasTimeline ? teammateBlock(mates, snapshot, attribution) + teamSituation : ''
  const rawBlock = extraMaterial
    ? `
【本人关键时刻原始事件】（仅供参考，引用时仍须标卡片编号）
${extraMaterial}
`
    : ''
  const keyMomentsSection = hasTimeline
    ? `
## 关键时刻
- 3-5 条，按时间排序，每条以卡片编号开头，如「- [D2] 14:32 在小龙坑被皇子+妖姬集火……」，时间与数字照抄卡片
`
    : ''

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
${compareBlock}
【整局归因中的判定】
${verdictBlock}${scoreBlock ? `\n${scoreBlock}` : ''}
${timelineBlock}${teamBlock}${rawBlock}
【输出严格按下面 markdown 模板，章节顺序与标题不可改】

## 一句话定档
{一句话给目标玩家本局定性：carry / 合格 / 拖后腿，要有梗感}

## 数据面板解读
- 3-4 条 bullet，逐项解读目标玩家最突出的数字（好坏都要说），每条带数字
${keyMomentsSection}
## 对位对比
${
  compareBlock
    ? '- 逐条照抄【对位对比】的结论（数字、高/低/持平、差值都不得改），可加锐评修辞，谁压谁一目了然'
    : `- 与对位玩家的关键数字对比（KDA/伤害占比/经济/补刀），谁压谁一目了然
- 无对位数据时写"无同位对位数据，跳过对比"`
}

## 责任归因
{结合整局胜负因果与目标玩家的判定，说清这局的锅/功有多少在他；判定的 label 与 finalCall
是结论基准，不得推翻——label 为"正常"时本段结论必须是中性（既不定罪也不吹捧），
只许描述数字事实；未列入归因时基于快照数据独立判断}${teamSituation ? TIMELINE_BLAME_CITE : ''}

## 改进建议
- 2-3 条针对目标玩家的可执行改进建议，必须建立在上面的数字证据上；
${hasTimeline ? '  每条必须以卡片编号结尾（如「……[F3]」），只谈操作/决策/团战取舍/资源节奏' : '  只谈操作/决策/团战取舍/资源节奏，不谈出装'}

【硬规则（违反任意一条即为废稿）】
${scoreBlock ? `${PLAYER_SCORE_RULE}\n` : ''}- 玩家的分路、英雄、胜负方只能照抄材料，禁止写材料之外的分路或英雄定位。
- **每个数字只能写在它的主人名下**：事实卡每行开头的英雄名就是该行数字的主人，【对位玩家】的数字属于对位玩家，【双方队伍】的数字属于对应的一方。把别人的数字写成目标玩家的（或反过来）即为废稿。
- 数字证据只能来自上面的材料，不能编造新数字；禁止做材料里没有字段支撑的数据性比较或断言${hasTimeline ? '（击杀归属与时间点只能来自卡片）' : NO_TIMELINE_NUMBER_NOTE}。
${hasTimeline ? TIMELINE_EQUIP_RULE : NO_TIMELINE_EQUIP_RULE}
${compareBlock ? '- 「对位对比」一节只能照抄【对位对比】里的结论，禁止自行比较大小、另算差值或改写方向（如把"高"写成"仅"）。\n' : ''}- 材料字段值为 null 表示无数据（如国服战绩不下发视野数据），禁止当 0 解读、禁止据此评价。
${
  hasTimeline
    ? `${TIMELINE_PROCESS_RULE}${teamSituation ? `\n${TIMELINE_BLAME_RULE}` : ''}`
    : NO_TIMELINE_PROCESS_RULE
}
- 目标玩家是打野时补刀低、是辅助时伤害占比/经济占比低，都不构成负面证据（位置本分），不要据此定档。
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
