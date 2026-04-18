/**
 * 游戏中（对局前/对局中）整队分析 Prompt
 * 数据抽取逻辑复用 ../player-insight.ts
 */

import { extractPlayerDeepDive, extractPlayerInsight } from '../player-insight'

export function buildTeamAnalysisPrompt(sessionData: any): string {
  const teamOneInfo = (sessionData.teamOne || []).map((p: any) =>
    extractPlayerInsight(p, { detailed: true })
  )
  const teamTwoInfo = (sessionData.teamTwo || []).map((p: any) =>
    extractPlayerInsight(p, { detailed: false })
  )

  return `你是LOL资深分析师，请从以下三个维度详细分析这局比赛：

【对局信息】
模式：${sessionData.typeCn || '未知'}

【我方队伍数据】
${JSON.stringify(teamOneInfo, null, 2)}

【敌方队伍数据】
${JSON.stringify(teamTwoInfo, null, 2)}

===== 请按以下结构分析（共300-400字）=====

一、阵容分析（80-100字）
- 双方阵容特点（控制、输出、前排等）
- 阵容优劣势对比
- 关键英雄作用

二、英雄熟练度与位置分析（100-120字）
- 每个玩家当前英雄 vs 常玩英雄对比
- 位置熟练度判断（是否拿手位置）
- 英雄池深度分析
- 可能的摇摆位

三、标签分析与战绩详情（120-180字）
针对有标签的玩家，详细分析：
- 标签产生原因（如"3连胜"、"KDA>=6"、"死亡>=10"等）
- 从最近战绩验证标签准确性
- 该玩家对本局的影响（正面大腿/负面隐患）
- 是否存在数据异常（如低KDA却有高胜率等）

【输出格式】
用简洁的要点形式，每个要点用•开头。重要信息用【】标注。正面标签用✅，负面标签用⚠️。`
}

export function buildPlayerAnalysisPrompt(player: any): string {
  const tags = player.userTag?.tag || []
  const recent = player.userTag?.recentData
  const winRate =
    recent?.selectWins && recent?.selectLosses
      ? Math.round((recent.selectWins / (recent.selectWins + recent.selectLosses)) * 100)
      : 0

  const { topChampions, positionStats, detailedGames } = extractPlayerDeepDive(player)

  return `你是LOL资深分析师，请详细分析这个玩家：

【玩家基本信息】
名称：${player.summoner?.gameName || '未知'} #${player.summoner?.tagLine}
等级：${player.summoner?.summonerLevel}
段位：${player.rank?.queueMap?.RANKED_SOLO_5x5?.tierCn || '无'}

【近期统计】
模式：${recent?.selectModeCn || '未知'}
胜率：${recent?.selectWins || 0}胜${recent?.selectLosses || 0}负 (${winRate}%)
KDA：${recent?.kda?.toFixed(2) || 0}
场均：${recent?.kills?.toFixed(1) || 0}/${recent?.deaths?.toFixed(1) || 0}/${recent?.assists?.toFixed(1) || 0}
参团率：${recent?.groupRate || 0}%
伤害占比：${recent?.damageDealtToChampionsRate || 0}%

【英雄熟练度】
${JSON.stringify(topChampions, null, 2)}

【位置分布】
${JSON.stringify(positionStats, null, 2)}

【标签列表】
${tags.length > 0 ? tags.map((t: any) => `• ${t.tagName}(${t.tagDesc}) - ${t.good ? '正面' : '负面'}`).join('\n') : '无标签'}

【最近15场详细战绩】
${JSON.stringify(detailedGames, null, 2)}

===== 请按以下结构分析（共200-250字）=====

一、实力评估（60-80字）
- 整体水平判断
- 位置和英雄熟练度
- 操作习惯特点

二、标签深度分析（80-100字）
针对每个标签：
- 产生原因分析
- 从战绩数据验证
- 标签准确性判断

三、战绩异常检测（40-60字）
- 数据一致性检查
- 异常表现分析（如连胜/连败、KDA异常等）
- 可能的代练/摆子迹象

【输出格式】
用简洁的要点形式，每个要点用•开头。重要信息用【】标注。正面标签用✅，负面标签用⚠️。`
}
