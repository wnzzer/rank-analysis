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
/**
 * 回复正文上限（字）。提示词里要的是 REBUTTAL_TARGET_REPLY 字以内，
 * 真机实测模型常写到 120～155 字；上限放到 200，超过才作废走保底。
 */
export const REBUTTAL_MAX_REPLY = 200
/** 调用超时 */
export const REBUTTAL_TIMEOUT_MS = 20_000
/** 模型输出没通过校验时给玩家看的保底文案 */
export const REBUTTAL_FALLBACK_REPLY = '你的理由已记下。这局的判断依据可以在完整复盘里看到。'
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

/** 一次阵亡的人话。人数写成「我方 N 人、对面 M 人」：写「4 打 2」模型会读反（真机实测读成被四个人压） */
function deathLine(d: NonNullable<PlayerView['deathList']>[number]): string {
  const odds = `我方 ${d.allies} 人、对面 ${d.enemies} 人`
  return `${d.time} ${d.kindCn}（${odds}${d.traded ? '，队友趁机换到了资源' : ''}）`
}

/** 这次阵亡是否「情有可原」：被抓、队友先倒下、以少打多、牵制换到了资源 */
function excusable(d: NonNullable<PlayerView['deathList']>[number]): boolean {
  return d.kind === 'ganked' || d.kind === 'collapse' || d.enemies > d.allies || d.traded
}

/** 领先的档位 */
const AHEAD: ReadonlySet<string> = new Set(['领先', '大幅领先'])

/**
 * 玩家本人的事实卡：**只放对他有利的事实**。
 *
 * 回应的立场是站在玩家这边，不提他本人的失误。光在提示词里禁止不够——真机实测模型手里
 * 有「14 分钟对位经济落后 2247」就会说出来（「这把真不怪你，你下路落后 2247 确实有问题，
 * 但……」）。所以落后的分项、自己该负责的阵亡、负面的「值得一提」一律不给，
 * 模型想说也没有材料。
 */
function selfFacts(p: PlayerView): string {
  const lines: string[] = [
    `${p.champion}（${p.roleCn}，${p.win ? '胜方' : '败方'}，就是玩家本人，称呼为「你」）`
  ]
  const good = p.parts.filter(x => AHEAD.has(x.level))
  if (good.length) {
    lines.push(
      `做得好的：${good.map(x => (x.stats.length ? `${x.cn}${x.level}（${x.stats.join('，')}）` : `${x.cn}${x.level}`)).join('、')}`
    )
  }
  const excused = (p.deathList ?? []).filter(excusable).slice(0, MAX_DEATHS_LISTED)
  if (excused.length) {
    lines.push(`不该算在他头上的阵亡：${excused.map(deathLine).join('；')}`)
  }
  return lines.join('\n')
}

/**
 * 一名玩家的事实卡（只有档位词、真实数据与事件，不含原始分数）
 *
 * 玩家本人走 {@link selfFacts}，只有对他有利的事实。
 * @param p - 该玩家
 * @param team - 与其同队的全部玩家（含本人），供队内对比类事实使用
 */
export function playerFacts(p: PlayerView, team: PlayerView[]): string {
  if (p.isMe) return selfFacts(p)
  const lines: string[] = [
    `${p.champion}（${p.roleCn}，${p.win ? '胜方' : '败方'}）`,
    `KDA ${p.kills}/${p.deaths}/${p.assists}`
  ]
  if (p.parts.length) {
    // 档位词后面带上驱动该分项的真实数据（参团率、资源在场率等）：玩家说「不参团」时，
    // 模型手里得有参团率才能说「数据也是这样」，否则只能空口认账或空口反驳
    const part = (x: PlayerView['parts'][number]): string =>
      x.stats.length ? `${x.cn}${x.level}（${x.stats.join('，')}）` : `${x.cn}${x.level}`
    lines.push(`分项（相对同位置同英雄）：${p.parts.map(part).join('、')}`)
  }
  if (p.deathList?.length) {
    const shown = p.deathList.slice(0, MAX_DEATHS_LISTED).map(deathLine)
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

/** 提示词里要求的回复长度：比硬上限短一截，留出模型超写的余量 */
const REBUTTAL_TARGET_REPLY = 110

/**
 * 系统提示词：角色、语气与硬性约束。
 *
 * 立场是「站在玩家这边的队友」，不是「解释评分的裁判」。第一版按裁判写，真机反馈
 * （2026-11-21 用户原话）：「情绪价值不是很高」「没拍对马屁」。那一版的回复是
 * 「评分看到的是他的对线和发育领先，你这边死亡质量落后、阵亡次数也偏多」——句句属实，
 * 但玩家是来讨说法的，不是来听评分怎么算的。
 *
 * 所以现在的顺序是：先用对玩家有利的事实替他说话 → 评分没算到的直接认是评分的问题 →
 * 完全不提玩家本人的失误。底线不变：只说【事实】里有的东西，不编数据，不改判。
 *
 * 其余各条来自真机测试（deepseek-v4.1-flash）里实际出现过的问题：
 * 纯情绪的话被当成认账、类别归错、人称混乱（把玩家的数据说成「我这边」、
 * 把玩家说成「他」）、结尾反问、开头重复立场标签、材料里有印证的数据却不用、
 * 提示词里举的口头禅（「换谁都上火」）被每条回复照抄当开场、玩家骂某人「混子」时
 * 反过来夸那个人对线打得好。
 */
export const REBUTTAL_SYSTEM_PROMPT = [
  '你是英雄联盟玩家的开黑队友，刚陪他打完这局。复盘工具的评分给出了「最关键」「最犯罪」的判断，他不服，写了理由。你站在他这边，回他一段话。',
  '',
  '怎么说：',
  '1. 开口第一句就替他说话：认同他的判断或他的火气，并且马上拿出【事实】里对他有利的数据撑腰。比如他说某人不参团，就直接报那个人的参团率、资源在场率。',
  '2. 他说的事评分没算（见【评分不看什么】）：明说这是评分的问题、评分的盲区，不是他的问题。',
  '3. 他指的那个人这局确实有做得不好的地方，【事实】里有数据：可以直说，就事论事，不骂人、不做人身攻击。',
  '4. 一个字都不要提玩家本人的失误、阵亡、落后的分项。即使评分把「最犯罪」判给了他，也只说「评分把锅扣在你头上，是因为它看不到……」，然后说它看不到什么。',
  '5. 事实和他说的对不上时：不要纠正他、不要说「其实」「不过数据显示」。先认同他的感受，再挑【事实】里能支持他的部分说；对不上的那部分最多轻轻带一句，或者干脆不提。',
  '6. 不要夸他指的那个人，不要替那个人开脱。对那个人有利的数据（对线领先、发育好之类）不要主动提。',
  '7. 口气像朋友聊天：短句，口语。不要官腔，不要「评分看到的是」「综合来看」这类解释腔，不要说教。开头每次换个说法，贴着他这句话的内容接，不要用固定的套话开场。',
  '',
  '底线（违反任何一条，整段回复作废）：',
  'A. 只能说【事实】里有的数字、时间和事件，一个都不能编。没有数据撑腰的话可以说，但不能带编出来的数。',
  'B. 不承诺改判，不说「应该判给谁」。',
  'C. 不提分数、百分位、标准差。',
  'D. 人称：对玩家说「你」；【事实】里标了「就是玩家本人」的那个人就是他，提到一律说「你」；其他人用英雄名；「我」只指你自己。',
  'E. 只有这一次回应：不提问，不请他补充。',
  'F. reply 不要以「你说得对」「有一部分道理」开头，界面上已经单独显示了。',
  '',
  `输出一个 JSON 对象，不要输出别的：`,
  '{"stance": "concede|partial|hold", "category": "absence|targeted|empty_stats|attitude|draft|teamwork|other", "reply": "回他的话"}',
  '',
  'stance 是你对「事实」的判断，只用于后台统计，与语气无关（语气永远站他这边）：',
  '- concede：他说的点评分确实没算，或数据印证了他的说法',
  '- partial：一部分有数据印证，一部分没有',
  '- hold：【事实】不支持他的说法，或理由只有情绪没有具体指向（如「就是菜」「纯混子」）',
  'category 是他的理由说的是哪一类问题，按理由本身判断，与你是否同意无关：',
  '- absence：单带、带线、不参团、不跟团、打团总是少一个人（哪怕同时提到「四打五」）',
  '- targeted：被针对、被抓、被对面一直照顾',
  '- empty_stats：数据好看但没作用、刷数据、混',
  '- attitude：一直送、死太多、挂机、摆烂、不好好打',
  '- draft：英雄被克制、阵容不行、选人问题',
  '- teamwork：不沟通、不配合、不听指挥、各打各的',
  '- other：以上都不是，或只有情绪',
  `reply 用中文，${REBUTTAL_TARGET_REPLY} 字以内，不要分点，不要加引号或前缀。`
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
    // 有没有时间线看阵亡明细：有时间线时每个人的 deathList 都是数组（哪怕为空）
    scoringNotesText(players.some(p => p.deathList !== null)),
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
