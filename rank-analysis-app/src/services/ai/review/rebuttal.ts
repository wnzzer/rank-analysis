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
import { requestAIContentStream } from '../stream'
import {
  modelPicks,
  type RebuttalCategory,
  type RebuttalStance
} from '@renderer/services/matchLabel'

/**
 * 本场景的默认模型（远程配置 `labelRebuttal` 可覆盖）。
 *
 * 不用全局默认的 deepseek-v4.1-flash：这个场景要同时做到「只围绕玩家那句话说」「不反驳他」
 * 「不把话题转到别人身上」，对指令遵循的要求比写点评高。2026-11-21 同一份提示词
 * （真机对局，玩家理由「玩的太独了」，数据并不怎么支持他）各跑 4 次：
 *
 * | 模型 | 平均耗时 | 出现反驳口吻 | 转到别人身上 |
 * |---|---|---|---|
 * | deepseek-v4.1-flash-1017 | 1.6s | 4/4 | 0 |
 * | deepseek-v4-pro | 6.1s | 3/4 | 0 |
 * | qwen3.7-plus | 2.8s | 4/4 | 0 |
 * | qwen3.8-flash | 2.2s | 1/4 | 0 |
 * | qwen3.8-max | 3.1s | 0 | 1/4 |
 * | kimi-k3.1-pro | 4.8s | 0 | 0 |
 * | qwen4-max | 3.3s | 0 | 0 |
 *
 * qwen4-max 与 kimi-k3.1-pro 都没出问题；qwen4-max 更快、回复更紧凑，论据都落在玩家说的那一点上。
 * 样本很小（一局、一个理由、每个模型 4 次），换模型前应当用更多对局重测。
 */
export const REBUTTAL_MODEL = 'qwen4-max'

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
/** 模型输出不合格时最多再要几次（合格率高，重试一次基本够；每次 1～2 秒） */
const REBUTTAL_ATTEMPTS = 2
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
 * 分项后面带的真实数据，拼成一段。
 *
 * 复盘里的「参团率」是击杀参与率（(击杀 + 助攻) ÷ 全队击杀），不是到场率；到场情况是另一条
 * 「N 场团战缺席 M 场」。两条并排时会像自相矛盾——真机用户原话：「9 缺 3，凭什么是 37 参团率」
 * （那名玩家 5 杀 8 助攻、全队 35 个人头，13 ÷ 35 = 37.1%，而 9 场团战他到了 6 场）。
 * 所以在给模型的材料里改叫「击杀参与率」，并在提示词里说明两者的区别。
 */
export function statsText(stats: string[]): string {
  return stats.map(t => t.split('参团率').join('击杀参与率')).join('，')
}

/** 给模型看的指标说明：防止它把击杀参与率当成到场率 */
export const METRIC_NOTES = [
  '【指标说明】',
  '- 击杀参与率 =（击杀 + 助攻）÷ 全队击杀数。它说的是「参与了多少击杀」，不是到场率：到了场但没拿到击杀或助攻，这个数也会低。',
  '- 有没有到场，看「N 场团战缺席 M 场」。'
].join('\n')

/** 一次阵亡的人话。人数写成「我方 N 人、对面 M 人」：写「4 打 2」模型会读反（真机实测读成被四个人压） */
function deathLine(d: NonNullable<PlayerView['deathList']>[number]): string {
  const odds = `我方 ${d.allies} 人、对面 ${d.enemies} 人`
  return `${d.time} ${d.kindCn}（${odds}${d.traded ? '，队友趁机换到了资源' : ''}）`
}

/**
 * 玩家本人「情有可原」的一次阵亡。只有确实被人数压制时才写人数：
 * 被抓、队友先倒下这两类即使人数不吃亏也算情有可原，带上「我方 2 人、对面 1 人」
 * 会被模型一并概括成「全是多打少」（真机实测）。
 */
function excusedLine(d: NonNullable<PlayerView['deathList']>[number]): string {
  const bits: string[] = []
  if (d.enemies > d.allies) bits.push(`我方 ${d.allies} 人、对面 ${d.enemies} 人`)
  if (d.traded) bits.push('队友趁机换到了资源')
  return `${d.time} ${d.kindCn}${bits.length ? `（${bits.join('，')}）` : ''}`
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
function selfFacts(p: PlayerView, tags: string[] = []): string {
  const lines: string[] = [
    `${p.champion}（${p.roleCn}，${p.win ? '胜方' : '败方'}，就是玩家本人，称呼为「你」${tags.map(t => `，${t}`).join('')}）`
  ]
  const good = p.parts.filter(x => AHEAD.has(x.level))
  if (good.length) {
    lines.push(
      `做得好的：${good.map(x => (x.stats.length ? `${x.cn}${x.level}（${statsText(x.stats)}）` : `${x.cn}${x.level}`)).join('、')}`
    )
  }
  const excused = (p.deathList ?? []).filter(excusable).slice(0, MAX_DEATHS_LISTED)
  if (excused.length) {
    lines.push(`不该算在他头上的阵亡：${excused.map(excusedLine).join('；')}`)
  }
  return lines.join('\n')
}

/**
 * 「最关键」人选的事实卡：只放这个人打得好的地方。
 *
 * 玩家选他是因为觉得他打得最好。给全量数据时，模型会把里面落后的分项、
 * 「数据好看作用有限」之类拿来当反面证据（真机实测：玩家选对面中单为最关键，
 * 模型回复「他这关键确实站不住」）。与 {@link selfFacts} 同理：不给，就说不出来。
 */
function praiseFacts(p: PlayerView, tags: string[]): string {
  const lines: string[] = [
    `${p.champion}（${[p.roleCn, p.win ? '胜方' : '败方', ...tags].join('，')}）`,
    `KDA ${p.kills}/${p.deaths}/${p.assists}`
  ]
  const good = p.parts.filter(x => AHEAD.has(x.level))
  if (good.length) {
    lines.push(
      `打得好的：${good.map(x => (x.stats.length ? `${x.cn}${x.level}（${statsText(x.stats)}）` : `${x.cn}${x.level}`)).join('、')}`
    )
  }
  return lines.join('\n')
}

/**
 * 一名玩家的事实卡（只有档位词、真实数据与事件，不含原始分数）
 *
 * 玩家本人走 {@link selfFacts}，只有对他有利的事实。
 * @param p - 该玩家
 * @param team - 与其同队的全部玩家（含本人），供队内对比类事实使用
 * @param tags - 写在名字后面的身份说明（如「你的队友」「玩家认为他最犯罪」）；不传则不写
 */
export function playerFacts(p: PlayerView, team: PlayerView[], tags: string[] = []): string {
  // 「你的队友」对玩家本人没有意义，只留他在分歧里的身份（如「评分选的最犯罪」）
  if (p.isMe)
    return selfFacts(
      p,
      tags.filter(t => t !== '你的队友')
    )
  const lines: string[] = [
    `${p.champion}（${[p.roleCn, p.win ? '胜方' : '败方', ...tags].join('，')}）`,
    `KDA ${p.kills}/${p.deaths}/${p.assists}`
  ]
  if (p.parts.length) {
    // 档位词后面带上驱动该分项的真实数据（参团率、资源在场率等）：玩家说「不参团」时，
    // 模型手里得有参团率才能说「数据也是这样」，否则只能空口认账或空口反驳
    const part = (x: PlayerView['parts'][number]): string =>
      x.stats.length ? `${x.cn}${x.level}（${statsText(x.stats)}）` : `${x.cn}${x.level}`
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
 * 反过来夸那个人对线打得好、把玩家选的「最关键」（对面中单）的数据当成
 * 「你家中路不动」的证据。
 */
export const REBUTTAL_SYSTEM_PROMPT = [
  '你是英雄联盟玩家的开黑队友，刚陪他打完这局。复盘工具的评分给出了「最关键」「最犯罪」的判断，他不服，写了理由。你站在他这边，回他一段话。',
  '',
  '怎么说：',
  '0. 整段话只讲一件事：他理由里说的那件事。先把他的话拆成数据能证明的点（比如「太独」= 不跟团、只顾自己刷、落单被杀；「送」= 阵亡多、自己的问题多；「不参团」= 团战缺席、资源团不在），再用【队内对比】逐条对上。不要东拉西扯到别的人、别的事。',
  '1. 论据必须带对比：不要只报一个数，要说出他和队友差多少、排第几（【队内对比】里已经标好了「最高」「最低」「第几高」，直接用）。比如「击杀参与率就他最低，55%，别人都在 65% 以上」。单独一个数字不算论据。名次只说高低，是好是坏你结合他的话判断：他说人家「独」「只顾自己刷」，那经济最高就是证据。',
  '1b. 把这种打法让人多难受说透，用游戏里的话（比如「你们四个在打，他在另一边刷」），但不要编具体的事件和时间。',
  '1c. 【队内对比】里对不上他说法的项（比如他说人家不参团，可那人参与率是最高的）：跳过，一个字不提。绝对不要用数据反驳他，不要说「可是」「不过他其实」「没看出」，不要拿他本人和任何人比。',
  '1d. 能对上的一项都没有：不要硬找，也不要编。直说这种事数据里看不出来——评分只数人头和次数，看不到该来的时候来没来、是不是只在安全的时候才露面、资源是不是自己全吃了——但看不出来不代表没发生，你在场上的感受是真的。',
  '2. 他说的事评分没算（见【评分不看什么】）：明说这是评分的问题、评分的盲区，不是他的问题。',
  '3. 他指的那个人这局确实有做得不好的地方，【事实】里有数据：可以直说，就事论事，不骂人、不做人身攻击。',
  '4. 一个字都不要提玩家本人的失误、阵亡、落后的分项。即使评分把「最犯罪」判给了他，也只说「评分把锅扣在你头上，是因为它看不到……」，然后说它看不到什么。',
  '5. 事实和他说的对不上时：不要纠正他、不要说「其实」「不过数据显示」。先认同他的感受，再挑【事实】里能支持他的部分说；对不上的那部分最多轻轻带一句，或者干脆不提。',
  '6. 不要夸他指的那个人，不要替那个人开脱。对那个人有利的数据（对线领先、发育好之类）不要主动提。',
  '6b. 不要把话题转到评分选的那个人身上，不要说「这锅该某某背」「真正的问题在某某」。他要怪谁，就只说谁。',
  '7. 分清他在说谁：事实分成【玩家这边】和【对面】两个区。标了「玩家认为他是全场打得最好的」的人，是他觉得最关键的——认同这一点，说这个人哪里打得好，绝对不能说这个人不行。标了「玩家认为他最犯罪」的人才是他要怪的。',
  '8. 他的理由按位置点名时（如「中路」「辅助」「打野」「上单」）：说的一定是【玩家这边】的人。到【玩家这边】里按位置找到那个人，用那个人的数据；【对面】同位置的人不是他说的人，一个数字都不能借用。找不到数据就只认同感受。',
  '9. 口气像朋友聊天：短句，口语。不要官腔，不要「评分看到的是」「综合来看」这类解释腔，不要说教。开头每次换个说法，贴着他这句话的内容接，不要用固定的套话开场。',
  '',
  '底线（违反任何一条，整段回复作废）：',
  'A. 只能说【事实】里有的数字、时间和事件，一个都不能编。没有数据撑腰的话可以说，但不能带编出来的数。',
  'B. 不承诺改判，不说「应该判给谁」。',
  'C. 不提分数、百分位、标准差。',
  'D. 人称：对玩家说「你」；【事实】里标了「就是玩家本人」的那个人就是他，提到一律说「你」；其他人用英雄名；「我」只指你自己。',
  'E. 只有这一次回应：不提问，不请他补充。',
  'F. reply 不要以「你说得对」「有一部分道理」开头，界面上已经单独显示了。',
  'G. 不要把这些要求里的话写进 reply（如「轻带一句」「就事论事」）。',
  'H. 说某人不来打团，用「N 场团战缺席 M 场」。击杀参与率只能说成「参与的击杀少」「打团没打出东西」，不能说成到场率，也不要说「参团率」。两个数不要并排当成同一件事说。',
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
 * 队内对比的一项指标
 * @property label - 给模型看的名字
 * @property unit - 数值后缀
 * @property higherIsBetter - 越高越好；用来算队内名次
 * @property value - 从一名玩家身上取这项的值；取不到为 null
 */
interface CompareMetric {
  label: string
  unit: string
  higherIsBetter: boolean
  value: (p: PlayerView) => number | null
}

/** 取某分项的某条数据里的第 index 个数字（数据文案由 plainScore.partStats 生成，格式固定） */
function statNumber(p: PlayerView, part: string, keyword: string, index = 0): number | null {
  const text = p.parts.find(x => x.key === part)?.stats.find(t => t.includes(keyword))
  if (!text) return null
  const numbers = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
  return numbers.length > index ? numbers[index] : null
}

/**
 * 拿来做队内对比的指标。选的是能直接回答玩家常见说法的那几项：
 * 不参团 / 太独（击杀参与率、团战缺席、资源在场率、落单被杀）、送（阵亡、自身问题阵亡）、
 * 只顾自己刷（每分钟经济——经济高而参与低正是「独」的数据形状）。
 */
const COMPARE_METRICS: readonly CompareMetric[] = [
  {
    label: '击杀参与率',
    unit: '%',
    higherIsBetter: true,
    value: p => statNumber(p, 'teamfight', '参团率')
  },
  {
    label: '团战缺席场次',
    unit: ' 场',
    higherIsBetter: false,
    // 文案是「N 场团战缺席 M 场」：第二个数才是缺席场次
    value: p => statNumber(p, 'teamfight', '团战缺席', 1)
  },
  {
    label: '大型野怪资源在场率',
    unit: '%',
    higherIsBetter: true,
    value: p => statNumber(p, 'resources', '资源在场率')
  },
  {
    label: '每分钟经济',
    unit: '',
    higherIsBetter: true,
    value: p => statNumber(p, 'growth', '每分钟经济')
  },
  { label: '阵亡次数', unit: ' 次', higherIsBetter: false, value: p => p.deaths },
  {
    label: '自身问题的阵亡',
    unit: ' 次',
    higherIsBetter: false,
    value: p => statNumber(p, 'deathQuality', '自身问题')
  },
  {
    label: '落单被杀',
    unit: ' 次',
    higherIsBetter: false,
    value: p => (p.deathList ? p.deathList.filter(d => d.kind === 'isolated').length : null)
  }
]

/** 至少几个人有数据才做对比：只有两个人的「队内最低」没有意义 */
const COMPARE_MIN_PLAYERS = 3

/**
 * 某人与同队其他人的逐项对比，带队内名次。
 *
 * 单独一个数字立不住论据——真机用户反馈「论证不合理」：回复说「击杀参与率才 55%」，
 * 可 55% 是高是低？得能说出「全队就他最低，队友都在 65% 以上」。所以把队友的数并排给出来，
 * 并直接标出名次，不让模型自己比大小（它会比错）。
 *
 * 名次只说「最高 / 最低 / 第几高」，不说好坏：经济全队最高，在「他太独、只顾自己刷」的语境里
 * 是罪证不是优点，好坏留给模型结合玩家的话去判断。
 *
 * 对比里**不放玩家本人**：放了，模型会说「他的参与率比你还高」（真机实测）——拿数据压
 * 来讨说法的人。名次也只在其余的人里排。
 * @param target - 玩家指的那个人
 * @param team - 与其同队的全部玩家（含本人）
 * @returns 每项一行；拿不到足够数据的项跳过
 */
export function teamComparison(target: PlayerView, team: PlayerView[]): string[] {
  const out: string[] = []
  for (const m of COMPARE_METRICS) {
    const rows = team
      .filter(p => !p.isMe || p.participantId === target.participantId)
      .map(p => ({ p, v: m.value(p) }))
      .filter((r): r is { p: PlayerView; v: number } => r.v !== null)
    const mine = rows.find(r => r.p.participantId === target.participantId)
    if (!mine || rows.length < COMPARE_MIN_PLAYERS) continue
    const higher = rows.filter(r => r.v > mine.v).length
    const lower = rows.filter(r => r.v < mine.v).length
    const rank =
      higher === 0 && lower === 0
        ? '几个人一样'
        : higher === 0
          ? '几个人里最高'
          : lower === 0
            ? '几个人里最低'
            : `第 ${higher + 1} 高`
    // 其余的人只给一个范围，不点名：点了名，模型会顺手去说「真正拖后腿的是某某」
    // （真机实测 4 次里 3 次把话题转到了数据最差的那个队友身上）
    const others = rows.filter(r => r.p.participantId !== target.participantId).map(r => r.v)
    const lo = Math.min(...others)
    const hi = Math.max(...others)
    const range = lo === hi ? `${lo}${m.unit}` : `${lo}～${hi}${m.unit}`
    out.push(`- ${m.label}：${target.champion} ${mine.v}${m.unit}（${rank}）｜其余队友 ${range}`)
  }
  return out
}

/** 相对玩家本人：队友还是对面 */
function sideOf(p: PlayerView, me: PlayerView | undefined): string {
  if (!me) return p.win ? '胜方' : '败方'
  return p.teamId === me.teamId ? '你的队友' : '对面的'
}

/**
 * 玩家其余队友的一行摘要（位置、英雄、战绩、团战与资源的真实数据）。
 *
 * 玩家的理由常按位置点名（「中路一动不动」「辅助乱游走」），而分歧涉及的只有两到四个人。
 * 真机（2026-11-21 用户截图）：玩家选了对面中单为最关键，理由里骂的是自己家中路；材料里
 * 唯一的中单是对面那个，模型就把对面中单的参团率当成了「你家中路不动」的证据——
 * 等于在骂玩家认为全场最好的人。所以把队友都列出来，让模型能按位置找对人。
 */
function teammateLine(p: PlayerView): string {
  const stat = (key: string): string => statsText(p.parts.find(x => x.key === key)?.stats ?? [])
  const bits = [`KDA ${p.kills}/${p.deaths}/${p.assists}`, stat('teamfight'), stat('resources')]
  return `- ${p.roleCn} ${p.champion}：${bits.filter(Boolean).join('，')}`
}

/**
 * 拼用户提示词：分歧、按阵营分区的事实、评分说明、玩家理由。
 *
 * 事实按「玩家这边 / 对面」分成两个区，而不是把涉及的人排成一列：玩家按位置点名
 * （「中路一动不动」）说的一定是自己这边的人，分区后模型不用靠每张卡上的小标签去判断。
 * 每个人给多少事实取决于他在分歧里的身份：
 * - 玩家本人：只给对他有利的（{@link selfFacts}）；
 * - 「最关键」的人选（玩家选的、评分选的）：只给打得好的地方（{@link praiseFacts}）；
 * - 「最犯罪」的人选：全量；
 * - 玩家的其余队友：一行摘要（{@link teammateLine}）。
 * @param disputes - 分歧项
 * @param players - 本局 10 人
 * @param note - 玩家写的理由
 */
export function buildRebuttalPrompt(
  disputes: Dispute[],
  players: PlayerView[],
  note: string
): string {
  const me = players.find(p => p.isMe)
  // 涉及的人：在分歧里的身份，以及是否只因「最关键」而涉及
  const involved: Array<{ p: PlayerView; tags: string[]; praiseOnly: boolean }> = []
  const tag = (p: PlayerView, text: string, praise: boolean): void => {
    const hit = involved.find(x => x.p.participantId === p.participantId)
    if (hit) {
      hit.tags.push(text)
      // 同时被指为最犯罪的人要看全量，不能只说好话
      hit.praiseOnly = hit.praiseOnly && praise
    } else {
      involved.push({ p, tags: [text], praiseOnly: praise })
    }
  }
  for (const d of disputes) {
    const key = d.kind === 'key'
    tag(d.mine, key ? '玩家认为他是全场打得最好的' : '玩家认为他最犯罪', key)
    // 「最犯罪」分歧里评分选的那个人不给事实卡（玩家本人除外，他那张只有有利事实）：
    // 给了全量，模型会顺着数据说「这锅才该他背」——等于替评分说话，和玩家的立场正相反
    if (key || d.model.isMe) tag(d.model, `评分选的${KIND_CN[d.kind]}`, key)
  }
  const teamOf = (p: PlayerView): PlayerView[] => players.filter(q => q.teamId === p.teamId)
  const card = (x: (typeof involved)[number]): string =>
    x.p.isMe
      ? playerFacts(x.p, teamOf(x.p), x.tags)
      : x.praiseOnly
        ? praiseFacts(x.p, x.tags)
        : playerFacts(x.p, teamOf(x.p), x.tags)
  const who = (p: PlayerView): string =>
    p.isMe ? '玩家自己' : `${sideOf(p, me)}${p.roleCn}${p.champion}`
  const disputeLines = disputes.map(
    d => `- ${KIND_CN[d.kind]}：玩家认为是${who(d.mine)}，评分选的是${who(d.model)}`
  )
  const isInvolved = (p: PlayerView): boolean =>
    involved.some(x => x.p.participantId === p.participantId)
  // 玩家要怪的人：逐个给出与同队队友的对比
  const comparisons = disputes
    .filter(d => d.kind === 'blame' && !d.mine.isMe)
    .flatMap(d => {
      const rows = teamComparison(d.mine, teamOf(d.mine))
      return rows.length
        ? [`【队内对比 · ${d.mine.champion}和同队其他人（不含玩家本人）】`, ...rows, '']
        : []
    })

  const facts: string[] = []
  if (me) {
    const mine = involved.filter(x => x.p.teamId === me.teamId)
    const theirs = involved.filter(x => x.p.teamId !== me.teamId)
    const rest = players.filter(p => p.teamId === me.teamId && !p.isMe && !isInvolved(p))
    // 玩家本人不在分歧里时也给他那张卡：里面是能替他说话的事实
    const selfCard = isInvolved(me) ? [] : [playerFacts(me, teamOf(me))]
    facts.push(
      `【事实 · 玩家这边（${me.win ? '胜方' : '败方'}）】`,
      ...[...selfCard, ...mine.map(card)].flatMap(c => [c, '']),
      ...(rest.length ? ['玩家的其余队友：', ...rest.map(teammateLine), ''] : [])
    )
    if (theirs.length) {
      facts.push(
        `【事实 · 对面（${me.win ? '败方' : '胜方'}）】`,
        ...theirs.map(card).flatMap(c => [c, ''])
      )
    }
  } else {
    // 标注人不在这局里（看别人的对局）：没有「这边 / 对面」，按原样排
    facts.push('【事实】', ...involved.map(card).flatMap(c => [c, '']))
  }

  const material = [
    '【分歧】',
    ...disputeLines,
    '',
    ...facts,
    ...comparisons,
    METRIC_NOTES,
    '',
    // 有没有时间线看阵亡明细：有时间线时每个人的 deathList 都是数组（哪怕为空）
    scoringNotesText(players.some(p => p.deathList !== null))
  ].join('\n')
  // 材料里别处出现的「参团率」（如「值得一提」里的句子）也统一改名；
  // 玩家自己写的理由原样保留，不替他改字
  return [statsText([material]), '', '【玩家的理由】', note.trim()].join('\n')
}

/**
 * 回复里的数字是否都能在材料里找到。
 *
 * 允许取整：材料里是 37.1%，模型说「37%」「不到 38%」都算有依据——口语里本来就会这么说，
 * 当成编造整条作废太严（真机实测约九分之一的回复因此走了保底）。
 */
function numbersGrounded(reply: string, prompt: string): boolean {
  const allowed = [...extractNumbers(prompt)]
  const grounded = (n: number): boolean =>
    allowed.some(
      a =>
        Math.abs(a - n) <= NUMBER_TOLERANCE ||
        Math.round(a) === n ||
        Math.floor(a) === n ||
        Math.ceil(a) === n
    )
  return [...extractNumbers(reply)].every(grounded)
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
 * @returns 解析后的回应与所用模型名；模型输出不合格时重试一次，仍不合格则是保底回应（不抛错）
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
  const model = await resolveModel('labelRebuttal', REBUTTAL_MODEL)
  const ask = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
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
  let parsed = parseRebuttal(await ask(), prompt)
  for (let i = 1; i < REBUTTAL_ATTEMPTS && parsed.stance === 'unknown'; i++) {
    parsed = parseRebuttal(await ask(), prompt)
  }
  return { ...parsed, model }
}
