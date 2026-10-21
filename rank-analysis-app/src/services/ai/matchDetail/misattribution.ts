/**
 * 张冠李戴过滤：剔除「点名了 A，却写了 B 的数字」的句子。
 *
 * 模型会把材料里真实存在、但属于另一个玩家的数字安到点名对象头上（评测复现：
 * 「对位男枪自己只有 9500 金币」——9500 是赵信的，男枪 15000）。这类错误数字
 * 在材料里存在，stripUngroundedSentences 的白名单拦不住，必须按「数字属于谁」核对。
 *
 * 判定（刻意保守，宁可放过不可错杀）：只核对「数字 + 指标词」（9500 金币 / 10 杀 /
 * 参团率 24.1% / KDA 0.55 …），主语取该数字之前最近一次点名的人（句中没点名则取列表项
 * 「名字：」前缀的人或单人复盘目标）。该数字 **与主语的同一指标对不上**、也不是主语的任何
 * 合理数字（对位差、队伍总数据…），却 **恰好等于另一名玩家的同一指标**，才算张冠李戴，
 * 整句剔除。主语与数字之间出现「对面/队友/有人」等指代时主语不可信，跳过。
 * 纯函数，流式中途的不完整 markdown 也安全。
 */

import type { MatchSnapshot } from '../shared/snapshot'

/** 可按「数字 + 指标词」识别的指标 */
type StatField =
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'kda'
  | 'gold'
  | 'cs'
  | 'csm'
  | 'damageShare'
  | 'damageTakenShare'
  | 'goldShare'
  | 'killParticipation'
  | 'teamKills'

/** 单个玩家的身份与指标 */
export interface EntityFacts {
  participantId: number
  /** 可能在正文里出现的称呼：英雄名、召唤师名 */
  aliases: string[]
  /** 该玩家各指标的值（teamKills = 所在队伍总击杀） */
  stats: Partial<Record<StatField, number>>
  /** 属于他的全部数字（含对位差绝对值、击杀参与数、队伍总数据）：命中任一即视为合理引用 */
  numbers: number[]
}

/** 渲染层需要的全部材料 */
export interface MisattributionMaterial {
  players: EntityFacts[]
  /** 单人复盘的目标玩家：未点名的「你/本人」句子按他核对 */
  subjectId?: number
}

// 数字前不能紧挨数字/小数点：否则「29 次击杀」会从中间读成「9 次击杀」
const NUM = '(?<![\\d.,])(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|K|千|万)?'

/**
 * 「数字 + 指标词」模式。只认紧挨着指标词的数字——「破 30%」「第 4」这类阈值/排名
 * 没有指标词，天然不参与判定；「0.55 对 6.33」里只有紧跟 KDA 的 0.55 会被核对。
 */
const STAT_PATTERNS: Array<[RegExp, StatField]> = [
  [
    new RegExp(
      `(?:全队|队伍|本队|己方|我方)(?:总)?(?:击杀|人头)?\\s*${NUM}\\s*(?:杀|个人头|次击杀)`,
      'g'
    ),
    'teamKills'
  ],
  [
    new RegExp(`(?:全队|队伍|本队|己方|我方)(?:总)?(?:击杀|人头)\\s*(?:数)?\\s*${NUM}`, 'g'),
    'teamKills'
  ],
  [new RegExp(`${NUM}\\s*(?:金币|经济|金(?!克))`, 'g'), 'gold'],
  [new RegExp(`经济\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}(?!\\s*%)`, 'g'), 'gold'],
  [
    new RegExp(`(?<![差全队伍后先多少输赢]\\s*)${NUM}\\s*(?:次)?(?:击杀|杀(?![人手]))`, 'g'),
    'kills'
  ],
  [new RegExp(`${NUM}\\s*(?:次)?(?:死亡|阵亡|死)`, 'g'), 'deaths'],
  [new RegExp(`死亡\\s*(?:数)?\\s*${NUM}`, 'g'), 'deaths'],
  [new RegExp(`${NUM}\\s*(?:次)?助攻`, 'g'), 'assists'],
  [new RegExp(`KDA\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}`, 'gi'), 'kda'],
  [new RegExp(`${NUM}\\s*(?:的)?\\s*KDA`, 'gi'), 'kda'],
  [new RegExp(`参团率?\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}\\s*%`, 'g'), 'killParticipation'],
  [new RegExp(`${NUM}\\s*%\\s*(?:的)?\\s*参团`, 'g'), 'killParticipation'],
  [new RegExp(`伤害占比\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}\\s*%`, 'g'), 'damageShare'],
  [new RegExp(`${NUM}\\s*%\\s*(?:的)?\\s*伤害`, 'g'), 'damageShare'],
  [new RegExp(`承伤(?:占比)?\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}\\s*%`, 'g'), 'damageTakenShare'],
  [new RegExp(`${NUM}\\s*%\\s*(?:的)?\\s*承伤`, 'g'), 'damageTakenShare'],
  [new RegExp(`经济占比\\s*(?:仅|只有|高达|为|是)?\\s*${NUM}\\s*%`, 'g'), 'goldShare'],
  [new RegExp(`(?<!分均|每分钟)补刀\\s*(?:数)?\\s*${NUM}(?!\\s*[/每])`, 'g'), 'cs']
]

/** 主语切换到「别人」的指代词：出现在主语与数字之间时，主语不再可信，跳过 */
const OTHER_REF =
  /对面|对位|对方|对手|敌方|队友|另一位|有人|那位|其他人|别人|人家|胜方|败方|自家|上单|中单|打野|下路|上路|中路|辅助|ADC|玩家\s*\d/
/** 对比句：两组数并排时数字归属看语序，规则判不准，未点名的句子整句放过 */
const COMPARISON = /\d\s*%?\s*对\s*\d|对比|vs|VS|比/

/**
 * 从快照提取每名玩家的身份与指标
 * @param snapshot - 对局快照
 * @returns 每名玩家的 EntityFacts
 */
export function buildEntityFacts(snapshot: MatchSnapshot): EntityFacts[] {
  return snapshot.players.map(p => {
    const team = snapshot.teams.find(t => t.teamId === p.teamId)
    const stats: Partial<Record<StatField, number>> = {
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      kda: p.kda,
      gold: p.gold,
      cs: p.cs,
      csm: p.csm,
      damageShare: p.damageShare,
      damageTakenShare: p.damageTakenShare,
      goldShare: p.goldShare,
      killParticipation: p.killParticipation,
      teamKills: team?.totalKills
    }
    const diffs = Object.values((p.vsLaneOpponent ?? {}) as Record<string, unknown>)
      .filter((v): v is number => typeof v === 'number')
      .map(Math.abs)
    const teamNums = team
      ? [team.totalKills, team.totalDeaths, team.totalAssists, team.totalGold, team.totalDamage]
      : []
    const own = Object.values(stats).filter((v): v is number => typeof v === 'number')
    return {
      participantId: p.participantId,
      aliases: [p.champion, p.name].filter(
        (a: unknown): a is string => typeof a === 'string' && a.length > 0
      ),
      stats,
      // 派生数：击杀参与数（击杀 + 助攻），模型常写「25 次击杀参与」
      numbers: [...own, p.kills + p.assists, ...diffs, ...teamNums]
    }
  })
}

function near(x: number, n: number): boolean {
  // 容差 0.05 同 stripUngroundedSentences；「15.5k」类写法按千位对齐（允许 ±60 的取整）
  return Math.abs(n - x) <= 0.05 || (n >= 1000 && x >= 1000 && Math.abs(n - x) <= 60)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 句中每次点名的位置（别名不与后续数字粘连，避免「玩家1」命中「玩家10」） */
function mentionsIn(
  text: string,
  players: EntityFacts[]
): Array<{ at: number; end: number; p: EntityFacts }> {
  const out: Array<{ at: number; end: number; p: EntityFacts }> = []
  for (const p of players) {
    for (const a of p.aliases) {
      for (const m of text.matchAll(new RegExp(`${escapeRe(a)}(?!\\d)`, 'g'))) {
        out.push({ at: m.index!, end: m.index! + a.length, p })
      }
    }
  }
  return out.sort((x, y) => x.at - y.at)
}

/** 数字是否能算作该玩家的（同指标，或他的任一合理数字：对位差、队伍总数据…） */
function matchesOwner(p: EntityFacts, field: StatField, x: number): boolean {
  const own = p.stats[field]
  if (own !== undefined && near(x, own)) return true
  // 队伍总击杀只认本队总击杀：败方总死亡 = 胜方总击杀，放宽到全部数字会把记反的放过去
  return field !== 'teamKills' && p.numbers.some(n => near(x, n))
}

/** 该数字恰好是另一名玩家同一指标的值 → 返回那名玩家 */
function otherOwner(
  players: EntityFacts[],
  subject: EntityFacts,
  field: StatField,
  x: number
): EntityFacts | undefined {
  return players.find(
    p =>
      p.participantId !== subject.participantId &&
      p.stats[field] !== undefined &&
      near(x, p.stats[field]!)
  )
}

function reasonOf(
  token: string,
  subject: EntityFacts,
  owner: EntityFacts,
  field: StatField
): string {
  return `「${token.trim()}」写在 ${subject.aliases[0]} 名下，实为 ${owner.aliases[0]} 的 ${field}`
}

/** 主语与数字之间出现这些就说明中间换了人或在对比，主语不可信 */
const LOOSE_GAP = /[，,、；;—–：:（(]|给|被|把|让|对|比|和|与|跟|加|及|\d/

/**
 * 找出句子里的张冠李戴：某个「数字 + 指标词」与主语的该指标对不上，却恰好是另一名玩家的该指标
 * @param sentence - 已去掉列表项「名字：」前缀的句子
 * @param fallback - 句中完全没点名时的主语（列表项前缀点名的人 / 单人复盘目标）
 * @returns 判定理由；无问题为 null
 */
function findInSentence(
  sentence: string,
  fallback: EntityFacts | undefined,
  players: EntityFacts[]
): string | null {
  const mentions = mentionsIn(sentence, players)
  for (const [re, field] of STAT_PATTERNS) {
    for (const m of sentence.matchAll(re)) {
      let x = Number.parseFloat(m[1].replace(/,/g, ''))
      if (m[2] === '万') x *= 10000
      else if (m[2]) x *= 1000
      if (!Number.isFinite(x)) continue

      // 主语只认两种确定情形，其余一律放过（宁可漏判不可错杀）：
      // 1) 数字前紧挨着点名（「男枪自己只有 9500 金币」），中间没换人、没对比、没别的数字；
      // 2) 整句没点别人、没有「对面/队友/打野」等指代、也不是对比句 → 列表项前缀的人 / 单人复盘目标
      // 「12 杀的凯特琳」：数字紧接着修饰后面的人，归属看后面
      const end = m.index! + m[0].length
      const after = mentions.find(t => t.at >= end && /^\s*的?\s*$/.test(sentence.slice(end, t.at)))
      if (after) {
        if (!matchesOwner(after.p, field, x)) {
          const owner = otherOwner(players, after.p, field, x)
          if (owner) return reasonOf(m[0], after.p, owner, field)
        }
        continue
      }
      const before = mentions.filter(t => t.end <= m.index!)
      const last = before[before.length - 1]
      let subject: EntityFacts | undefined
      if (last) {
        const gap = sentence.slice(last.end, m.index!)
        // 「杰斯和韦鲁斯则用 9 次死亡和 8 次阵亡」：并列点名时数字归属不确定
        const prev = before[before.length - 2]
        const paired = prev && /^\s*(?:和|与|及|、|跟)\s*$/.test(sentence.slice(prev.end, last.at))
        if (!paired && gap.length <= 12 && !LOOSE_GAP.test(gap) && !OTHER_REF.test(gap)) {
          subject = last.p
        }
      } else if (
        // 句中点到的若只有主语本人（「队伍总击杀 28 个，蔚只沾到 6 个」），照样按主语核对
        mentions.every(t => t.p === fallback) &&
        !OTHER_REF.test(sentence) &&
        !COMPARISON.test(sentence) &&
        // 「你有 12 次击杀，他有 8 次死亡」：你/他 并举时「他」是别人
        !(/你/.test(sentence) && /[他她]/.test(sentence))
      ) {
        subject = fallback
      }
      if (!subject) continue

      if (matchesOwner(subject, field, x)) continue
      const owner = otherOwner(players, subject, field, x)
      if (owner) return reasonOf(m[0], subject, owner, field)
    }
  }
  return null
}

/** 逐句走查：对每个句子给出主语兜底与判定结果 */
function walk(
  markdown: string,
  material: MisattributionMaterial,
  onSentence: (sentence: string, reason: string | null) => void,
  onLine: (line: string) => void
): void {
  const { players, subjectId } = material
  const defaultSubject = players.find(p => p.participantId === subjectId)
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      onLine(line)
      continue
    }
    const bullet = line.match(/^(\s*[-*]\s+)([\s\S]*)$/)
    const content = bullet ? bullet[2] : line
    // 只认列表项开头的「名字：」（24 字内、句末标点前）；段落中间的冒号不是点名
    const headMatch = bullet ? content.match(/^[^。！？；!?;：]{1,24}：/) : null
    const colon = headMatch ? headMatch[0].length - 1 : -1
    const head =
      colon > 0
        ? new Set(mentionsIn(content.slice(0, colon), players).map(t => t.p))
        : new Set<EntityFacts>()
    // 句中未点名时的主语：列表项前缀点名的那一个人，否则单人复盘的目标
    const fallback = head.size === 1 ? [...head][0] : defaultSubject
    content.split(/(?<=[。!?;！？；])/).forEach((sentence, i) => {
      // 首句去掉「名字：」前缀再判定：前缀只用来定默认主语
      const body =
        i === 0 && colon > 0 && sentence.length > colon ? sentence.slice(colon + 1) : sentence
      onSentence(sentence, findInSentence(body, fallback, players))
    })
    onLine('\u0000' + (bullet ? bullet[1] : ''))
  }
}

/**
 * 列出张冠李戴的句子与理由（评测 / 排查用）
 * @param markdown - 模型输出
 * @param material - 玩家身份与指标
 * @returns 每条命中的句子与理由
 */
export function findMisattributions(
  markdown: string,
  material: MisattributionMaterial
): Array<{ sentence: string; reason: string }> {
  const hits: Array<{ sentence: string; reason: string }> = []
  if (!markdown || material.players.length === 0) return hits
  walk(
    markdown,
    material,
    (sentence, reason) => {
      if (reason) hits.push({ sentence: sentence.trim(), reason })
    },
    () => {}
  )
  return hits
}

/**
 * 剔除张冠李戴的句子
 * @param markdown - 模型输出（可为流式中间态）
 * @param material - 玩家身份与数字；无玩家时不过滤
 * @returns 过滤后的 markdown
 * @example
 * ```ts
 * stripMisattributedSentences('- 男枪：只有 9500 金币。', { players: buildEntityFacts(snap) })
 * // → ''（9500 是赵信的经济）
 * ```
 */
export function stripMisattributedSentences(
  markdown: string,
  material: MisattributionMaterial
): string {
  if (!markdown || material.players.length === 0) return markdown
  const out: string[] = []
  let kept: string[] = []
  walk(
    markdown,
    material,
    (sentence, reason) => {
      if (!reason) kept.push(sentence)
    },
    line => {
      if (line.startsWith('\u0000')) {
        const joined = kept.join('').trim()
        if (joined) out.push(line.slice(1) + joined)
        kept = []
      } else {
        out.push(line)
      }
    }
  )
  return out.join('\n')
}
