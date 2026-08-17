import { ref, computed, onMounted, onUnmounted } from 'vue'

const BREAKPOINTS = {
  md: 768,
  lg: 1024,
  /** 战绩页左栏抽屉断点（对齐 Akari @1064px 紧凑布局）：<1064 左栏收 NDrawer 抽屉 */
  compact: 1064
} as const

/**
 * 响应式视口宽度断点
 *
 * - md: 768（手机/平板分界）
 * - lg: 1024（平板/桌面分界）
 * - compact: 1064（战绩页左栏抽屉断点，对齐 Akari @1064px 紧凑布局）
 *
 * @returns isMobile/isDesktop/isCompact 反应式 ref，跟随 window resize 自动更新
 */
export function useBreakpoint() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.lg)

  const isMobile = computed(() => width.value < BREAKPOINTS.md)
  const isDesktop = computed(() => width.value >= BREAKPOINTS.md)
  /** 窄窗：低于紧凑断点（战绩页左栏收抽屉） */
  const isCompact = computed(() => width.value < BREAKPOINTS.compact)

  function handler() {
    width.value = window.innerWidth
  }

  onMounted(() => {
    window.addEventListener('resize', handler)
    handler() // 立即同步一次
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handler)
  })

  return { width, isMobile, isDesktop, isCompact, BREAKPOINTS }
}
