/**
 * 一次性「求 Star」提示
 *
 * 顶栏常驻的 Star 入口转化率很低，主动问一次效果好得多；但问的时机要落在用户
 * 已经觉得好用之后，所以按「累计使用天数」计：第 {@link STAR_PROMPT_MIN_DAYS}
 * 个使用日起，启动后找个不抢首屏的时机弹一条非模态通知。全程只弹一次——无论
 * 用户点 Star、点不再提示还是直接关掉，弹出那一刻就记为已提示。
 *
 * 状态存在设备级 config 键里（已登记 Rust `BACKUP_BLACKLIST`）：使用天数每天
 * 写一次，若参与云同步会每天把配置标脏、推一遍云端，且换设备也不该继承计数。
 *
 * @module composables/useStarPrompt
 */
import { h, onMounted, watch } from 'vue'
import { NButton, NFlex, useNotification, type NotificationReactive } from 'naive-ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'
import { GATE_FALLBACK_MS } from '@renderer/composables/useStartupDialogs'

/** 项目仓库地址 */
export const REPO_URL = 'https://github.com/wnzzer/rank-analysis'

/** 累计使用满这么多天才提示：太早问用户还没体验到价值 */
export const STAR_PROMPT_MIN_DAYS = 5

/**
 * 开闸后再等这么久才弹：避开首屏加载、升级检查通知、错误上报同意弹窗，
 * 让提示出现在用户已经在正常使用的时候
 */
export const STAR_PROMPT_DELAY_MS = 30_000

/** 持久化状态 */
export interface StarPromptState {
  /** 累计使用天数（同一天多次启动只算一次） */
  days: number
  /** 最近一次计数的本地日期 YYYY-MM-DD */
  lastDay: string
  /** 是否已提示过（提示过即永不再弹） */
  shown: boolean
}

/** 本地日期 YYYY-MM-DD（按用户时区切天，而非 UTC） */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 记一次启动，返回更新后的状态。
 *
 * @param prev - 已持久化的状态；首次使用为 undefined
 * @param today - 今天的本地日期
 * @returns 新状态；同一天重复启动时原样返回
 */
export function recordLaunch(prev: StarPromptState | undefined, today: string): StarPromptState {
  const state = prev ?? { days: 0, lastDay: '', shown: false }
  if (state.lastDay === today) return state
  return { ...state, days: state.days + 1, lastDay: today }
}

/** 是否该弹提示 */
export function shouldPrompt(state: StarPromptState): boolean {
  return !state.shown && state.days >= STAR_PROMPT_MIN_DAYS
}

/**
 * 在主窗口挂载一次性求 Star 提示。
 *
 * @example
 * ```ts
 * // Framework.vue（仅主窗口）
 * useStarPrompt()
 * ```
 */
export function useStarPrompt(): void {
  const notification = useNotification()

  function show(): void {
    let current: NotificationReactive | null = null
    const goStar = (): void => {
      current?.destroy()
      openUrl(REPO_URL).catch(() => {})
    }
    current = notification.create({
      title: '觉得好用的话，点个 Star 吧 ⭐',
      content:
        '本工具免费开源，由个人业余维护。GitHub 上的 Star 能让更多玩家看到它，也是对作者最直接的鼓励。',
      action: () =>
        h(NFlex, { size: 8 }, () => [
          h(
            NButton,
            { size: 'small', quaternary: true, onClick: () => current?.destroy() },
            () => '不再提示'
          ),
          h(NButton, { type: 'primary', size: 'small', onClick: goStar }, () => '去点 Star')
        ])
    })
  }

  /** 首屏就绪（客户端已连接，或兜底超时）后再延迟弹出，节奏同 useStartupDialogs */
  function scheduleShow(onShow: () => void): void {
    let scheduled = false
    const fire = (): void => {
      if (scheduled) return
      scheduled = true
      window.setTimeout(onShow, STAR_PROMPT_DELAY_MS)
    }
    if (lcuConnected.value) {
      fire()
      return
    }
    const stop = watch(lcuConnected, connected => {
      if (connected) {
        stop()
        fire()
      }
    })
    window.setTimeout(() => {
      stop()
      fire()
    }, GATE_FALLBACK_MS)
  }

  onMounted(async () => {
    let prev: StarPromptState | undefined
    try {
      prev = await getConfigByIpc<StarPromptState>(CONFIG_KEYS.starPrompt)
    } catch {
      // 读失败属异常态：本次既不计数也不弹，免得把坏状态写回去
      return
    }
    const state = recordLaunch(prev, localDay())
    if (state !== prev) putConfigByIpc(CONFIG_KEYS.starPrompt, state).catch(() => {})
    if (!shouldPrompt(state)) return
    scheduleShow(() => {
      // 先落盘再弹：即使用户直接关窗口，下次也不会再问
      putConfigByIpc(CONFIG_KEYS.starPrompt, { ...state, shown: true }).catch(() => {})
      show()
    })
  })
}
