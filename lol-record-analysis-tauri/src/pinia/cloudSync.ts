/**
 * 云同步编排 store（职责与触发时机详见下方 store 定义处 JSDoc）
 * @module pinia/cloudSync
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'
import { usePlayerNotesStore } from './playerNotes'
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

/** 备注变更后自动推送的防抖窗口（毫秒） */
const AUTO_PUSH_DEBOUNCE_MS = 30_000

/** 防抖到期时若一次同步尚在途，延迟重试的间隔（毫秒） */
const AUTO_PUSH_RETRY_MS = 5_000

/**
 * 是否为独立战绩详情窗口（label 形如 `match-detail-*`，见 detailWindow.ts）。
 * 每个 WebviewWindow 都会执行 main.ts，同步职责只由主窗口承担——
 * 否则开 N 个详情窗口就是 N 份 pull+push，一次备注广播会调度 N 个防抖同步。
 */
function isStandaloneDetailWindow(): boolean {
  return getCurrentWindow().label.startsWith('match-detail-')
}

/**
 * 云同步编排 store
 *
 * 职责：开关状态 + 同步流程编排（取 puuid → 拉取 → 并入 notes store → 推送）。
 * 合并语义在 utils/mergePlayerNotes，网络在 Rust command，本 store 不碰两者细节。
 * 触发时机：app 启动（开关开时）、LCU 连接建立后补触发、设置页手动、
 * 开关打开时、备注变更后防抖推送。同步流程只在主窗口跑（详情窗口只读开关）。
 *
 * 注意：云端拉取必须发生在 importNotes 之外——importNotes 的读-合-写临界区是
 * 同步的，往里插 await 会打开丢更新窗口。
 */
export const useCloudSyncStore = defineStore('cloudSync', () => {
  /** 云同步开关（镜像 config，真实来源是 config.yaml） */
  const enabled = ref(false)
  /** 是否正在同步（防重入 + UI 转圈） */
  const syncing = ref(false)
  /** 最近一次成功同步时刻（毫秒），仅内存，重启清零 */
  const lastSyncAt = ref<number | null>(null)
  /** 最近一次失败信息，成功后清空 */
  const lastError = ref<string | null>(null)

  let autoPushStarted = false
  let autoPushTimer: ReturnType<typeof setTimeout> | null = null
  let connectionWatchStarted = false

  /**
   * 防抖到期后的推送执行体。
   * 若此刻一次同步尚在途，5 秒后重试——否则 in-flight 同步在 importNotes 前
   * 失败时，本次变更的推送会被 skip-when-syncing 永久搁浅。
   */
  function flushAutoPush(): void {
    if (syncing.value) {
      autoPushTimer = setTimeout(flushAutoPush, AUTO_PUSH_RETRY_MS)
      return
    }
    syncNow().catch(() => {})
  }

  /** 备注变更后延迟推送（合并短时间内的连续编辑，避免每次落盘都打云端） */
  function startAutoPush(): void {
    if (autoPushStarted || isStandaloneDetailWindow()) return
    autoPushStarted = true
    const notesStore = usePlayerNotesStore()
    // notes 的写路径都是整体替换引用（setNote/removeNote/importNotes），浅 watch 足够
    watch(
      () => notesStore.notes,
      () => {
        if (!enabled.value) return
        if (autoPushTimer) clearTimeout(autoPushTimer)
        autoPushTimer = setTimeout(flushAutoPush, AUTO_PUSH_DEBOUNCE_MS)
      }
    )
  }

  /**
   * LCU 连接建立后补触发一次同步。
   *
   * init() 跑在 webview 启动时，此刻 LoL 客户端很可能还没开（先开工具后开游戏
   * 是常态），启动同步会静默失败；这里 watch 连接状态，连上且本次启动尚未
   * 成功同步过（lastSyncAt 为空）时补一次。无轮询——lcuConnected 由后端
   * game-state-changed 事件驱动。
   */
  function startConnectionRetrigger(): void {
    if (connectionWatchStarted) return
    connectionWatchStarted = true
    watch(lcuConnected, connected => {
      if (connected && enabled.value && lastSyncAt.value === null) {
        syncNow().catch(() => {})
      }
    })
  }

  /**
   * 启动时初始化：读开关；主窗口且已开启则后台同步一次（失败静默，不阻塞启动）。
   * 由 main.ts 在 app 启动时调用（每个窗口都会执行，但同步只在主窗口注册/触发）。
   */
  async function init(): Promise<void> {
    try {
      enabled.value = (await getConfigByIpc<boolean>(CONFIG_KEYS.cloudSyncEnabled)) === true
    } catch {
      enabled.value = false
    }
    // 详情窗口只镜像开关状态，不承担同步（见 isStandaloneDetailWindow）
    if (isStandaloneDetailWindow()) return
    startConnectionRetrigger()
    if (enabled.value) {
      startAutoPush()
      syncNow().catch(() => {})
    }
  }

  /**
   * 切换云同步开关（风险告知弹窗的确认逻辑在设置页，进到这里视为已确认）。
   * @param v - 开/关
   */
  async function setEnabled(v: boolean): Promise<void> {
    enabled.value = v
    await putConfigByIpc(CONFIG_KEYS.cloudSyncEnabled, v)
    if (v) {
      startAutoPush()
      syncNow().catch(() => {})
    }
  }

  /**
   * 执行一次完整同步：当前召唤师 puuid → 拉取所有设备的行 → 逐份并入本地
   * （updatedAt 新者赢）→ 把合并结果推回本设备的行。
   * @throws 网络/LCU 未连接等失败，错误已记入 lastError
   */
  async function syncNow(): Promise<void> {
    if (syncing.value) return
    syncing.value = true
    lastError.value = null
    try {
      const me = await invoke<{ puuid: string }>('get_my_summoner')
      const payloads = await invoke<PlayerNotesMap[]>('cloud_pull_notes', { puuid: me.puuid })
      const notesStore = usePlayerNotesStore()
      for (const payload of payloads) {
        await notesStore.importNotes(payload)
      }
      await invoke('cloud_push_notes', { puuid: me.puuid, payload: notesStore.notes })
      lastSyncAt.value = Date.now()
    } catch (e) {
      lastError.value = String(e)
      throw e
    } finally {
      syncing.value = false
    }
  }

  return { enabled, syncing, lastSyncAt, lastError, init, setEnabled, syncNow }
})
