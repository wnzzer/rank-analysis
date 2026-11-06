/**
 * 隐藏分数据：按 puuid 拉单双排 / 灵活组排两个队列的估算，并在后端记下新一局后自动刷新。
 *
 * 只对当前登录的召唤师有意义（别人的逐局 LP 变化拿不到），由调用方通过 `enabled` 控制。
 */

import { onUnmounted, ref, watch, type Ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  getHiddenMmr,
  HIDDEN_MMR_UPDATED_EVENT,
  type HiddenMmr
} from '@renderer/services/hiddenMmr'

/**
 * @param puuid - 被查看召唤师的 PUUID
 * @param enabled - 是否为当前登录的召唤师；为 false 时不请求并清空数据
 * @returns solo / flex 两个队列的估算（未加载或不适用时为 null）与手动刷新函数
 */
export function useHiddenMmr(puuid: Ref<string>, enabled: Ref<boolean>) {
  const solo = ref<HiddenMmr | null>(null)
  const flex = ref<HiddenMmr | null>(null)
  // 快速切换玩家时丢弃过期响应
  let requestSeq = 0

  async function reload(): Promise<void> {
    const seq = ++requestSeq
    if (!enabled.value || !puuid.value) {
      solo.value = null
      flex.value = null
      return
    }
    const [soloResult, flexResult] = await Promise.all([
      getHiddenMmr(puuid.value, 'RANKED_SOLO_5x5'),
      getHiddenMmr(puuid.value, 'RANKED_FLEX_SR')
    ])
    if (seq !== requestSeq) return
    solo.value = soloResult
    flex.value = flexResult
  }

  watch([puuid, enabled], () => void reload(), { immediate: true })

  let unlisten: UnlistenFn | null = null
  let disposed = false
  void listen(HIDDEN_MMR_UPDATED_EVENT, () => void reload()).then(off => {
    if (disposed) off()
    else unlisten = off
  })
  onUnmounted(() => {
    disposed = true
    unlisten?.()
  })

  return { solo, flex, reload }
}
