/**
 * 游戏中（对局前/对局中）整队分析 Prompt
 *
 * 数据抽取逻辑复用 ../player-insight.ts；在画像之外补齐会话级关键情报：
 * 本局分路（LCU 权威）/ 预组队标记 / 遇见过的玩家 / 敌方英雄 OP.GG 版本情报 /
 * 本版本英雄改动，并配套选人 prompt 同源的反幻觉纪律区。
 */

import { extractPlayerInsight } from '../player-insight'
import { buildNoteBrief } from '../shared/noteBrief'
import { buildPatchNotesBlock, PATCH_NOTES_SECTION_HEADER } from './shared/patchNotes'
import {
  LANE_RULE_IN_GAME,
  metricNameRule,
  RULE_NO_FABRICATED_MECHANICS,
  RULE_NO_ROLE_TAGS,
  RULE_SIDE_PREFIX,
  RULE_TOP_CHAMPS_NOT_CURRENT
} from './shared/discipline'
import { assignedPositionCn, counterHintText, positionSegment, tierLabel } from './shared/opggIntel'
import { getChampionMeta, getLaneCounters, findCounterHints } from '@renderer/services/opgg'
import { getChampionName } from '../champion-names'
import type { OpggMode, LaneCounter } from '@renderer/services/opgg'

interface SessionPlayerLike {
  championId: number
  summoner?: { puuid?: string; gameName?: string }
  assignedPosition?: string
  preGroupMarkers?: { name?: string }
  meetGames?: Array<{ isMyTeam: boolean; win: boolean }>
}

interface SessionDataLike {
  typeCn?: string
  isMultiTeam?: boolean
  mySubteamId?: number
  subteams?: Array<{ subteamId: number; players: any[] }>
}

/** 敌我前缀：CLASSIC 二分；CHERRY 多队时非我方统称"敌方"（版本改动区块用） */
function sideOf(subteamId: number, mySubteamId: number): string {
  return subteamId === mySubteamId ? '我方' : '敌方'
}

/** 【预组队情报】区块：按 marker name 把双方预组队分组列名单 */
function buildPreGroupBlock(
  subteams: Array<{ subteamId: number; players: SessionPlayerLike[] }>,
  mySubteamId: number
): string {
  const lines: string[] = []
  for (const st of subteams) {
    const groups = new Map<string, string[]>()
    for (const p of st.players) {
      const name = p.preGroupMarkers?.name
      if (!name) continue
      const list = groups.get(name) ?? []
      list.push(p.summoner?.gameName || '未知')
      groups.set(name, list)
    }
    for (const [groupName, members] of groups) {
      if (members.length < 2) continue
      lines.push(`- ${sideOf(st.subteamId, mySubteamId)}：${groupName}（${members.join('、')}）`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : '未检测到预组队。'
}

/** 【遇见过的玩家】区块：与使用者历史同局的玩家（同队/对阵拆分计数） */
function buildMeetGamesBlock(
  subteams: Array<{ subteamId: number; players: SessionPlayerLike[] }>,
  mySubteamId: number
): string {
  const lines: string[] = []
  for (const st of subteams) {
    for (const p of st.players) {
      const meets = p.meetGames ?? []
      if (meets.length === 0) continue
      const sameTeam = meets.filter(m => m.isMyTeam).length
      lines.push(
        `- ${sideOf(st.subteamId, mySubteamId)}${p.summoner?.gameName || '未知'}：遇见过 ${meets.length} 次（同队 ${sameTeam}，对阵 ${meets.length - sameTeam}）`
      )
    }
  }
  return lines.length > 0 ? lines.join('\n') : '本局没有遇见过的玩家。'
}

/**
 * 【敌方英雄版本情报】区块：OP.GG T级/版本胜率/主分路（推测）+ 克制提示。
 * opggMode 未提供（如斗魂等无数据模式）时调用方整块省略。
 */
async function buildEnemyIntelBlock(
  enemyPlayers: SessionPlayerLike[],
  myChampionIds: number[],
  opggMode: OpggMode
): Promise<string> {
  const enemyIds = Array.from(new Set(enemyPlayers.map(p => p.championId).filter(id => id > 0)))
  if (enemyIds.length === 0) return '敌方英雄信息暂未获取。'

  const metaEntries = await Promise.all(
    enemyIds.map(async id => [id, await getChampionMeta(opggMode, id)] as const)
  )
  const metaById = new Map(metaEntries)

  let countersByChampion: Record<number, LaneCounter[]> = {}
  if (opggMode === 'ranked' && myChampionIds.length > 0) {
    countersByChampion = await getLaneCounters(opggMode, [...enemyIds, ...myChampionIds])
  }

  return enemyIds
    .map(id => {
      const meta = metaById.get(id) ?? null
      const winRateText = meta?.winRate ? `${(meta.winRate * 100).toFixed(1)}%` : '--'
      const hints =
        opggMode === 'ranked' && myChampionIds.length > 0
          ? findCounterHints(id, myChampionIds, countersByChampion)
          : []
      const hintText =
        hints.length > 0
          ? '｜' + hints.map(h => counterHintText(h.myWinRate, h.myChampionId)).join('，')
          : ''
      return `- 敌方${getChampionName(id)}｜${tierLabel(meta?.tier)}/胜率${winRateText}${positionSegment(meta?.position)}${hintText}`
    })
    .join('\n')
}

/**
 * 构建整队分析 prompt
 * @param sessionData - 对局会话数据（subteams 统一模型）
 * @param opts.useNotes - 是否注入使用者手动备注（隐私开关，默认 false，fail-closed）
 * @param opts.opggMode - OP.GG 数据模式；未提供时省略敌方英雄版本情报区块
 */
export async function buildTeamAnalysisPrompt(
  sessionData: SessionDataLike,
  opts: { useNotes?: boolean; opggMode?: OpggMode } = {}
): Promise<string> {
  const isMulti = !!sessionData.isMultiTeam
  const mySubteamId = sessionData.mySubteamId ?? 0
  const subteams = sessionData.subteams ?? []
  const useNotes = opts.useNotes === true

  const blocks = subteams.map(st => {
    const detailed = st.subteamId === mySubteamId
    const playersInfo = st.players.map(p => ({
      ...extractPlayerInsight(p, {
        detailed,
        noteBrief: useNotes ? buildNoteBrief(p.summoner?.puuid ?? '') : undefined
      }),
      // 本局分路：LCU 权威数据（选人期 assignedPosition / 对局中 selectedPosition 合一），
      // 无分路模式（大乱斗/斗魂）为空串
      currentLane: assignedPositionCn(p.assignedPosition)
    }))
    const label = isMulti
      ? `队伍 ${st.subteamId}${st.subteamId === mySubteamId ? '（我方）' : ''}`
      : st.subteamId === mySubteamId
        ? '我方队伍'
        : '敌方队伍'
    // 紧凑序列化：整队画像是 prompt 里最大的数据块，去缩进可省 ~1/3 输入 token
    return `【${label}数据】\n${JSON.stringify(playersInfo)}`
  })

  const myPlayers = subteams.find(st => st.subteamId === mySubteamId)?.players ?? []
  const enemyPlayers = subteams.filter(st => st.subteamId !== mySubteamId).flatMap(st => st.players)
  const myChampionIds = myPlayers
    .map((p: SessionPlayerLike) => p.championId)
    .filter((id: number) => id > 0)

  const preGroupBlock = buildPreGroupBlock(subteams, mySubteamId)
  const meetGamesBlock = buildMeetGamesBlock(subteams, mySubteamId)
  const patchNotesBlock = await buildPatchNotesBlock([
    ...myPlayers
      .filter((p: SessionPlayerLike) => p.championId > 0)
      .map((p: SessionPlayerLike) => ({ side: '我方', championId: p.championId })),
    ...enemyPlayers
      .filter((p: SessionPlayerLike) => p.championId > 0)
      .map((p: SessionPlayerLike) => ({ side: '敌方', championId: p.championId }))
  ])
  const enemyIntelBlock = opts.opggMode
    ? `【敌方英雄版本情报】（OP.GG 版本统计；主分路为推测，非本局实际分路）
${await buildEnemyIntelBlock(enemyPlayers, myChampionIds, opts.opggMode)}

`
    : ''

  const prelude = isMulti
    ? `你是LOL资深分析师，本局为 ${subteams.length} 队混战（${sessionData.typeCn || '未知'}），请详细分析这局比赛：`
    : `你是LOL资深分析师，请从以下三个维度详细分析这局比赛：\n\n【对局信息】\n模式：${sessionData.typeCn || '未知'}`

  const oppLabel = isMulti ? '其它小队' : '对面'

  return `${prelude}

${blocks.join('\n\n')}

【预组队情报】（同 name 即同一预组队；开黑队伍配合度显著更高，是开局强情报）
${preGroupBlock}

【遇见过的玩家】（使用者近期与其同局过的玩家）
${meetGamesBlock}

${enemyIntelBlock}${PATCH_NOTES_SECTION_HEADER}
${patchNotesBlock}

===== 分析纪律（硬规则，必须遵守）=====
- ${RULE_SIDE_PREFIX}
- ${LANE_RULE_IN_GAME}
- ${RULE_NO_FABRICATED_MECHANICS}
- ${RULE_NO_ROLE_TAGS}
- ${metricNameRule('玩家画像里的胜率/KDA/场次')}
- ${RULE_TOP_CHAMPS_NOT_CURRENT}
- 玩家数据里的 userNote 是使用者主观历史备注（[色档] 文本），仅供参考，不作为事实依据。

===== 输出要求 =====
基于上面的数据，给一份**对开局有用**的速读分析（总长控制在 ~400 字内）。
严格按下面 markdown 模板，章节标题与顺序不可改；每条要点用
\`- 名字：一句话判断 — 数字依据\` 的格式，数字必须来自上面的数据
（胜率 / KDA / 伤害占比 / 参团率 / 英雄胜率与场次等），不要编造新数字。

## 一句话判断
{一句话点明这局关键看点：哪边阵容/状态更稳、该围绕谁打。要有网感、别空泛}

## 优势点
- {我方值得依靠的点：状态好 / 英雄熟练 / 预组队配合 / 版本加强，带数字}
- 没有明显亮点时写"我方无明显强点，得靠运营和团队"

## 风险点
- {我方隐患：状态差 / 在补位 / 英雄不熟 / 版本削弱 / 负面标签，带数字}
- 没有明显隐患时写"我方无明显短板"

## 重点盯防
- {${oppLabel}最该提防的玩家或英雄：状态火热 / 高威胁 / 预组队 / 版本加强，带数字}
- 信息不足时给基于位置/英雄的常识性提醒（用"通常"软化）

## 建议
- 3 条以内，针对上面的优势/风险/盯防给出**可执行**的打法或心态建议

【语气】像懂哥开黑前的速读：简洁、戏谑、有梗；不辱骂、不地域黑、不人身攻击；
只用给定数据里的数字，缺数据就说"数据不足"而不是编。`
}

export { buildPlayerAnalysisPrompt } from './team-player'
