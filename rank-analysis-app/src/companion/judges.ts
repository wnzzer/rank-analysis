/**
 * C4 赛后评审：规则徽章引擎 + 三风格 AI 裁判。
 *
 * 纪律（与计划 §C4 一致）：
 * - **徽章是确定性规则**（非 AI）：可复现、可解释，失败零成本
 * - 三位 AI 裁判只产观点文本；LLM 调用经 `callLLM` 注入，本模块不做网络请求
 *
 * 输入模型刻意与具体对局来源解耦（LCU 详情 / SGP 详情都能映射成
 * `JudgePlayer[]`，见 [`judgePlayersFromGame`]）。
 */

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/** 参与者统计（打分/发徽章所需最小集） */
export interface JudgePlayer {
  /** 展示名（gameName#tag 或 summonerName） */
  name: string
  championName?: string
  /** 队伍号（100/200 等；仅用于分组比较） */
  team: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  /** 对英雄伤害 */
  damageDealt: number
  damageTaken: number
  /** 对塔伤害 */
  turretDamage: number
  heal: number
  goldEarned: number
}

export interface Badge {
  key: string
  label: string
  desc: string
  tier: 'gold' | 'silver'
}

const kdaOf = (p: JudgePlayer): number =>
  p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths

function maxBy<T>(items: T[], value: (t: T) => number): T | null {
  let best: T | null = null
  let bestV = -Infinity
  for (const it of items) {
    const v = value(it)
    if (v > bestV) {
      best = it
      bestV = v
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 徽章规则引擎
// ---------------------------------------------------------------------------

/**
 * 全场徽章计算。
 *
 * 规则一览：
 * - 输出之王（金）：全场对英雄伤害最高
 * - KDA 扛把子（金）：KDA 最高（0 死按击杀+助攻计）
 * - 虽败犹荣（金）：败方中对英雄伤害最高
 * - 推塔达人 / 承伤堡垒 / 治疗天使 / 经济王（银）：对应维度全场最高
 * - 躺赢大师（银）：胜方贡献（伤害+塔伤）最低者——仅当胜方 ≥3 人时颁发，
 *   避免小样本闹笑话
 */
export function computeBadges(players: JudgePlayer[]): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>()
  const give = (p: JudgePlayer, b: Badge) => {
    const list = out.get(p.name) ?? []
    list.push(b)
    out.set(p.name, list)
  }
  if (!players.length) return out

  const dmgKing = maxBy(players, p => p.damageDealt)
  if (dmgKing) {
    give(dmgKing, {
      key: 'damage-king',
      label: '输出之王',
      desc: `全场最高英雄伤害 ${dmgKing.damageDealt.toLocaleString()}`,
      tier: 'gold'
    })
  }

  const kdaKing = maxBy(
    players.filter(p => p.kills + p.deaths + p.assists > 0),
    kdaOf
  )
  if (kdaKing && kdaOf(kdaKing) >= 3) {
    give(kdaKing, {
      key: 'kda-king',
      label: 'KDA 扛把子',
      desc: `KDA ${kdaOf(kdaKing).toFixed(2)}（${kdaKing.kills}/${kdaKing.deaths}/${kdaKing.assists}）`,
      tier: 'gold'
    })
  }

  const losers = players.filter(p => !p.win)
  const carryLoss = maxBy(losers, p => p.damageDealt)
  if (carryLoss && carryLoss.damageDealt > 0) {
    give(carryLoss, {
      key: 'carry-loss',
      label: '虽败犹荣',
      desc: `败方最高输出 ${carryLoss.damageDealt.toLocaleString()}`,
      tier: 'gold'
    })
  }

  const tower = maxBy(
    players.filter(p => p.turretDamage > 0),
    p => p.turretDamage
  )
  if (tower) {
    give(tower, {
      key: 'tower',
      label: '推塔达人',
      desc: `对塔伤害 ${tower.turretDamage.toLocaleString()}`,
      tier: 'silver'
    })
  }

  const tank = maxBy(players, p => p.damageTaken)
  if (tank && tank.damageTaken > 0) {
    give(tank, {
      key: 'tank',
      label: '承伤堡垒',
      desc: `承受伤害 ${tank.damageTaken.toLocaleString()}`,
      tier: 'silver'
    })
  }

  const healer = maxBy(
    players.filter(p => p.heal > 0),
    p => p.heal
  )
  if (healer) {
    give(healer, {
      key: 'healer',
      label: '治疗天使',
      desc: `治疗量 ${healer.heal.toLocaleString()}`,
      tier: 'silver'
    })
  }

  const eco = maxBy(players, p => p.goldEarned)
  if (eco && eco.goldEarned > 0) {
    give(eco, {
      key: 'economy',
      label: '经济王',
      desc: `经济 ${eco.goldEarned.toLocaleString()}`,
      tier: 'silver'
    })
  }

  const winners = players.filter(p => p.win)
  if (winners.length >= 3) {
    const contrib = (p: JudgePlayer) => p.damageDealt + p.turretDamage
    const sleeper = winners.reduce((acc, p) => (contrib(p) < contrib(acc) ? p : acc), winners[0])
    give(sleeper, {
      key: 'sleeper-win',
      label: '躺赢大师',
      desc: `胜方贡献最低（伤害 ${sleeper.damageDealt.toLocaleString()}）但赢了就是赢了`,
      tier: 'silver'
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// 三风格 AI 裁判（观点文本；LLM 注入）
// ---------------------------------------------------------------------------

export interface JudgeStyle {
  id: string
  label: string
  system: string
}

export const JUDGE_STYLES: JudgeStyle[] = [
  {
    id: 'sharp',
    label: '锐评',
    system:
      '你是毒舌但专业的英雄联盟锐评人。点评直击要害、引用数据，允许适度犀利，禁止人身攻击。50 字以内。'
  },
  {
    id: 'gentle',
    label: '暖评',
    system: '你是温暖的鼓励型教练。先肯定亮点，再温和指出一个改进点。50 字以内。'
  },
  {
    id: 'data',
    label: '数据控',
    system: '你是数据分析员。只陈述数据事实与一个最关键的结论，不评价态度。50 字以内。'
  }
]

/** 把参与者压成紧凑表格文本（控制 token）。 */
export function buildRosterText(players: JudgePlayer[], me: string): string {
  const rows = players.map(
    p =>
      `- ${p.name === me ? '★' : ''}${p.name}（${p.championName ?? '?'}，${p.win ? '胜' : '负'}）` +
      ` KDA ${p.kills}/${p.deaths}/${p.assists}` +
      `，英雄伤害 ${p.damageDealt}，承伤 ${p.damageTaken}` +
      `，塔伤 ${p.turretDamage}，治疗 ${p.heal}，经济 ${p.goldEarned}`
  )
  return rows.join('\n')
}

export function buildJudgeUserPrompt(
  style: JudgeStyle,
  players: JudgePlayer[],
  me: string
): string {
  const mePlayer = players.find(p => p.name === me) ?? players[0]
  return (
    `对局数据（★ 为被点评玩家 ${me}）：\n${buildRosterText(players, me)}\n\n` +
    `请以「${style.label}」视角点评 ★${mePlayer?.name ?? ''} 这局的表现，直接给结论。`
  )
}

export interface JudgeResult {
  styleId: string
  label: string
  text: string
}

/**
 * 并行跑三风格裁判。
 *
 * `callLLM(userPrompt, systemPrompt)` 由调用方注入（接 stream.ts 的
 * requestAIContent）；单个裁判失败不影响其他，失败的直接缺席结果列表。
 */
export async function runJudges(
  players: JudgePlayer[],
  me: string,
  callLLM: (userPrompt: string, systemPrompt: string) => Promise<string | null>
): Promise<JudgeResult[]> {
  const tasks = JUDGE_STYLES.map(async style => {
    const text = await callLLM(buildJudgeUserPrompt(style, players, me), style.system)
    return text ? { styleId: style.id, label: style.label, text } : null
  })
  const settled = await Promise.allSettled(tasks)
  return settled
    .map(s => (s.status === 'fulfilled' ? s.value : null))
    .filter((v): v is JudgeResult => v != null)
}

// ---------------------------------------------------------------------------
// 来源适配器：LCU/SGP 对局详情 → JudgePlayer[]
// ---------------------------------------------------------------------------

interface RawParticipantLike {
  participantId?: number
  teamId?: number
  championId?: number
  stats?: {
    win?: boolean
    kills?: number
    deaths?: number
    assists?: number
    goldEarned?: number
    totalDamageDealtToChampions?: number
    totalDamageTaken?: number
    damageDealtToTurrets?: number
    totalHeal?: number
  }
}

interface RawGameLike {
  participants?: RawParticipantLike[]
  participantIdentities?: Array<{ player?: { gameName?: string; summonerName?: string } }>
}

/**
 * 宽松适配：LCU `lol-match-history/v1/games/{id}` 详情结构 → JudgePlayer[]。
 * identities[i] 与 participants[i] 按下标一一对应（LCU 约定）；字段缺失降级为 0。
 */
export function judgePlayersFromGame(game: RawGameLike): JudgePlayer[] {
  const parts = game.participants ?? []
  const ids = game.participantIdentities ?? []
  return parts.map((p, i) => ({
    name:
      ids[i]?.player?.gameName || ids[i]?.player?.summonerName || `玩家${p.participantId ?? i + 1}`,
    team: p.teamId ?? 0,
    win: p.stats?.win === true,
    kills: p.stats?.kills ?? 0,
    deaths: p.stats?.deaths ?? 0,
    assists: p.stats?.assists ?? 0,
    damageDealt: p.stats?.totalDamageDealtToChampions ?? 0,
    damageTaken: p.stats?.totalDamageTaken ?? 0,
    turretDamage: p.stats?.damageDealtToTurrets ?? 0,
    heal: p.stats?.totalHeal ?? 0,
    goldEarned: p.stats?.goldEarned ?? 0
  }))
}
