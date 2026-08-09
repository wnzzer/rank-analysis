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

/**
 * 构建选人期阵容分析 prompt
 * @param sessionData - 对局会话数据（subteams 统一模型，需带 champSelect 结构化视图）
 * @param opggMode - OP.GG 数据模式（ranked/aram），决定是否有分路克制数据
 * @returns 可直接喂给 requestAIContentStream 的 prompt 字符串
 */
export async function buildChampSelectPrompt(
  sessionData: SessionData,
  opggMode: OpggMode
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

${PATCH_NOTES_SECTION_HEADER}
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
