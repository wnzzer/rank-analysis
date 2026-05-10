/**
 * 单玩家深度分析 Prompt（从 team.ts 拆出）
 */

import { extractPlayerDeepDive } from '../player-insight'

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
- 异常表现分析
- 可能的代练/摆子迹象

【输出格式】
用简洁的要点形式，每个要点用•开头。重要信息用【】标注。正面标签用✅，负面标签用⚠️。`
}
