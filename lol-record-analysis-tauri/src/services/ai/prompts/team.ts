/**
 * 游戏中（对局前/对局中）整队分析 Prompt
 * 数据抽取逻辑复用 ../player-insight.ts
 */

import { extractPlayerInsight } from '../player-insight'

interface SessionDataLike {
  typeCn?: string
  isMultiTeam?: boolean
  mySubteamId?: number
  subteams?: Array<{ subteamId: number; players: any[] }>
}

export function buildTeamAnalysisPrompt(sessionData: SessionDataLike): string {
  const isMulti = !!sessionData.isMultiTeam
  const mySubteamId = sessionData.mySubteamId ?? 0
  const subteams = sessionData.subteams ?? []

  const blocks = subteams.map(st => {
    const detailed = st.subteamId === mySubteamId
    const playersInfo = st.players.map(p => extractPlayerInsight(p, { detailed }))
    const label = isMulti
      ? `队伍 ${st.subteamId}${st.subteamId === mySubteamId ? '（我方）' : ''}`
      : st.subteamId === mySubteamId
        ? '我方队伍'
        : '敌方队伍'
    return `【${label}数据】\n${JSON.stringify(playersInfo, null, 2)}`
  })

  const prelude = isMulti
    ? `你是LOL资深分析师，本局为 ${subteams.length} 队混战（${sessionData.typeCn || '未知'}），请详细分析这局比赛：`
    : `你是LOL资深分析师，请从以下三个维度详细分析这局比赛：\n\n【对局信息】\n模式：${sessionData.typeCn || '未知'}`

  return `${prelude}

${blocks.join('\n\n')}

===== 请按以下结构分析（共300-400字）=====

一、阵容分析（80-100字）
- ${isMulti ? '我方小队的英雄定位与组合优势' : '双方阵容特点（控制、输出、前排等）'}
- ${isMulti ? '相对其它小队的强弱判断' : '阵容优劣势对比'}
- 关键英雄作用

二、英雄熟练度与位置分析（100-120字）
- 每个玩家当前英雄 vs 常玩英雄对比
- ${isMulti ? '搭档配合度分析（仅适用于我方小队）' : '位置熟练度判断（是否拿手位置）'}
- 英雄池深度分析

三、标签分析与战绩详情（120-180字）
针对有标签的玩家，详细分析：
- 标签产生原因
- 从最近战绩验证标签准确性
- 该玩家对本局的影响（正面大腿/负面隐患）
- 是否存在数据异常

【输出格式】
用简洁的要点形式，每个要点用•开头。重要信息用【】标注。正面标签用✅，负面标签用⚠️。`
}

export { buildPlayerAnalysisPrompt } from './team-player'
