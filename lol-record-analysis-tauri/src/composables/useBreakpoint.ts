import { ref, computed, onMounted, onUnmounted } from 'vue'

const BREAKPOINTS = {
  md: 768,
  lg: 1024
} as const

/**
 * 响应式视口宽度断点
 *
 * - md: 768（手机/平板分界）
 * - lg: 1024（平板/桌面分界）
 *
 * @returns isMobile/isDesktop 反应式 ref，跟随 window resize 自动更新
 */
export function useBreakpoint() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.lg)

  const isMobile = computed(() => width.value < BREAKPOINTS.md)
  const isDesktop = computed(() => width.value >= BREAKPOINTS.md)

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

  return { width, isMobile, isDesktop, BREAKPOINTS }
}
