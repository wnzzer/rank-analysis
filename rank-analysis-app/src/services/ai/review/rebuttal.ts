/**
 * 标注反驳：玩家与模型有分歧并写了理由时，让 AI 针对理由回应一次。
 *
 * 设计见 docs/superpowers/specs/2026-11-21-label-rebuttal-design.md。要点：
 * - **不改判**：AI 可以认账，但标签和分数始终来自评分计算，这里不碰。
 * - 一次调用、结构化输出（立场 + 类别 + 回复正文）。立场与类别是枚举，收上来可以直接统计
 *   「评分最常漏算什么」，不用事后再分析文本。
 * - 防瞎编：只给模型事实卡（档位词，不给原始分数）与「评分说明」；回复里的数字必须都能在
 *   材料里找到，否则整条作废走保底文案——宁可少说，不给玩家看编出来的数据。
 *
 * 除 {@link requestRebuttal} 外全是纯函数。
 *
 * @module services/ai/review/rebuttal
 */
import type { PlayerView } from './buildReviewModel'
import { shareFacts } from './shareFacts'
import { scoringNotesText } from './scoringNotes'
import { extractNumbers } from '../matchDetail/postprocess'
import { resolveModel } from '../modelConfig'
import { DEFAULT_MODEL, requestAIContentStream } from '../stream'
import {
  modelPicks,
  type RebuttalCategory,
  type RebuttalStance
} from '@renderer/services/matchLabel'

/** 理由至少多少个字才触发：太短（「菜」「他送」）AI 没法针对性回应 */
export const REBUTTAL_MIN_NOTE = 4
/** 回复正文上限（字） */
export const REBUTTAL_MAX_REPLY = 160
/** 调用超时 */
export const REBUTTAL_TIMEOUT_MS = 20_000
/** 模型输出没通过校验时给玩家看的保底文案 */
export const REBUTTAL_FALLBACK_REPLY = '你的理由已记下。这局的判断依据可以在完整复盘里看到。'
/** 认账时界面追加的一句（不让模型写，避免它发挥成「我们会尽快修复」之类的承诺） */
export const REBUTTAL_CONCEDE_SUFFIX = '这条已记下，会用来改进评分。'
/** 每名玩家最多列几次阵亡明细，控制材料长度 */
const MAX_DEATHS_LISTED = 8
/** 数字校验的容差：模型偶尔把 8.20 写成 8.2 */
const NUMBER_TOLERANCE = 0.05

const CATEGORIES: readonly RebuttalCategory[] = [
  'absence',
  'targeted',
  'empty_stats',
  'attitude',
  'draft',
  'teamwork',
  'other'
]
const STANCES: readonly RebuttalStance[] = ['concede', 'partial', 'hold']

/** 玩家的选择：所选玩家的 participantId，没选为 null */
export interface Guess {
  keyPid: number | null
  blamePid: number | null
}

/**
 * 一处分歧
 * @property kind - key = 最关键，blame = 最犯罪
 * @property mine - 玩家选的人
 * @property model - 模型选的人
 */
export interface Dispute {
  kind: 'key' | 'blame'
  mine: PlayerView
  model: PlayerView
}

/** 解析后的回应（不含模型名与指纹，由调用方补） */
export interface ParsedRebuttal {
  stance: RebuttalStance
  category: RebuttalCategory
  reply: string
}

const KIND_CN = { key: '最关键', blame: '最犯罪' } as const

/**
 * 找出玩家与模型的分歧
 * @param guess - 玩家的选择
 * @param players - 本局 10 人
 * @returns 只含玩家选了、且与模型不同的项；模型没有结论的项不算分歧
 */
export function findDisputes(guess: Guess, players: PlayerView[]): Dispute[] {
  const picks = modelPicks(players)
  const byPid = (pid: number | null): PlayerView | undefined =>
    pid === null ? undefined : players.find(p => p.participantId === pid)
  const out: Dispute[] = []
  const check = (kind: 'key' | 'blame', minePid: number | null, modelPid: number | null): void => {
    const mine = byPid(minePid)
    const model = byPid(modelPid)
    if (mine && model && mine.participantId !== model.participantId) {
      out.push({ kind, mine, model })
    }
  }
  check('key', guess.keyPid, picks.keyPid)
  check('blame', guess.blamePid, picks.blamePid)
  return out
}

/**
 * 是否该让 AI 回应：有分歧，且理由够长
 * @param disputes - {@link findDisputes} 的结果
 * @param note - 玩家写的理由
 */
export function shouldRebut(disputes: Dispute[], note: string): boolean {
  return disputes.length > 0 && [...note.trim()].length >= REBUTTAL_MIN_NOTE
}

/**
 * 回应所针对的「选择 + 理由」的指纹：没变就不重新调用
 * @returns 如 `1|6|他一直单带不参团`
 */
export function rebuttalBasis(guess: Guess, note: string): string {
  return `${guess.keyPid ?? ''}|${guess.blamePid ?? ''}|${note.trim()}`
}

/**
 * 一名玩家的事实卡（只有档位词与事件，不含原始分数）
 * @param p - 该玩家
 * @param team - 与其同队的全部玩家（含本人），供队内对比类事实使用
 */
export function playerFacts(p: PlayerView, team: PlayerView[]): string {
  const lines: string[] = [
    `${p.champion}（${p.roleCn}，${p.win ? '胜方' : '败方'}${p.isMe ? '，标注人自己' : ''}）`,
    `KDA ${p.kills}/${p.deaths}/${p.assists}`
  ]
  if (p.parts.length) {
    lines.push(`分项（相对同位置同英雄）：${p.parts.map(x => `${x.cn}${x.level}`).join('、')}`)
  }
  if (p.deathList?.length) {
    const shown = p.deathList.slice(0, MAX_DEATHS_LISTED).map(d => {
      const odds = `${d.allies} 打 ${d.enemies}`
      return `${d.time} ${d.kindCn}（${odds}${d.traded ? '，队友换到了资源' : ''}）`
    })
    const more =
      p.deathList.length > shown.length ? `，其余 ${p.deathList.length - shown.length} 次略` : ''
    lines.push(`阵亡明细：${shown.join('；')}${more}`)
  } else if (p.deathSummary) {
    lines.push(`阵亡：${p.deathSummary}`)
  }
  const facts = shareFacts(p, team).map(f =>
    f.detail ? `${f.headline}（${f.detail}）` : f.headline
  )
  if (facts.length) lines.push(`值得一提：${facts.join('；')}`)
  return lines.join('\n')
}

/** 系统提示词：角色、语气与硬性约束 */
export const REBUTTAL_SYSTEM_PROMPT = [
  '你是英雄联盟赛后复盘工具里的 AI。玩家不同意你对这局「最关键」或「最犯罪」的判断，并写了理由。请针对他的理由回应一次。',
  '',
  '硬性约束：',
  '1. 只能引用【事实】里出现的内容。不要说任何事实里没有的数字、时间或事件。',
  '2. 理由指向【评分不看什么】里列出的东西：这是评分确实没算的，直接认账，不要硬找数据反驳。',
  '3. 理由与【事实】矛盾：平和地摆出事实，不要嘲讽。',
  '4. 先接住玩家的情绪，再讲道理。不说教，不用「但是你要知道」「其实」这类口吻。',
  '5. 不评价玩家本人的水平，不贬低任何一名队友。',
  '6. 不承诺改判，不推测「如果算上这点应该是谁」。',
  '7. 不提分数、百分位、标准差这类术语，用「领先」「落后」这样的说法。',
  '',
  `输出一个 JSON 对象，不要输出别的：`,
  '{"stance": "concede|partial|hold", "category": "absence|targeted|empty_stats|attitude|draft|teamwork|other", "reply": "给玩家看的话"}',
  '',
  'stance：concede = 玩家说的点评分确实没算，他有道理；partial = 有一部分道理；hold = 事实不支持他的说法。',
  'category 是玩家理由的类别：absence 团战缺席或单带；targeted 被针对；empty_stats 数据好看但没作用；attitude 挂机、送、摆烂；draft 英雄或阵容；teamwork 沟通配合；other 其他。',
  `reply 用中文，口语化，${REBUTTAL_MAX_REPLY} 字以内，不要分点，不要加引号或前缀。`
].join('\n')

/**
 * 拼用户提示词：分歧、事实、评分说明、玩家理由
 * @param disputes - 分歧项
 * @param players - 本局 10 人
 * @param note - 玩家写的理由
 */
export function buildRebuttalPrompt(
  disputes: Dispute[],
  players: PlayerView[],
  note: string
): string {
  const involved: PlayerView[] = []
  for (const d of disputes) {
    for (const p of [d.mine, d.model]) {
      if (!involved.some(x => x.participantId === p.participantId)) involved.push(p)
    }
  }
  const teamOf = (p: PlayerView): PlayerView[] => players.filter(q => q.teamId === p.teamId)
  const disputeLines = disputes.map(
    d => `- ${KIND_CN[d.kind]}：玩家选了${d.mine.champion}，你选的是${d.model.champion}`
  )
  return [
    '【分歧】',
    ...disputeLines,
    '',
    '【事实】',
    ...involved.map(p => playerFacts(p, teamOf(p))).flatMap(card => [card, '']),
    scoringNotesText(),
    '',
    '【玩家的理由】',
    note.trim()
  ].join('\n')
}

/** 回复里的数字是否都能在材料里找到 */
function numbersGrounded(reply: string, prompt: string): boolean {
  const allowed = [...extractNumbers(prompt)]
  return [...extractNumbers(reply)].every(n =>
    allowed.some(a => Math.abs(a - n) <= NUMBER_TOLERANCE)
  )
}

/** 保底回应：立场未知，类别归到其他 */
function fallback(): ParsedRebuttal {
  return { stance: 'unknown', category: 'other', reply: REBUTTAL_FALLBACK_REPLY }
}

/** 从模型输出里取出 JSON 对象（容忍前后多余的文字与 ```json 围栏） */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 解析并校验模型输出；任何一项不合格都整条作废，返回保底回应。
 *
 * 不合格的情形：不是合法 JSON、立场或类别不在枚举内、回复为空或超过
 * {@link REBUTTAL_MAX_REPLY} 字、回复里出现材料中没有的数字。
 * @param raw - 模型的原始输出
 * @param prompt - 喂给模型的用户提示词（数字白名单的来源）
 */
export function parseRebuttal(raw: string, prompt: string): ParsedRebuttal {
  const obj = extractJson(raw)
  if (!obj || typeof obj !== 'object') return fallback()
  const { stance, category, reply } = obj as Record<string, unknown>
  if (typeof reply !== 'string') return fallback()
  const text = reply.trim()
  if (!text || [...text].length > REBUTTAL_MAX_REPLY) return fallback()
  if (!STANCES.includes(stance as RebuttalStance)) return fallback()
  if (!CATEGORIES.includes(category as RebuttalCategory)) return fallback()
  if (!numbersGrounded(text, prompt)) return fallback()
  return { stance: stance as RebuttalStance, category: category as RebuttalCategory, reply: text }
}

/**
 * 请求一次 AI 回应
 * @param disputes - 分歧项（不能为空）
 * @param players - 本局 10 人
 * @param note - 玩家写的理由
 * @returns 解析后的回应与所用模型名；模型输出不合格时是保底回应（不抛错）
 * @throws 调用失败或超过 {@link REBUTTAL_TIMEOUT_MS} 时抛出，由调用方提示重试
 * @example
 * ```ts
 * const disputes = findDisputes(guess, players)
 * if (shouldRebut(disputes, note)) {
 *   const r = await requestRebuttal(disputes, players, note)
 *   console.log(r.stance, r.reply)
 * }
 * ```
 */
export async function requestRebuttal(
  disputes: Dispute[],
  players: PlayerView[],
  note: string
): Promise<ParsedRebuttal & { model: string }> {
  const prompt = buildRebuttalPrompt(disputes, players, note)
  const model = await resolveModel('labelRebuttal', DEFAULT_MODEL)
  const raw = await new Promise<string>((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error('AI 回应超时')), REBUTTAL_TIMEOUT_MS)
    void requestAIContentStream(
      prompt,
      {
        onChunk: chunk => {
          text += chunk
        },
        onDone: () => {
          clearTimeout(timer)
          resolve(text)
        },
        onError: e => {
          clearTimeout(timer)
          reject(new Error(e))
        }
      },
      REBUTTAL_SYSTEM_PROMPT,
      model,
      { jsonMode: true }
    )
  })
  return { ...parseRebuttal(raw, prompt), model }
}
