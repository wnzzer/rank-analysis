/**
 * 复盘图表的纯几何换算：经济曲线（分钟/经济差 → 百分比坐标、折线 path、悬停读数）与小地图坐标。
 * 与组件分离以便单测（jsdom 下没有真实布局）。
 */
import type { CurvePoint } from '@renderer/services/ai/review/buildReviewModel'
import { fmtTime } from '@renderer/services/ai/shared/timeline/geometry'

/** 最大经济差占半高的比例（上下留白） */
const CURVE_FILL = 0.9

/** 召唤师峡谷坐标边长（与 zoneOf 同一坐标系，蓝方基地在左下 (0,0)） */
export const RIFT_SIZE = 14870

const clamp100 = (v: number): number => Math.min(100, Math.max(0, v))

/** 分钟 → 横向百分比（0~100） */
export function xPercent(minute: number, endMinute: number): number {
  return endMinute > 0 ? clamp100((minute / endMinute) * 100) : 0
}

/** 经济差 → 纵向百分比（0 = 顶，50 = 持平线；蓝方领先在上） */
export function yPercent(diff: number, maxAbs: number): number {
  return maxAbs > 0 ? 50 - (diff / maxAbs) * 50 * CURVE_FILL : 50
}

/** 折线 path（SVG viewBox 0 0 100 100） */
export function curvePath(points: CurvePoint[], endMinute: number, maxAbs: number): string {
  return points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xPercent(p.minute, endMinute).toFixed(2)} ${yPercent(p.diff, maxAbs).toFixed(2)}`
    )
    .join(' ')
}

/** 离某分钟最近的点；空数组为 null */
export function nearestPoint(points: CurvePoint[], minute: number): CurvePoint | null {
  let best: CurvePoint | null = null
  for (const p of points) {
    if (!best || Math.abs(p.minute - minute) < Math.abs(best.minute - minute)) best = p
  }
  return best
}

/** 悬停读数，如「12:00 蓝方领先 1234」 */
export function leadText(p: CurvePoint): string {
  const t = fmtTime(p.minute * 60000)
  const n = Math.round(p.diff)
  if (n === 0) return `${t} 经济持平`
  return `${t} ${n > 0 ? '蓝方' : '红方'}领先 ${Math.abs(n)}`
}

/** 地图坐标 → 小地图百分比位置（越界夹到边缘） */
export function mapPercent(x: number, y: number): { left: number; top: number } {
  return { left: clamp100((x / RIFT_SIZE) * 100), top: clamp100(100 - (y / RIFT_SIZE) * 100) }
}
