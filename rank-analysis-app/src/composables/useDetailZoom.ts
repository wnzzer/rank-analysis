/**
 * 对局详情窗等比缩放
 *
 * 内容按固定设计宽 {@link DETAIL_DESIGN_WIDTH} 排版一次，窗口尺寸只决定 CSS zoom 比例
 * （铺满）；Ctrl+滚轮 / Ctrl± / Ctrl+0 在铺满基础上乘一个倍率，持久化到
 * settings.ui.detailZoomFactor，与主窗口 webview 缩放互不影响。
 *
 * 用 CSS zoom 而非 webview.setZoom：与布局同步（拖动窗口边缘不慢一拍）、28px 标题栏
 * 不跟着缩、不污染主窗口的缩放比例。teleport 到 body 的浮层（tooltip / AI 复盘弹窗）
 * 不随 zoom 缩放，保持 1 倍可读；其定位依赖 Chromium ≥128 标准化 zoom 下
 * getBoundingClientRect 返回视觉坐标。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { createDebouncedSave, isValidZoomFactor, nextZoomFactor, useZoomHotkeys } from './useZoom'

/** 设计稿宽度（CSS px）：详情内容永远按这个宽度排版 */
export const DETAIL_DESIGN_WIDTH = 1280
/** 铺满比例下限：再小字就看不清，改为出滚动条 */
export const DETAIL_FIT_MIN = 0.8
/** 铺满比例上限 */
export const DETAIL_FIT_MAX = 2
/** 倍率提示显示时长 */
const BADGE_MS = 1200
/** 按目标比例复量自然高度时的余量：吸收再次换比例后的 ±1px 行高取整 */
const FIT_SLACK_PX = 2

/**
 * 计算详情内容的缩放比例（纯函数，便于单测）
 *
 * 宽度方向必放得下；内容比窗口矮时按高度放大到刚好填满（不超过宽度上限）；
 * 内容比窗口高（如斗魂竞技场 8 队）时不因高度缩小，改为纵向滚动。
 * @param availW - 标题栏以下可用宽（CSS px）
 * @param availH - 标题栏以下可用高（CSS px）
 * @param contentH - 内容在设计宽下的自然高度；≤0 表示尚未渲染，只按宽度铺满
 * @param userFactor - 用户倍率（Ctrl+滚轮），1 = 纯铺满
 * @returns 三位小数的 zoom 比例（向下取整：四舍五入会让 1280×比例 超出可用宽零点几像素，
 *   实测在 1300 宽窗口里冒出一条横向滚动条）
 * @example
 * ```ts
 * computeDetailScale(2485, 1323, 845, 1) // 1.565（最大化，由高度约束）
 * ```
 */
export function computeDetailScale(
  availW: number,
  availH: number,
  contentH: number,
  userFactor: number
): number {
  const widthFit = availW / DETAIL_DESIGN_WIDTH
  const heightFit = contentH > 0 ? Math.max(availH / contentH, 1) : Infinity
  const fit = Math.min(DETAIL_FIT_MAX, Math.max(DETAIL_FIT_MIN, Math.min(widthFit, heightFit)))
  return Math.floor(fit * userFactor * 1000) / 1000
}

/** useDetailZoom 需要的两个元素 */
export interface DetailZoomOptions {
  /** 标题栏以下的可用区域（不缩放；决定可用宽高，自身负责横向溢出滚动） */
  area: Ref<HTMLElement | null>
  /** 缩放容器（宽固定为设计宽，挂 CSS zoom） */
  container: Ref<HTMLElement | null>
}

/**
 * 详情窗缩放：铺满 × 用户倍率
 * @param opts - 可用区与缩放容器
 */
export function useDetailZoom({ area, container }: DetailZoomOptions) {
  /** 当前生效的 zoom 比例 */
  const scale = ref(1)
  /** 用户倍率（Ctrl+滚轮），1 = 纯铺满 */
  const userFactor = ref(1)
  /** 倍率提示文案（如 "110%"），null 时不显示 */
  const badge = ref<string | null>(null)
  const saver = createDebouncedSave(CONFIG_KEYS.detailZoomFactor)
  let badgeTimer: ReturnType<typeof setTimeout> | null = null
  let observer: ResizeObserver | null = null

  /**
   * 按给定比例测内容自然高度（不限高；标准化 zoom 下 scrollHeight 是元素自身坐标，
   * 已含该比例下的行高取整）
   */
  function measureNaturalHeight(el: HTMLElement, zoom: number): number {
    el.style.setProperty('zoom', String(zoom))
    el.style.height = 'auto'
    return el.scrollHeight
  }

  /**
   * 重新测量并应用缩放。全程同步：测量用的中间态（不限高）在同一任务内被覆盖，
   * 不会被绘制。直接写 style 而不走 Vue 绑定——绑定值不变时 Vue 不会重新下发，
   * 测量写入的中间态会残留。
   */
  function recompute(): void {
    const areaEl = area.value
    const el = container.value
    if (!areaEl || !el) return
    const availW = areaEl.clientWidth
    const availH = areaEl.clientHeight
    const first = computeDetailScale(availW, availH, measureNaturalHeight(el, 1), userFactor.value)
    // 文字行高按设备像素取整，自然高度随比例轻微变化（实测 1 倍 832 → 1.639 倍 837，
    // 最大化时队伍区因此多出滚动条）：按目标比例再量一次，只往小修正
    const refined = computeDetailScale(
      availW,
      availH,
      measureNaturalHeight(el, first) + FIT_SLACK_PX,
      userFactor.value
    )
    const next = Math.min(first, refined)
    el.style.setProperty('zoom', String(next))
    // 视觉高正好等于可用高：头部固定、队伍区在 MatchDetailModal 内部滚动
    el.style.height = `${availH / next}px`
    scale.value = next
  }

  function showBadge(): void {
    badge.value = `${Math.round(userFactor.value * 100)}%`
    if (badgeTimer) clearTimeout(badgeTimer)
    badgeTimer = setTimeout(() => {
      badge.value = null
    }, BADGE_MS)
  }

  useZoomHotkeys(direction => {
    userFactor.value = nextZoomFactor(userFactor.value, direction)
    recompute()
    saver.save(userFactor.value)
    showBadge()
  })

  /** 读取已存倍率——详情窗 show 之前调用，保证首帧即最终比例 */
  async function loadSavedFactor(): Promise<void> {
    try {
      const saved = await getConfigByIpc<number>(CONFIG_KEYS.detailZoomFactor)
      if (isValidZoomFactor(saved)) userFactor.value = saved
    } catch {
      // 无保存值：保持 1（纯铺满）
    }
  }

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !area.value) return
    observer = new ResizeObserver(() => recompute())
    observer.observe(area.value)
  })

  onUnmounted(() => {
    observer?.disconnect()
    saver.flush()
    if (badgeTimer) clearTimeout(badgeTimer)
  })

  return { scale, userFactor, badge, recompute, loadSavedFactor }
}
