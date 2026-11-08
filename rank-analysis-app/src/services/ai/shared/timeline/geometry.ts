/**
 * 时间线几何工具：时间格式、距离、按时间插值玩家位置、按分钟取帧。
 * 帧粒度为 1 分钟，插值结果只能当"约"用。
 */
import type { SlimFrame, SlimTimeline } from './types'

/** 毫秒 → m:ss */
export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 两点欧氏距离 */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/**
 * 某玩家在某时刻的位置（相邻两帧线性插值；早于首帧/晚于末帧取端点）。
 * @returns 无该玩家数据时为 null
 */
export function positionAt(
  tl: SlimTimeline,
  pid: number,
  ms: number
): { x: number; y: number } | null {
  const pts = tl.frames
    .map(f => ({ t: f.timestamp, p: f.players.find(p => p.participantId === pid) }))
    .filter((v): v is { t: number; p: NonNullable<typeof v.p> } => !!v.p)
  if (pts.length === 0) return null
  if (ms <= pts[0].t) return { x: pts[0].p.x, y: pts[0].p.y }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (ms <= b.t) {
      const r = b.t === a.t ? 0 : (ms - a.t) / (b.t - a.t)
      return {
        x: Math.round(a.p.x + (b.p.x - a.p.x) * r),
        y: Math.round(a.p.y + (b.p.y - a.p.y) * r)
      }
    }
  }
  const last = pts[pts.length - 1]
  return { x: last.p.x, y: last.p.y }
}

/** 与 minute 分钟时间差 ≤30s 的最近帧 */
export function frameAtMinute(tl: SlimTimeline, minute: number): SlimFrame | undefined {
  const target = minute * 60000
  let best: SlimFrame | undefined
  for (const f of tl.frames) {
    const d = Math.abs(f.timestamp - target)
    if (d <= 30000 && (!best || d < Math.abs(best.timestamp - target))) best = f
  }
  return best
}
