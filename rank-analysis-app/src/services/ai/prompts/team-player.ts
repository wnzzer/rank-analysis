/**
 * 单玩家深度分析 Prompt（从 team.ts 拆出）
 */

import { extractPlayerDeepDive } from '../player-insight'
import { buildNoteBrief } from '../shared/noteBrief'
import { getChampionName } from '../champion-names'
import { getChampionPatchNote } from '@renderer/services/patchNotes'
import { assignedPositionCn } from './shared/opggIntel'
import { DIRECTION_CN } from './shared/patchNotes'

/**
 * 构建单玩家深度分析 prompt
 * @param player - 会话玩家对象（SessionSummoner 形状）
 * @param opts.useNotes - 是否注入使用者手动备注（隐私开关，默认 false，fail-closed）
 */
export async function buildPlayerAnalysisPrompt(
  player: any,
  opts: { useNotes?: boolean } = {}
): Promise<string> {
  const noteBrief =
    opts.useNotes === true ? buildNoteBrief(player.summoner?.puuid ?? '') : undefined
  const noteSection = noteBrief
    ? `\n【使用者备注】\n${noteBrief}\n（使用者对该玩家的主观历史备注（[色档] 文本），仅供参考，不作为事实依据）\n`
    : ''
  const tags = player.userTag?.tag || []
  const recent = player.userTag?.recentData
  const winRate =
    recent?.selectWins && recent?.selectLosses
      ? Math.round((recent.selectWins / (recent.selectWins + recent.selectLosses)) * 100)
      : 0

  const { topChampions, positionStats, detailedGames } = extractPlayerDeepDive(player)

  // 本局上下文：英雄 + 权威分路 + 该英雄本版本改动
  const championId: number = player.championId ?? 0
  const currentChampion = championId > 0 ? getChampionName(championId) : '未知'
  const laneCn = assignedPositionCn(player.assignedPosition)
  const patchNote = championId > 0 ? await getChampionPatchNote(championId) : null
  const patchNoteLine = patchNote
    ? `本局英雄本版本改动（国服公告，机制引用唯一合法来源）：${DIRECTION_CN[patchNote.direction]}：${patchNote.lines.join('；')}`
    : '本局英雄本版本无官方改动。'

  return `你是LOL资深分析师，请详细分析这个玩家：

【玩家基本信息】
名称：${player.summoner?.gameName || '未知'} #${player.summoner?.tagLine}
等级：${player.summoner?.summonerLevel}
段位：${player.rank?.queueMap?.RANKED_SOLO_5x5?.tierCn || '无'}
本局英雄：${currentChampion}
本局分路：${laneCn || '无（该模式无分路概念或未获取）'}
${patchNoteLine}

【近期统计】
模式：${recent?.selectModeCn || '未知'}
胜率：${recent?.selectWins || 0}胜${recent?.selectLosses || 0}负 (${winRate}%)
KDA：${recent?.kda?.toFixed(2) || 0}
场均：${recent?.kills?.toFixed(1) || 0}/${recent?.deaths?.toFixed(1) || 0}/${recent?.assists?.toFixed(1) || 0}
参团率：${recent?.groupRate || 0}%
伤害占比：${recent?.damageDealtToChampionsRate || 0}%

【英雄熟练度】
${JSON.stringify(topChampions)}

【位置分布】
${JSON.stringify(positionStats)}

【标签列表】
${tags.length > 0 ? tags.map((t: any) => `• ${t.tagName}(${t.tagDesc}) - ${t.good ? '正面' : '负面'}`).join('\n') : '无标签'}
${noteSection}
【最近15场详细战绩】
${JSON.stringify(detailedGames)}

===== 分析纪律（硬规则，必须遵守）=====
- 禁止编造英雄的技能、被动机制、连招或数值——材料里没给出的机制信息一律不许提。唯一例外："本局英雄本版本改动"里明确给出的技能名与数值可以原样引用，禁止改写或外推。
- 禁止给英雄贴"坦克/刺客/法师/射手"等职能标签或基于职能下结论——材料未提供职能信息，主分路≠职能。
- 材料里的数字都有明确指标名（胜率/KDA/场均/参团率/伤害占比/英雄场次），禁止使用材料中不存在的指标名，禁止把该玩家个人数据说成英雄版本数据。
- 分路只认材料："本局分路"是权威数据；位置分布是历史统计。本局分路与主玩位置不一致时如实说"补位"，不得引申水平高低。

===== 输出要求 =====
基于上面的数据，给一份这名玩家的速读画像（总长控制在 ~300 字内）。
严格按下面 markdown 模板，章节标题与顺序不可改；每条要点用
\`- 要点：一句话 — 数字依据\` 的格式，数字必须来自上面的数据
（胜率 / KDA / 场均 / 参团率 / 伤害占比 / 英雄胜率与场次等），不要编造新数字。

## 一句话判断
{一句话定位这名玩家这局靠不靠谱：大腿 / 中规中矩 / 隐患。要有网感}

## 优势点
- {强点：拿手英雄 / 高胜率 / 正面标签，带数字}
- 没有明显强点时写"无突出强点"

## 风险点
- {软肋：状态下滑 / 英雄不熟 / 负面标签 / 位置不擅长，带数字}
- 没有明显短板时写"无明显短板"

## 重点盯防
- {最该警惕的点：数据异常 / 代练或摆子迹象 / 关键英雄，带数字}
- 没有异常时写"数据自洽，无明显异常"

## 建议
- 2-3 条：怎么用好他（队友视角）或怎么针对他（对手视角）的可执行建议

【语气】像懂哥开黑前的速读：简洁、戏谑、有梗；不辱骂、不地域黑、不人身攻击；
只用给定数据里的数字，缺数据就说"数据不足"而不是编。`
}
