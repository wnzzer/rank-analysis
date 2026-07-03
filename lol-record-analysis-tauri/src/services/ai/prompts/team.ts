/**
 * 游戏中（对局前/对局中）整队分析 Prompt
 * 数据抽取逻辑复用 ../player-insight.ts
 */

import { extractPlayerInsight } from '../player-insight'
import { buildNoteBrief } from '../shared/noteBrief'

interface SessionDataLike {
  typeCn?: string
  isMultiTeam?: boolean
  mySubteamId?: number
  subteams?: Array<{ subteamId: number; players: any[] }>
}

/**
 * 构建整队分析 prompt
 * @param sessionData - 对局会话数据（subteams 统一模型）
 * @param opts.useNotes - 是否注入使用者手动备注（隐私开关，默认 false，fail-closed）
 */
export function buildTeamAnalysisPrompt(
  sessionData: SessionDataLike,
  opts: { useNotes?: boolean } = {}
): string {
  const isMulti = !!sessionData.isMultiTeam
  const mySubteamId = sessionData.mySubteamId ?? 0
  const subteams = sessionData.subteams ?? []
  const useNotes = opts.useNotes === true

  const blocks = subteams.map(st => {
    const detailed = st.subteamId === mySubteamId
    const playersInfo = st.players.map(p =>
      extractPlayerInsight(p, {
        detailed,
        noteBrief: useNotes ? buildNoteBrief(p.summoner?.puuid ?? '') : undefined
      })
    )
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

  const oppLabel = isMulti ? '其它小队' : '对面'

  return `${prelude}

${blocks.join('\n\n')}

===== 输出要求 =====
基于上面的数据，给一份**对开局有用**的速读分析（总长控制在 ~400 字内）。
严格按下面 markdown 模板，章节标题与顺序不可改；每条要点用
\`- 名字：一句话判断 — 数字依据\` 的格式，数字必须来自上面的数据
（胜率 / KDA / 伤害占比 / 参团率 / 英雄胜率与场次等），不要编造新数字。
玩家数据里的 userNote 字段是使用者对该玩家的主观历史备注（[色档] 文本），
仅供参考，不作为事实依据。

## 一句话判断
{一句话点明这局关键看点：哪边阵容/状态更稳、该围绕谁打。要有网感、别空泛}

## 优势点
- {我方值得依靠的点：状态好 / 英雄熟练 / 正面标签的玩家，带数字}
- 没有明显亮点时写"我方无明显强点，得靠运营和团队"

## 风险点
- {我方隐患：状态差 / 在补位 / 英雄不熟 / 负面标签的玩家，带数字}
- 没有明显隐患时写"我方无明显短板"

## 重点盯防
- {${oppLabel}最该提防的玩家或英雄：状态火热 / 高威胁，带数字}
- 信息不足时给基于位置/英雄的常识性提醒（用"通常"软化）

## 建议
- 3 条以内，针对上面的优势/风险/盯防给出**可执行**的打法或心态建议

【语气】像懂哥开黑前的速读：简洁、戏谑、有梗；不辱骂、不地域黑、不人身攻击；
只用给定数据里的数字，缺数据就说"数据不足"而不是编。`
}

export { buildPlayerAnalysisPrompt } from './team-player'
