/**
 * 云同步编排 store
 *
 * 职责：开关状态 + 同步流程编排（取 puuid → 拉取 → 并入 notes store → 推送）。
 * 合并语义在 utils/mergePlayerNotes，网络在 Rust command，本 store 不碰两者细节。
 * 触发时机：app 启动（开关开时）、设置页手动、开关打开时、备注变更后防抖推送。
 *
 * @module pinia/cloudSync
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { usePlayerNotesStore } from './playerNotes'
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

/** 备注变更后自动推送的防抖窗口（毫秒） */
const AUTO_PUSH_DEBOUNCE_MS = 30_000

/**
 * 云同步编排 store
 *
 * 职责：开关状态 + 同步流程编排（取 puuid → 拉取 → 并入 notes store → 推送）。
 * 合并语义在 utils/mergePlayerNotes，网络在 Rust command，本 store 不碰两者细节。
 * 触发时机：app 启动（开关开时）、设置页手动、开关打开时、备注变更后防抖推送。
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

  /** 备注变更后延迟推送（合并短时间内的连续编辑，避免每次落盘都打云端） */
  function startAutoPush(): void {
    if (autoPushStarted) return
    autoPushStarted = true
    const notesStore = usePlayerNotesStore()
    // notes 的写路径都是整体替换引用（setNote/removeNote/importNotes），浅 watch 足够
    watch(
      () => notesStore.notes,
      () => {
        if (!enabled.value) return
        if (autoPushTimer) clearTimeout(autoPushTimer)
        autoPushTimer = setTimeout(() => {
          if (!syncing.value) syncNow().catch(() => {})
        }, AUTO_PUSH_DEBOUNCE_MS)
      }
    )
  }

  /**
   * 启动时初始化：读开关；已开启则后台同步一次（失败静默，不阻塞启动）。
   * 由 main.ts 在 app 启动时调用。
   */
  async function init(): Promise<void> {
    try {
      enabled.value = (await getConfigByIpc<boolean>(CONFIG_KEYS.cloudSyncEnabled)) === true
    } catch {
      enabled.value = false
    }
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
