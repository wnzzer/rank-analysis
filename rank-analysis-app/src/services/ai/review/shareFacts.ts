/**
 * 战报图的内容引擎：从复盘视图模型里挑出「这局最值得说的一件事」。
 *
 * 思路（spec：docs/superpowers/specs/2026-11-17-share-card-design.md）：
 * 1. 每类事实一个生成器（归责 / 牵制换资源 / KDA 与评分反差 / 分项突出 / 整体分位），
 *    产出带分数的候选；分数近似「稀有度」——越少见、越反直觉越高。
 * 2. 按标签定口吻：炫耀 / 洗冤 / 平常只用正面事实，自嘲版只用负面事实，
 *    避免 Carry 卡上出现「阵亡全是自己的锅」，也避免犯罪卡上替自己洗白。
 * 3. 第 1 条当标题，后 2 条做支撑；「换个角度」在前几条之间轮换标题。
 *
 * 只读视图模型，不重算评分；纯函数，同输入同输出。
 */
import type { VerdictLabel } from '../matchDetail/types'
import type { PlayerView, ReviewModel } from './buildReviewModel'

/** 口吻：炫耀 / 洗冤 / 平常 / 自嘲 */
export type ShareTone = 'brag' | 'vindicate' | 'neutral' | 'roast'

/** 分享入口的显眼程度：primary 直接展开；secondary 收起；opt-in 只给「自嘲版」入口 */
export type ShareTier = 'primary' | 'secondary' | 'opt-in'

/**
 * 标签在战报图上的文案
 * @property tagline - 标签下的一句人话：收图的人没用过工具也要看得懂
 */
export interface LabelCopy {
  tagline: string
  tone: ShareTone
  tier: ShareTier
}

/**
 * 标签 → 文案 / 口吻 / 入口级别。
 * 文案用第一人称：图是玩家自己发出去的，读起来是本人在说。
 * 分享动机强弱见 spec「谁最想分享」：被连累（洗冤）与 Carry（炫耀）最强。
 */
export const LABEL_COPY: Record<VerdictLabel, LabelCopy> = {
  Carry: { tagline: '这把我带飞', tone: 'brag', tier: 'primary' },
  尽力: { tagline: '赢了，我出力不少', tone: 'brag', tier: 'primary' },
  被连累: { tagline: '输了，但锅不在我', tone: 'vindicate', tier: 'primary' },
  被爆: { tagline: '被针对了，情有可原', tone: 'vindicate', tier: 'secondary' },
  正常: { tagline: '不功不过的一局', tone: 'neutral', tier: 'secondary' },
  缚地灵: { tagline: '发育拉满，团战不见人', tone: 'roast', tier: 'opt-in' },
  犯罪: { tagline: '这把……确实怪我', tone: 'roast', tier: 'opt-in' }
}

export type FactKind = 'traded' | 'blame' | 'contrast' | 'standout' | 'rank'

/**
 * 一条候选事实
 * @property headline - 当标题时的主句
 * @property detail - 补一句依据；没有为 null
 * @property score - 稀有度分，越高越值得说
 * @property polarity - good 给炫耀 / 洗冤 / 平常用，bad 只给自嘲版
 */
export interface ShareFact {
  kind: FactKind
  headline: string
  detail: string | null
  score: number
  polarity: 'good' | 'bad'
}

/** 阵亡少于这个数不谈归责：死 1~2 次说「责任只算 0.6 次」没有意义 */
export const BLAME_MIN_DEATHS = 3
/** 本人责任 / 阵亡次数 ≤ 这个比例才算「锅不在我」（0.6 时出现过「10 次只算 5.9 次」，「只」说不过去） */
export const BLAME_GOOD_RATIO = 0.5
/** 自嘲版：阵亡至少这么多、且本人责任占比 ≥ BLAME_BAD_RATIO 才说「都是自己的锅」 */
export const BLAME_BAD_MIN_DEATHS = 5
export const BLAME_BAD_RATIO = 0.9
/** 以少打多：人数差下标 = 敌方 − 我方 + 1 ≥ 3（与 deathAttribution 的 OUTNUMBERED_FACTOR 起点一致） */
export const OUTNUMBERED_GAP = 3
/** KDA 队内名次与评分队内名次至少差这么多才算反差 */
export const CONTRAST_MIN_GAP = 2
/** 整体分位：前 / 后这么多以内才值得上卡 */
export const RANK_NOTABLE = 20
/** 分项「大幅领先 / 落后」的等级词（plainScore.levelOf） */
const FAR_AHEAD = '大幅领先'
const FAR_BEHIND = '大幅落后'

/** 「换个角度」最多在前几条事实之间轮换 */
export const MAX_ANGLES = 3
/** 标题之外的支撑事实条数 */
export const SUPPORT_COUNT = 2

/** 同分时的稳定顺序：越靠前越独家 */
const KIND_ORDER: FactKind[] = ['traded', 'blame', 'contrast', 'standout', 'rank']

/** 责任次数显示一位小数，整数不带 .0 */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1))
const round1 = (v: number): number => Math.round(v * 10) / 10
const kdaOf = (p: PlayerView): number => (p.kills + p.assists) / Math.max(1, p.deaths)

/** 归责：本人责任明显少于阵亡次数（洗冤），或几乎全是自己的锅（自嘲） */
function blameFacts(me: PlayerView): ShareFact[] {
  const list = me.deathList
  if (!list || list.length < BLAME_MIN_DEATHS) return []
  const n = list.length
  const self = round1(list.reduce((s, d) => s + d.blame, 0))
  const ratio = self / n
  if (ratio <= BLAME_GOOD_RATIO) {
    const reasons: Array<[string, number]> = [
      ['队友先崩', list.filter(d => d.kind === 'collapse').length],
      ['以少打多', list.filter(d => d.enemies - d.allies + 1 >= OUTNUMBERED_GAP).length],
      ['被抓', list.filter(d => d.kind === 'ganked').length],
      ['团战中', list.filter(d => d.kind === 'fight').length]
    ]
    const detail = reasons
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([why, c]) => `${why} ${c} 次`)
      .join(' · ')
    return [
      {
        kind: 'blame',
        headline: `${n} 次阵亡，本人责任只算 ${fmt(self)} 次`,
        detail: detail || null,
        score: 1 + (1 - ratio) * 3,
        polarity: 'good'
      }
    ]
  }
  if (n >= BLAME_BAD_MIN_DEATHS && ratio >= BLAME_BAD_RATIO) {
    const solo = list.filter(d => d.kind === 'solo' || d.kind === 'isolated').length
    return [
      {
        kind: 'blame',
        headline: `${n} 次阵亡，${fmt(self)} 次算自己的`,
        detail: solo > 0 ? `被单杀 / 落单 ${solo} 次` : null,
        score: 1 + n / BLAME_BAD_MIN_DEATHS,
        polarity: 'bad'
      }
    ]
  }
  return []
}

/** 牵制换资源：被以少打多拖住，队友同时在别处拿到资源（模型第 3 层修正，别家没有） */
function tradedFacts(me: PlayerView): ShareFact[] {
  const traded = (me.deathList ?? []).filter(d => d.traded)
  if (!traded.length) return []
  const first = traded[0]
  const headline =
    traded.length === 1
      ? `被 ${first.enemies} 包 ${first.allies} 拖住，队友趁机拿到资源`
      : `${traded.length} 次以少打多拖住对面，队友趁机拿到资源`
  return [
    {
      kind: 'traded',
      headline,
      detail: `${first.time} ${first.zone}`,
      score: 3 + traded.length * 0.3,
      polarity: 'good'
    }
  ]
}

/** 反差：KDA 在队内的名次和评分名次对不上（表面 vs 真相） */
function contrastFacts(me: PlayerView, team: PlayerView[]): ShareFact[] {
  if (team.length < 3) return []
  const others = team.filter(p => p.participantId !== me.participantId)
  const kdaRank = 1 + others.filter(p => kdaOf(p) > kdaOf(me)).length
  const scoreRank = 1 + others.filter(p => p.total > me.total).length
  const gap = kdaRank - scoreRank
  if (Math.abs(gap) < CONTRAST_MIN_GAP) return []
  return [
    {
      kind: 'contrast',
      headline: `KDA 队内第 ${kdaRank}，评分队内第 ${scoreRank}`,
      detail: gap > 0 ? '数据不好看，活没少干' : '数据好看，作用有限',
      score: 1.5 + Math.abs(gap) * 0.5,
      polarity: gap > 0 ? 'good' : 'bad'
    }
  ]
}

/** 分项突出：大幅领先 / 大幅落后同位置同英雄 */
function standoutFacts(me: PlayerView): ShareFact[] {
  return me.parts.flatMap(part => {
    if (part.level !== FAR_AHEAD && part.level !== FAR_BEHIND) return []
    const good = part.level === FAR_AHEAD
    return [
      {
        kind: 'standout' as const,
        headline: `${part.cn}${part.level}同位置同英雄`,
        detail: part.stats[0] ?? null,
        score: 1.5 + Math.min(Math.abs(part.value) - 1.5, 2) * 0.5,
        polarity: good ? ('good' as const) : ('bad' as const)
      }
    ]
  })
}

/** 整体分位：只说前 / 后 RANK_NOTABLE% 以内 */
function rankFacts(me: PlayerView): ShareFact[] {
  const m = me.rank?.match(/(前|后) (\d+)%/)
  if (!m) return []
  const x = Number(m[2])
  if (x > RANK_NOTABLE) return []
  const good = m[1] === '前'
  return [
    {
      kind: 'rank',
      headline: `本局表现约在同位置玩家${m[1]} ${x}%`,
      detail: null,
      score: 1 + (RANK_NOTABLE + 5 - x) / 10,
      polarity: good ? 'good' : 'bad'
    }
  ]
}

/**
 * 某玩家的全部候选事实，按分数降序（同分按 KIND_ORDER）
 * @param me - 战报主角
 * @param team - 主角所在队伍（含主角），反差事实用
 */
export function shareFacts(me: PlayerView, team: PlayerView[]): ShareFact[] {
  const all = [
    ...tradedFacts(me),
    ...blameFacts(me),
    ...contrastFacts(me, team),
    ...standoutFacts(me),
    ...rankFacts(me)
  ]
  return all.sort(
    (a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  )
}

/** 按口吻筛事实：自嘲只要负面，其余只要正面 */
export function factsForTone(facts: ShareFact[], tone: ShareTone): ShareFact[] {
  const want = tone === 'roast' ? 'bad' : 'good'
  return facts.filter(f => f.polarity === want)
}

/**
 * 某个角度下的标题与支撑
 * @param angle - 第几个角度（0 起），超出 MAX_ANGLES / 事实数时取模轮换
 */
export function pickAngle(
  facts: ShareFact[],
  angle: number
): { headline: ShareFact | null; support: ShareFact[] } {
  if (!facts.length) return { headline: null, support: [] }
  const span = Math.min(MAX_ANGLES, facts.length)
  const i = ((angle % span) + span) % span
  const headline = facts[i]
  return { headline, support: facts.filter(f => f !== headline).slice(0, SUPPORT_COUNT) }
}

/** 角度个数（「换个角度」按钮只在 > 1 时显示） */
export const angleCount = (facts: ShareFact[]): number => Math.min(MAX_ANGLES, facts.length)

/**
 * 战报图数据
 * @property facts - 已按口吻筛过、按分数排好的事实
 * @property parts - 分项等级条（只取等级词，不展示分数）
 */
export interface ShareCard {
  label: VerdictLabel
  copy: LabelCopy
  name: string
  champion: string
  championId: number
  roleCn: string
  win: boolean
  kda: string
  facts: ShareFact[]
  parts: Array<{ cn: string; level: string; bar: number }>
}

/**
 * 从复盘视图模型构建本人的战报图；找不到本人返回 null
 * @param tone - 指定口吻（自嘲版传 'roast'）；缺省按标签
 */
export function buildShareCard(model: ReviewModel, tone?: ShareTone): ShareCard | null {
  const players = Object.values(model.players)
  const me = players.find(p => p.isMe)
  if (!me) return null
  const copy = LABEL_COPY[me.label]
  const team = players.filter(p => p.teamId === me.teamId)
  return {
    label: me.label,
    copy,
    name: me.name,
    champion: me.champion,
    championId: me.championId,
    roleCn: me.roleCn,
    win: me.win,
    kda: `${me.kills}/${me.deaths}/${me.assists}`,
    facts: factsForTone(shareFacts(me, team), tone ?? copy.tone),
    parts: me.parts.map(p => ({ cn: p.cn, level: p.level, bar: p.bar }))
  }
}
