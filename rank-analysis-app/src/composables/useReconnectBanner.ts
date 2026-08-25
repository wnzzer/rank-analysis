import { onUnmounted, ref, watch, type Ref } from 'vue'

/**
 * 重连恢复提示：isConnected 由 false→true 时点亮 restoreMs 毫秒后自动回落。
 *
 * 从 Gaming.vue 内联逻辑抽出（R21-1），便于用 fake timers 做时序单测；
 * 视图侧只消费 reconnected 状态拼接文案。初始即已连接（prev 为 undefined）
 * 不触发——「恢复」语义只对断连后的重连成立。
 */
export function useReconnectBanner(isConnected: Ref<boolean>, restoreMs = 3000) {
  /** 重连成功后短暂展示的恢复提示 */
  const reconnected = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = watch(isConnected, (now, prev) => {
    if (prev === false && now === true) {
      reconnected.value = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        reconnected.value = false
      }, restoreMs)
    }
  })

  onUnmounted(() => {
    stop()
    clearTimeout(timer)
  })

  return { reconnected }
}
