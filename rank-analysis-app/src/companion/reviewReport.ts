import type { Badge, JudgePlayer, JudgeResult } from './judges'

export interface ReviewReportPayload {
  player: JudgePlayer
  badges?: Badge[]
  judges?: JudgeResult[]
  queueName?: string
}

/**
 * 将赛后表现量化数据格式化为适合在游戏聊天室、开黑群（QQ/微信/KOOK/Discord）分享的纯文本战报。
 */
export function formatReviewReport(payload: ReviewReportPayload): string {
  const { player, badges = [], judges = [], queueName } = payload
  const outcome = player.win ? '胜利 🏆' : '惜败 💔'
  const kdaRatio =
    player.deaths === 0 ? 'PERFECT' : ((player.kills + player.assists) / player.deaths).toFixed(2)
  const kda = `${player.kills}/${player.deaths}/${player.assists} (KDA ${kdaRatio})`
  const dmg = (player.damageDealt / 1000).toFixed(1)
  const taken = (player.damageTaken / 1000).toFixed(1)

  const header = queueName ? `【Rank Analysis · ${queueName}战报】` : `【Rank Analysis 对局战报】`

  const lines: string[] = [
    header,
    `玩家：${player.name} · ${player.championName || '未知英雄'} · ${outcome}`,
    `数据：${kda} · 伤害 ${dmg}k · 承伤 ${taken}k`
  ]

  if (badges.length > 0) {
    const badgeText = badges.map(b => `${b.tier === 'gold' ? '🥇' : '🥈'} ${b.label}`).join('、')
    lines.push(`徽章：${badgeText}`)
  } else {
    lines.push(`徽章：稳扎稳打（稳定发挥）`)
  }

  if (judges.length > 0) {
    lines.push('AI 裁判点评：')
    for (const j of judges) {
      lines.push(`• ${j.label}：${j.text}`)
    }
  }

  return lines.join('\n')
}
