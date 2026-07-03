/**
 * 单玩家深度分析 Prompt（从 team.ts 拆出）
 */

import { extractPlayerDeepDive } from '../player-insight'
import { buildNoteBrief } from '../shared/noteBrief'

/**
 * 构建单玩家深度分析 prompt
 * @param player - 会话玩家对象（SessionSummoner 形状）
 * @param opts.useNotes - 是否注入使用者手动备注（隐私开关，默认 true）
 */
export function buildPlayerAnalysisPrompt(player: any, opts: { useNotes?: boolean } = {}): string {
  const noteBrief =
    opts.useNotes !== false ? buildNoteBrief(player.summoner?.puuid ?? '') : undefined
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
${noteSection}
【最近15场详细战绩】
${JSON.stringify(detailedGames, null, 2)}

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
