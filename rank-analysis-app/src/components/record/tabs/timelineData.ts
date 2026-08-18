/**
 * 详情页「时间线」tab 的纯函数层：
 * - 从 SGP DETAILS 帧流提取每人每分钟的金 / CS / 经验序列
 * - 曲线指标定义（含取值器与最大值封顶）
 *
 * 与 `detailsTable.ts` / `eventsTable.ts` 同层：UI 只消费纯函数结果，可单测。
 */

import type { SgpGameDetail } from '@renderer/features/record/services/sgp'

export type TimelineMetric = 'gold' | 'cs' | 'xp'

export interface TimelineMetricDef {
  kind: TimelineMetric
  label: string
  /** 取该帧某人的指标值（无数据返回 0，不抛错） */
  value: (frame: Record<string, unknown> | undefined) => number
}

const CS_OF = (frame: Record<string, unknown> | undefined): number => {
  if (!frame) return 0
  const minions = typeof frame.minionsKilled === 'number' ? frame.minionsKilled : 0
  const jungle = typeof frame.jungleMinionsKilled === 'number' ? frame.jungleMinionsKilled : 0
  return minions + jungle
}

export const TIMELINE_METRICS: TimelineMetricDef[] = [
  {
    kind: 'gold',
    label: '金币',
    value: frame => (frame && typeof frame.currentGold === 'number' ? frame.currentGold : 0)
  },
  { kind: 'cs', label: '补刀', value: CS_OF },
  {
    kind: 'xp',
    label: '经验',
    value: frame => (frame && typeof frame.xp === 'number' ? frame.xp : 0)
  }
]

export interface TimelinePoint {
  /** 分钟（0, 1, 2, …），由帧 timestamp 换算 */
  minute: number
  value: number
}

export interface TimelineSeries {
  /** 与 TIMELINE_METRICS 对齐（同 index 同 metric），无数据时为空数组 */
  byParticipant: Record<number, TimelinePoint[]>
  /** 全场分钟轴（第一帧与最后一帧之间） */
  minutes: number[]
  /** 该局总帧数（数据长度提示） */
  frameCount: number
}

const MINUTE_MS = 60_000

/**
 * 从 DETAILS 帧流构建时间线数据。
 * @param detail - SGP 单局详情（可为 null/无帧）
 * @param metric - 曲线指标
 */
export function buildTimelineSeries(
  detail: SgpGameDetail | null | undefined,
  metric: TimelineMetric
): TimelineSeries {
  const def = TIMELINE_METRICS.find(m => m.kind === metric) ?? TIMELINE_METRICS[0]
  const frames = detail?.frames ?? []
  if (!frames.length) {
    return { byParticipant: {}, minutes: [], frameCount: 0 }
  }

  // 分钟轴：0 → maxMinute（含两端，保证曲线横轴稳定）
  const maxMinute = Math.max(0, ...frames.map(f => Math.floor((f.timestamp ?? 0) / MINUTE_MS)))
  const minutes: number[] = []
  for (let m = 0; m <= maxMinute; m++) minutes.push(m)

  const byParticipant: Record<number, TimelinePoint[]> = {}
  for (const frame of frames) {
    const minute = Math.floor((frame.timestamp ?? 0) / MINUTE_MS)
    for (const [pidStr, stats] of Object.entries(frame.participantFrames ?? {})) {
      const pid = Number(pidStr)
      if (!Number.isFinite(pid)) continue
      if (!byParticipant[pid]) byParticipant[pid] = []
      byParticipant[pid].push({ minute, value: def.value(stats as Record<string, unknown>) })
    }
  }

  return { byParticipant, minutes, frameCount: frames.length }
}

/**
 * 归一化填充：把某人稀疏的采样点铺满分钟轴（缺失分钟沿用前值），
 * 供折线绘制——避免缺帧造成断线。
 */
export function fillSeries(
  series: Record<number, TimelinePoint[]>,
  minutes: number[]
): Record<number, TimelinePoint[]> {
  const out: Record<number, TimelinePoint[]> = {}
  for (const [pidStr, points] of Object.entries(series)) {
    const pid = Number(pidStr)
    const byMinute = new Map(points.map(p => [p.minute, p.value]))
    let last = 0
    out[pid] = minutes.map(minute => {
      const v = byMinute.get(minute)
      if (v !== undefined) {
        last = v
        return { minute, value: v }
      }
      return { minute, value: last }
    })
  }
  return out
}
