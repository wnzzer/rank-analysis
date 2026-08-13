/**
 * 选人阶段（ChampSelect）AI 阵容分析 Prompt
 *
 * 与 team.ts（对局中/赛后整队分析）的关键区别：
 * - 我方：puuid/战绩齐全，画像复用 extractPlayerInsight，但选人期只取核心字段
 *   （名字/段位/近期胜率/KDA/主玩位置/常用英雄 top3）。isOffRole 判定依赖
 *   shared/recentProfile.ts 的 buildRecentProfile()，需要 teamPosition 形状的原始
 *   对局数据，与 extractPlayerInsight 消费的 matchHistory.games.games 形状不同；
 *   选人期这层不做二次转换，故略去该字段（取舍：宁可少一个字段，不引入重复的画像抽取逻辑）。
 * - 敌方：选人期只有英雄 id + pickState，没有玩家身份，只能靠 OP.GG 静态数据
 *   （T 级/胜率/克制关系）撑情报，不能像 team.ts 那样输出玩家战绩画像。
 */

import { extractPlayerInsight } from '../player-insight'
import { getChampionName } from '../champion-names'
import { getChampionMeta, getLaneCounters, findCounterHints } from '@renderer/services/opgg'
import { buildPatchNotesBlock, PATCH_NOTES_SECTION_HEADER } from './shared/patchNotes'
import type { BpDecision } from '@renderer/types/bpDecision'
import type { LineupScore } from '@renderer/services/lineupScore'
import {
  LANE_RULE_CHAMP_SELECT,
  metricNameRule,
  RULE_NO_FABRICATED_MECHANICS,
  RULE_NO_ROLE_TAGS,
  RULE_SIDE_PREFIX,
  RULE_TOP_CHAMPS_NOT_CURRENT
} from './shared/discipline'
import {
  assignedPositionSegment,
  counterHintText,
  positionSegment,
  tierLabel
} from './shared/opggIntel'
import type { OpggMode, LaneCounter } from '@renderer/services/opgg'
import type { SessionData, SessionSummoner } from '@renderer/types/domain/gaming'

/** 会话级 stage → 中文，需与 Gaming.vue 的 STAGE_STEPS 保持一致 */
const STAGE_CN: Record<string, string> = {
  planning: '预选',
  banning: '禁用',
  picking: '选人',
  finalization: '确认'
}

function stageLabel(stage: string | undefined): string {
  return (stage && STAGE_CN[stage]) || '未知'
}

/** ban 列表 → 英雄名字串，空列表显示"无" */
function banListText(ids: number[]): string {
  return ids.length > 0 ? ids.map(id => getChampionName(id)).join('、') : '无'
}

/** 规则引擎决策 → 事实块文本（确定性，AI 只解释） */
function bpDecisionText(d: BpDecision | null): string {
  if (!d) return '暂无可执行的目标。'
  const actionCn = d.action_type === 'Ban' ? '禁用' : '选用'
  if (!d.target) {
    return `无待执行动作（${actionCn}）。`
  }
  const champName = getChampionName(d.target.champion_id)
  const originText =
    d.target.origin.type === 'Rule'
      ? `命中规则「${d.target.origin.rule_name}」`
      : `兜底推荐（池内 ${d.target.origin.pool_size} 个候选）`
  const evidenceText = d.target.evidence
    ? `；对位 ${getChampionName(d.target.evidence.against_champion_id)} 胜率 ${(d.target.evidence.win_rate * 100).toFixed(0)}%（该选择有已知被克制风险）`
    : ''
  const modeText = d.mode === 'Auto' ? '（自动化执行中）' : '（仅建议，未自动执行）'
  return `${actionCn} ${champName}：${originText}${evidenceText}${modeText}`
}

/** 阵容强度分 → 事实块文本（确定性，AI 只引用） */
function lineupText(mine: LineupScore, enemy: LineupScore): string {
  const side = (s: LineupScore, label: string): string => {
    if (s.score === null) return `${label}暂无数据`
    const tierText = s.bestTier !== null ? `，最好 T${s.bestTier}` : ''
    return `${label}${s.score} 分（${s.covered}/${s.total} 英雄有数据${tierText}）`
  }
  return `${side(mine, '我方')} vs ${side(enemy, '敌方')}`
}

/** 我方玩家一行的核心画像摘要（选人期精简版，字段取舍见文件头注释） */
function myPlayerLine(p: SessionSummoner): string {
  const insight = extractPlayerInsight(p, { detailed: false })
  const champLabel =
    p.championId > 0
      ? `${getChampionName(p.championId)}${p.pickState !== 'locked' ? '（未锁定）' : ''}`
      : '未选'
  const topChampsText =
    insight.topChampions
      .slice(0, 3)
      .map(
        (c: { champion: string; winRate: number; games: number }) =>
          `${c.champion}(${c.winRate}%/${c.games}场)`
      )
      .join('、') || '无近期数据'
  return `- ${insight.name}（${insight.tier}）本局：${champLabel}${assignedPositionSegment(p.assignedPosition)}｜近期胜率 ${insight.recentStats.winRate}% KDA ${insight.recentStats.kda}｜主打位置 ${insight.mainPosition}｜常用：${topChampsText}`
}

/** 选人期 prompt 额外确定性事实（缺省均为 null，此时不写对应小节） */
export interface ChampSelectPromptExtras {
  /** 规则引擎决策快照（useBpDecision 输出） */
  bpDecision?: BpDecision | null
  /** 双方阵容强度分（确定性计算，lineupScore.ts） */
  lineup?: { mine: LineupScore; enemy: LineupScore } | null
}

/**
 * 构建选人期阵容分析 prompt
 * @param sessionData - 对局会话数据（subteams 统一模型，需带 champSelect 结构化视图）
 * @param opggMode - OP.GG 数据模式（ranked/aram），决定是否有分路克制数据
 * @param extras - 确定性事实注入（规则引擎决策 + 阵容强度分），AI 只解释不推翻
 * @returns 可直接喂给 requestAIContentStream 的 prompt 字符串
 */
export async function buildChampSelectPrompt(
  sessionData: SessionData,
  opggMode: OpggMode,
  extras: ChampSelectPromptExtras = {}
): Promise<string> {
  const mySubteamId = sessionData.mySubteamId ?? 0
  const subteams = sessionData.subteams ?? []
  const myTeam = subteams.find(s => s.subteamId === mySubteamId)
  const myPlayers = myTeam?.players ?? []
  const enemyPlayers = subteams.filter(s => s.subteamId !== mySubteamId).flatMap(s => s.players)

  const myChampionIds = myPlayers.map(p => p.championId).filter(id => id > 0)
  const revealedEnemies = enemyPlayers.filter(p => p.championId > 0)
  const hiddenCount = enemyPlayers.length - revealedEnemies.length

  // 我方是否已全部锁定：每个我方玩家都已选英雄(championId>0)且 pickState 为 locked。
  // 用于决定分析纪律里能不能给"选/抢/换英雄"类建议——已经锁定的选人建议是幻觉的重灾区。
  const allMyLocked =
    myPlayers.length > 0 && myPlayers.every(p => p.championId > 0 && p.pickState === 'locked')
  const picksSettled = allMyLocked || sessionData.champSelect?.stage === 'finalization'
  const suggestionDiscipline = picksSettled
    ? '当前所有选择已锁定：禁止给出任何选英雄/抢英雄/换英雄类建议，只允许给对局执行层面的建议（对线思路/资源决策/注意事项）'
    : '选人尚未结束，可以给选人建议，但只能针对我方尚未锁定的位置'
  // 输出模板里的建议示例词必须与上面的纪律同频——锁定后模板再出现「选人」示例会诱导幻觉
  const suggestionTemplateLine = picksSettled
    ? '- 2-3 条面向对局执行的建议（对线思路/资源决策/团战注意事项）'
    : '- 2-3 条针对当前 BP 阶段可执行的建议（选人/克制/资源分配）'

  const myBans = sessionData.champSelect?.myBans ?? []
  const theirBans = sessionData.champSelect?.theirBans ?? []

  const myBlock =
    myPlayers.length > 0 ? myPlayers.map(myPlayerLine).join('\n') : '（我方数据暂未到位）'

  let enemyBlock: string
  if (enemyPlayers.length === 0) {
    // 大乱斗类随机英雄模式，选人期敌方队伍不可见（后端不下发敌方 subteam）
    enemyBlock = '本模式选人期敌方不可见（随机英雄类模式，选人阶段无法获取敌方英雄信息）。'
  } else if (revealedEnemies.length === 0) {
    enemyBlock = `敌方 ${enemyPlayers.length} 人均未亮出英雄，暂无情报。`
  } else {
    const uniqueEnemyIds = Array.from(new Set(revealedEnemies.map(p => p.championId)))
    const metaEntries = await Promise.all(
      uniqueEnemyIds.map(async id => [id, await getChampionMeta(opggMode, id)] as const)
    )
    const metaById = new Map(metaEntries)

    // 分路克制关系仅 ranked 模式有数据，且需要我方已亮出至少一个英雄才有比较意义
    let countersByChampion: Record<number, LaneCounter[]> = {}
    if (opggMode === 'ranked' && myChampionIds.length > 0) {
      countersByChampion = await getLaneCounters(opggMode, [...uniqueEnemyIds, ...myChampionIds])
    }

    const lines = revealedEnemies.map(p => {
      const meta = metaById.get(p.championId) ?? null
      const name = getChampionName(p.championId)
      const winRateText = meta?.winRate ? `${(meta.winRate * 100).toFixed(1)}%` : '--'
      const hints =
        opggMode === 'ranked' && myChampionIds.length > 0
          ? findCounterHints(p.championId, myChampionIds, countersByChampion)
          : []
      const hintText =
        hints.length > 0
          ? '｜' + hints.map(h => counterHintText(h.myWinRate, h.myChampionId)).join('，')
          : ''
      return `- ${name}${positionSegment(meta?.position)}｜${tierLabel(meta?.tier)}/胜率${winRateText}${hintText}`
    })
    if (hiddenCount > 0) {
      lines.push(`- 其余 ${hiddenCount} 人未亮出`)
    }
    enemyBlock = lines.join('\n')
  }

  // ranked 有分路对线概念，aram/其它模式没有，用「关键威胁」代替「关键对线」
  const laneSectionTitle = opggMode === 'ranked' ? '关键对线' : '关键威胁'

  // 本局双方英雄的国服版本改动（我方在前，与上文块顺序一致；未亮出的敌方自然缺席）
  const patchNotesBlock = await buildPatchNotesBlock([
    ...myPlayers
      .filter(p => p.championId > 0)
      .map(p => ({ side: '我方', championId: p.championId })),
    ...revealedEnemies.map(p => ({ side: '敌方', championId: p.championId }))
  ])

  // 确定性事实块：规则引擎决策 + 阵容强度分（D-P2 选人期 tab）。有才写，没有不写——
  // 宁缺毋滥，避免喂给模型一堆空壳小节诱导编造。纪律衍生行跟着事实块走，
  // 避免"未被引用的事实规则"常驻 prompt 造成噪音。
  const factsBlocks: string[] = []
  if (extras.bpDecision) {
    factsBlocks.push(`【规则引擎决策】\n${bpDecisionText(extras.bpDecision)}`)
  }
  if (extras.lineup && (extras.lineup.mine.score !== null || extras.lineup.enemy.score !== null)) {
    factsBlocks.push(
      `【阵容强度（确定性计算，只可引用）】\n${lineupText(extras.lineup.mine, extras.lineup.enemy)}`
    )
  }
  const factsSection =
    factsBlocks.length > 0
      ? `${factsBlocks.join('\n\n')}\n\n- 【规则引擎决策】与【阵容强度】是确定性事实：禁止给出与之冲突的 ban/pick 目标，禁止改写分数或自创其他强度数值；只能引用并解释。\n\n`
      : ''

  return `你是LOL资深分析师，现在是选人阶段，请基于以下信息给出速读分析：

【对局】
模式：${sessionData.typeCn || '未知'}
阶段：${stageLabel(sessionData.champSelect?.stage)}
我方禁用：${banListText(myBans)}
敌方禁用：${banListText(theirBans)}

【我方】
${myBlock}

【敌方情报】
${enemyBlock}

${factsSection}${PATCH_NOTES_SECTION_HEADER}
${patchNotesBlock}

===== 分析纪律（硬规则，必须遵守）=====
- 敌方只有英雄没有玩家身份，禁止臆测敌方玩家的水平、段位或操作习惯。
- ${RULE_TOP_CHAMPS_NOT_CURRENT}
- ${RULE_NO_FABRICATED_MECHANICS}
- "补位"仅指位置状态（本局位置偏离主玩位置），不代表水平高低；禁止生造"XX流"之类的术语。
- ${suggestionDiscipline}
- ${metricNameRule('我方玩家"常用"括号里的胜率/场次')}
- ${RULE_NO_ROLE_TAGS}
- ${LANE_RULE_CHAMP_SELECT}
- ${RULE_SIDE_PREFIX}

===== 输出要求 =====
给一份约 250 字的速读分析，严格按下面 markdown 模板，章节标题与顺序不可改：

## 阵容对比
{一两句话点出双方阵容强弱/风格差异，基于上面给出的数据}

## ${laneSectionTitle}
{结合敌方英雄的 T 级/胜率/克制关系与本版本改动，指出我方最该注意的点；信息不足就说"数据不足"}

## 给我方的建议
${suggestionTemplateLine}

【语气】像懂哥开黑前的速读：简洁、戏谑、有梗；不辱骂、不地域黑、不人身攻击；
只用给定数据里的数字，缺数据就说"数据不足"而不是编。`
}
