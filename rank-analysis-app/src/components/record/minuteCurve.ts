/**
 * D-P3 分时曲线纯函数层：SGP DETAILS 帧流 → 本人逐分钟曲线 → 跨局平均。
 *
 * 与 `timelineData.ts` 同层（详情页时间线用金/CS/经验，这里是趋势卡用的
 * 补刀/死亡/参团——跨近 10 场平均，呈现「长期画像」的分钟维度）：
 * - `buildGameMinuteCurve`：单局帧流 → 本人按分钟（CS 累计 / 死亡累计 / 参团击杀数）
 * - `aggregateMinuteCurves`：多局 → 对齐分钟轴后按场平均
 *
 * 纪律：帧缺失/无自身 participantId 的单局返回 null（不编造）；死亡与参团
 * 事件只认 `CHAMPION_KILL`（与事件 tab 同口径）。
 */

import type { SgpGameDetail } from '@renderer/services/sgp'
export type { SgpGameDetail }

/** 分钟轴封顶：极端长局（青铜乱斗/大乱斗时长）也截到 60 分钟，防野轴 */
export const MAX_CURVE_MINUTES = 60

/** 单局曲线：本人每分钟的累计补刀 / 累计死亡 / 该分钟参团击杀数 */
export interface GameMinuteCurve {
  /** 该局分钟轴（0..maxMinute，已封顶 MAX_CURVE_MINUTES） */
  minutes: number[]
  /** 每分钟累计补刀（含野怪；缺帧沿用前值） */
  csByMinute: number[]
  /** 每分钟累计死亡（单调不减） */
  deathsByMinute: number[]
  /** 每分钟参团击杀数（自己击杀或助攻击杀的 CHAMPION_KILL 事件数） */
  fightsByMinute: number[]
}

/** 跨局平均曲线（对齐分钟轴 = 各局最大分钟的最大值，场均） */
export interface AggregatedMinuteCurve {
  /** 对齐后的分钟轴（0..maxMinute） */
  minutes: number[]
  /** 场均累计补刀 */
  cs: number[]
  /** 场均累计死亡 */
  deaths: number[]
  /** 场均每分钟参团击杀数 */
  fights: number[]
  /** 成功解析的场数（失败/无帧/无自身的局不计入） */
  sourceCount: number
}

const MINUTE_MS = 60_000

/** 帧里的补刀累计（含野怪；字段缺失按 0，不抛错） */
function csOf(frame: Record<string, unknown>): number {
  const minions = typeof frame.minionsKilled === 'number' ? frame.minionsKilled : 0
  const jungle = typeof frame.jungleMinionsKilled === 'number' ? frame.jungleMinionsKilled : 0
  return minions + jungle
}

/**
 * 单局 SGP 详情 → 本人按分钟曲线。
 *
 * @param detail - SGP 单局详情（null/无帧/无自身 → 返回 null）
 * @param selfPuuid - 本人 puuid（与 DETAILS participants 匹配）
 */
export function buildGameMinuteCurve(
  detail: SgpGameDetail | null | undefined,
  selfPuuid: string
): GameMinuteCurve | null {
  if (!detail || !selfPuuid) return null
  const frames = detail.frames ?? []
  if (frames.length === 0) return null

  const self = (detail.participants ?? []).find(p => p.puuid === selfPuuid)
  if (!self || self.participantId == null) return null
  const pid = self.participantId

  const maxMinute = Math.min(
    MAX_CURVE_MINUTES,
    Math.max(0, ...frames.map(f => Math.floor((f.timestamp ?? 0) / MINUTE_MS)))
  )
  const minutes: number[] = []
  for (let m = 0; m <= maxMinute; m++) minutes.push(m)

  // 累计值：稀疏采样 → 铺满分钟轴（缺帧沿用前值，与 fillSeries 同思路）
  const csByMinute = new Array<number>(maxMinute + 1).fill(0)
  const seenCs = new Map<number, number>()
  for (const frame of frames) {
    const minute = Math.floor((frame.timestamp ?? 0) / MINUTE_MS)
    if (minute > maxMinute) continue
    const stats = frame.participantFrames?.[pid]
    if (!stats) continue
    seenCs.set(minute, csOf(stats as unknown as Record<string, unknown>))
  }
  let lastCs = 0
  for (let m = 0; m <= maxMinute; m++) {
    const v = seenCs.get(m)
    if (v !== undefined) lastCs = v
    csByMinute[m] = lastCs
  }

  const deathsByMinute = new Array<number>(maxMinute + 1).fill(0)
  const fightsByMinute = new Array<number>(maxMinute + 1).fill(0)
  for (const frame of frames) {
    const minute = Math.floor((frame.timestamp ?? 0) / MINUTE_MS)
    if (minute > maxMinute) continue
    for (const ev of frame.events ?? []) {
      if (ev.type !== 'CHAMPION_KILL') continue
      if (ev.victimId === pid) deathsByMinute[minute]++
      if (ev.killerId === pid || (ev.assistingParticipantIds ?? []).includes(pid)) {
        fightsByMinute[minute]++
      }
    }
  }
  // 死亡累计化（单调不减，与 CS 同轴可比）
  for (let m = 1; m <= maxMinute; m++) {
    deathsByMinute[m] += deathsByMinute[m - 1]
  }

  return { minutes, csByMinute, deathsByMinute, fightsByMinute }
}

/**
 * 多局曲线 → 对齐分钟轴后的场均曲线。
 *
 * @param curves - 单局曲线列表（null = 该局无法解析，不计入样本）
 * @returns 场均聚合；无有效局时返回 null
 */
export function aggregateMinuteCurves(
  curves: (GameMinuteCurve | null)[]
): AggregatedMinuteCurve | null {
  const valid = curves.filter((c): c is GameMinuteCurve => c !== null)
  if (valid.length === 0) return null

  const maxMinute = Math.max(...valid.map(c => c.minutes.length - 1))
  const cs = new Array<number>(maxMinute + 1).fill(0)
  const deaths = new Array<number>(maxMinute + 1).fill(0)
  const fights = new Array<number>(maxMinute + 1).fill(0)
  // 每分钟的在局数：已结束的局不参与该分钟之后的平均（不稀释长局时段）
  const counts = new Array<number>(maxMinute + 1).fill(0)

  for (const c of valid) {
    const end = c.minutes.length - 1
    for (let m = 0; m <= end; m++) {
      cs[m] += c.csByMinute[m] ?? 0
      deaths[m] += c.deathsByMinute[m] ?? 0
      fights[m] += c.fightsByMinute[m] ?? 0
      counts[m]++
    }
  }

  const minutes: number[] = []
  for (let m = 0; m <= maxMinute; m++) minutes.push(m)

  return {
    minutes,
    cs: cs.map((v, m) => v / counts[m]),
    deaths: deaths.map((v, m) => v / counts[m]),
    fights: fights.map((v, m) => v / counts[m]),
    sourceCount: valid.length
  }
}

/**
 * 分钟曲线关键特征（喂给成长报告 prompt 的确定性事实——AI 只引用，不解释来源）。
 *
 * 提炼而非全量曲线：60 分钟 × 3 系列的原始数组对 LLM 无意义，特征点才是
 * 「15 分钟补刀落后」「死亡集中段」这类结论可引用的数字。
 */
export interface MinuteCurveInsights {
  /** 15 分钟累计补刀（场均；轴不足 15 分钟时取末值） */
  csAt15: number
  /** 25 分钟累计补刀（同上） */
  csAt25: number
  /** 15 分钟前累计死亡（场均） */
  deathsBy15: number
  /** 整场累计死亡（场均） */
  deathsTotal: number
  /** 死亡集中段（死亡累计增速最快的分钟段，升序，最多 3 个） */
  deathSpikeMinutes: number[]
  /** 参团击杀最活跃的分钟段（最多 3 个） */
  fightPeakMinutes: number[]
  /** 每分钟平均参团击杀 */
  avgFightsPerMin: number
}

const at = (values: number[], minute: number) => values[Math.min(minute, values.length - 1)] ?? 0

/** 累计序列的增速（相邻差值）最高的分钟段；不足两分钟轴时返回空 */
function spikeMinutes(values: number[], top: number): number[] {
  const deltas = values.slice(1).map((v, i) => ({ m: i + 1, d: v - values[i] }))
  return deltas
    .sort((a, b) => b.d - a.d)
    .slice(0, top)
    .map(x => x.m)
    .sort((a, b) => a - b)
}

/** 事件序列（每分钟次数）最高的分钟段；全部为 0 时返回空 */
function peakMinutes(values: number[], top: number): number[] {
  const indexed = values
    .map((v, m) => ({ m, v }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, top)
    .map(x => x.m)
    .sort((a, b) => a - b)
  return indexed
}

/**
 * 聚合曲线 → 特征摘要。
 *
 * @param curve - 场均分钟曲线（null → null，调用方降级不带曲线）
 * @returns 特征对象；无有效曲线时 null
 */
export function summarizeMinuteCurve(
  curve: AggregatedMinuteCurve | null
): MinuteCurveInsights | null {
  if (!curve || curve.minutes.length === 0) return null
  const n = curve.minutes.length - 1
  return {
    csAt15: Math.round(at(curve.cs, Math.min(15, n))),
    csAt25: Math.round(at(curve.cs, Math.min(25, n))),
    deathsBy15: Math.round(at(curve.deaths, Math.min(15, n)) * 10) / 10,
    deathsTotal: Math.round(at(curve.deaths, n) * 10) / 10,
    deathSpikeMinutes: spikeMinutes(curve.deaths, 3),
    fightPeakMinutes: peakMinutes(curve.fights, 3),
    avgFightsPerMin:
      Math.round((curve.fights.reduce((a, b) => a + b, 0) / curve.fights.length) * 100) / 100
  }
}
