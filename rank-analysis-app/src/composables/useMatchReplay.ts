/**
 * 战绩详情页「观看回放」流控制
 *
 * `.rofl` 只有游戏客户端能播放，所以整条链路都走 LCU：
 * 预判可用性（无副作用）→ 请求下载 → 轮询就绪 → 拉起客户端观看。
 *
 * 接口行为为国服真机实测结论，见
 * `docs/superpowers/specs/2026-07-27-match-replay-design.md`。
 */

import { computed, ref, watch, onUnmounted, toValue, type MaybeRefOrGetter } from 'vue'
import { useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@renderer/types/domain/match'

/** 后端 `get_replay_availability` 的返回结构 */
interface ReplayAvailability {
  playable: boolean
  reason: string | null
}

/** 轮询就绪状态的间隔（毫秒） */
const POLL_INTERVAL_MS = 1000

/**
 * 轮询总超时（毫秒）。
 *
 * 无效或不属于本人的对局会**永远**停在 `checking` 态，LCU 不会给出任何终态错误，
 * 所以超时是唯一的失败信号。实测 7.4 MB 的回放秒级完成，60s 足够覆盖正常下载。
 */
const POLL_TIMEOUT_MS = 60_000

export function useMatchReplay(game: MaybeRefOrGetter<Game | null>) {
  const message = useMessage()

  /** 预判结果；null 表示尚未查询 */
  const availability = ref<ReplayAvailability | null>(null)
  /** 正在走下载/拉起流程 */
  const busy = ref(false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const clearPoll = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  const canPlay = computed(() => availability.value?.playable === true && !busy.value)

  /** 不可用原因；可用或流程进行中时为空 */
  const disabledReason = computed(() => {
    if (busy.value) return ''
    return availability.value?.reason ?? ''
  })

  /** 按钮文案：进行中给出明确的阶段提示，避免用户以为卡死 */
  const buttonLabel = computed(() => (busy.value ? '正在获取回放…' : '观看回放'))

  /** 查询可用性（无副作用，可随详情页打开自动调用） */
  const refreshAvailability = async () => {
    const current = toValue(game)
    if (!current) {
      availability.value = null
      return
    }
    try {
      availability.value = await invoke<ReplayAvailability>('get_replay_availability', {
        gameId: current.gameId
      })
    } catch (e) {
      // 预判失败不该让按钮消失，退化成"点了才知道"
      availability.value = { playable: true, reason: null }
      console.error('查询回放可用性失败:', e)
    }
  }

  /**
   * 轮询回放是否就绪。
   *
   * 用 setTimeout 递归而非 setInterval：避免上一次请求未返回就发下一次，
   * 在 LCU 响应变慢时堆积请求。
   */
  const waitUntilReady = (gameId: number) =>
    new Promise<boolean>(resolve => {
      const deadline = Date.now() + POLL_TIMEOUT_MS

      const tick = async () => {
        if (cancelled) return resolve(false)
        if (Date.now() >= deadline) return resolve(false)

        let ready = false
        try {
          ready = await invoke<boolean>('is_replay_ready', { gameId })
        } catch (e) {
          // 单次查询失败不终止整轮：LCU 在对局刚结束等时刻会瞬时拒绝请求
          console.warn('查询回放状态失败，继续重试:', e)
        }
        if (cancelled) return resolve(false)
        if (ready) return resolve(true)

        pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      }

      void tick()
    })

  /**
   * 一键观看回放：请求下载 → 等待就绪 → 拉起客户端。
   *
   * 对已下载完成的回放重复调用是安全的——LCU 会立刻把状态置为就绪，
   * 因此无需先判断"是否已下载"。
   */
  const play = async () => {
    const current = toValue(game)
    if (!current || busy.value) return

    const gameId = current.gameId
    busy.value = true
    cancelled = false
    try {
      await invoke('start_replay_download', { gameId })

      const ready = await waitUntilReady(gameId)
      if (cancelled) return
      if (!ready) {
        message.error('未能获取该对局回放，可能已过期或不可用')
        return
      }

      await invoke('watch_replay', { gameId })
      message.success('正在拉起游戏客户端播放回放')
      // 客户端进入回放后 isPlayingReplay 变 true，刷新一次让按钮如实反映
      await refreshAvailability()
    } catch (e) {
      message.error(typeof e === 'string' ? e : '观看回放失败')
    } finally {
      clearPoll()
      busy.value = false
    }
  }

  watch(
    () => toValue(game)?.gameId,
    () => {
      void refreshAvailability()
    },
    { immediate: true }
  )

  /**
   * 窗口重新获得焦点时刷新可用性。
   *
   * 可用性依赖客户端的实时状态（是否正在播放其他回放、客户端是否还开着），
   * 这些都可能在详情窗口开着的时候被用户在**软件之外**改变。典型场景：
   * 看完回放退出客户端后切回来——没有这次刷新，按钮会一直停在
   * 「正在播放其他回放」直到重开窗口。
   */
  const handleFocus = () => {
    void refreshAvailability()
  }
  window.addEventListener('focus', handleFocus)

  onUnmounted(() => {
    cancelled = true
    clearPoll()
    window.removeEventListener('focus', handleFocus)
  })

  return {
    availability,
    busy,
    canPlay,
    disabledReason,
    buttonLabel,
    play,
    refreshAvailability
  }
}
