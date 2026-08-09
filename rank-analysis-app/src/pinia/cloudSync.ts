/**
 * 云同步编排 store（职责与触发时机详见下方 store 定义处 JSDoc）
 * @module pinia/cloudSync
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'
import { deepEqual } from '@renderer/utils/deepEqual'
import { isPlainObject } from '@renderer/utils/backupFile'
import { mergeNotesMaps } from '@renderer/utils/mergePlayerNotes'
import { usePlayerNotesStore } from './playerNotes'
import { useSettingsStore } from './setting'
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
 * 配置同步：首次经用户确认，之后整份后写胜（LWW）；变更经 config-changed 事件走同一防抖。
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

  /** 云端配置 payload 形状（Rust ConfigPayload 的序列化结果） */
  interface CloudConfig {
    updatedAt: number
    config: Record<string, unknown>
  }

  /** 首次同步待确认的云端配置；非 null 时 UI 弹确认窗（Framework 渲染） */
  const pendingCloudConfig = ref<CloudConfig | null>(null)

  /** 待确认弹窗对应的 puuid（resolve 时推送/落标记用） */
  let pendingPuuid = ''
  /** 本地有未推送的配置变更（config-changed 事件置位，推送后清零） */
  let configDirty = false
  /** 正在应用外来快照：期间的 config-changed 事件不算 dirty，防拉取→写入→再推送回环 */
  let applyingConfig = false
  let configWatchStarted = false

  /** 标记本地配置已变更（config-changed 监听与测试共用入口） */
  function markConfigDirty(): void {
    if (applyingConfig) return
    configDirty = true
  }

  /**
   * 监听 Rust 侧 config-changed（已按云同步口径过滤），变更后走既有防抖推送。
   * 复用 notes 的 autoPushTimer/flushAutoPush——防抖到点执行的 syncNow 现在
   * 同时同步备注与配置，无需第二套定时器。
   */
  function startConfigWatch(): void {
    if (configWatchStarted) return
    configWatchStarted = true
    listen<string>('config-changed', () => {
      markConfigDirty()
      scheduleAutoPush()
    }).catch(() => {})
  }

  /** 推送本机配置到云端并更新 LWW 基准 */
  async function pushConfig(puuid: string): Promise<void> {
    await invoke('cloud_push_config', { puuid })
    configDirty = false
    await putConfigByIpc(CONFIG_KEYS.configLastSyncAt, Date.now())
  }

  /** 应用云端配置（确认覆盖/静默 LWW 共用）：写入期间抑制 dirty 标记，完成后重载主题 */
  async function applyCloudConfig(cloud: CloudConfig): Promise<void> {
    applyingConfig = true
    try {
      await invoke('apply_config_snapshot', { snapshot: cloud.config })
    } finally {
      applyingConfig = false
    }
    configDirty = false
    await putConfigByIpc(CONFIG_KEYS.configLastSyncAt, Date.now())
    // 立即生效：theme 是唯一初始化后不再读 config 的展示态，其余设置页打开时现读
    await useSettingsStore().initTheme()
  }

  /**
   * 配置同步（syncNow 内、备注同步后调用）。
   *
   * 首次（无 configSyncedOnce 标记）：云端有且不一致 → 挂起弹窗等用户裁决
   * （不落标记——中途关 app 下次重走首次流程）；云端为空 → 推送播种；
   * 一致 → 只落标记。
   * 之后：内容一致 → 无事；本地有未推变更 → 推送（后写胜）；云端行比上次
   * 同步新 → 静默应用；否则推送。
   */
  async function syncConfig(puuid: string): Promise<void> {
    // 首次确认弹窗未决:不重新评估,等用户裁决(防重复弹窗/与 resolve 竞态)
    if (pendingCloudConfig.value !== null) return
    // 三个读取互相独立:本地 IPC 与云端往返并行,不给同步转圈平白叠加延迟
    const [pulled, local, syncedOnce] = await Promise.all([
      invoke<CloudConfig | null>('cloud_pull_config', { puuid }),
      invoke<Record<string, unknown>>('get_cloud_config_snapshot'),
      getConfigByIpc<boolean>(CONFIG_KEYS.configSyncedOnce)
        .catch(() => false)
        .then(v => v === true)
    ])

    if (!syncedOnce) {
      if (pulled && !deepEqual(pulled.config, local)) {
        pendingPuuid = puuid
        pendingCloudConfig.value = pulled
        return
      }
      if (!pulled) await pushConfig(puuid)
      await putConfigByIpc(CONFIG_KEYS.configSyncedOnce, true)
      return
    }

    if (pulled && deepEqual(pulled.config, local)) {
      configDirty = false
      return
    }
    if (configDirty) {
      await pushConfig(puuid)
      return
    }
    const lastConfigSyncMs = (await getConfigByIpc<number>(CONFIG_KEYS.configLastSyncAt)) ?? 0
    if (pulled && pulled.updatedAt > lastConfigSyncMs) {
      await applyCloudConfig(pulled)
    } else {
      await pushConfig(puuid)
    }
  }

  /**
   * 首次确认弹窗的裁决入口（Framework 的弹窗按钮调用）。
   * @param useCloud - true 用云端覆盖本地；false 保留本地并推送覆盖云端
   */
  async function resolveCloudConfig(useCloud: boolean): Promise<void> {
    const pending = pendingCloudConfig.value
    if (!pending) return
    pendingCloudConfig.value = null
    // 与 syncNow 互斥:裁决执行期间挡住防抖/手动触发的并发同步
    syncing.value = true
    try {
      if (useCloud) {
        await applyCloudConfig(pending)
      } else {
        await pushConfig(pendingPuuid)
      }
      await putConfigByIpc(CONFIG_KEYS.configSyncedOnce, true)
    } catch (e) {
      lastError.value = String(e)
      throw e
    } finally {
      syncing.value = false
    }
  }

  let autoPushStarted = false
  let autoPushTimer: ReturnType<typeof setTimeout> | null = null
  let connectionWatchStarted = false

  /**
   * 防抖到期后的推送执行体。
   * 开关已被关掉时直接放弃——用户经风险弹窗明确关闭后，挂起的推送不能再发出。
   * 若此刻一次同步尚在途，5 秒后重试——否则 in-flight 同步在 importNotes 前
   * 失败时，本次变更的推送会被 skip-when-syncing 永久搁浅。
   */
  function flushAutoPush(): void {
    if (!enabled.value) return
    if (syncing.value) {
      autoPushTimer = setTimeout(flushAutoPush, AUTO_PUSH_RETRY_MS)
      return
    }
    syncNow().catch(() => {})
  }

  /** （重新）调度一次防抖同步：notes 用户变更与 config-changed 共用同一个定时器 */
  function scheduleAutoPush(): void {
    if (!enabled.value) return
    if (autoPushTimer) clearTimeout(autoPushTimer)
    autoPushTimer = setTimeout(flushAutoPush, AUTO_PUSH_DEBOUNCE_MS)
  }

  /**
   * 备注变更后延迟推送（合并短时间内的连续编辑，避免每次落盘都打云端）。
   *
   * 调度信号是 userMutationSeq（仅用户来源写操作递增）而非 notes 引用本身：
   * 云同步 pull 合并的写入不该再调度下一轮同步，否则形成自触发回环。
   */
  function startAutoPush(): void {
    if (autoPushStarted || isStandaloneDetailWindow()) return
    autoPushStarted = true
    const notesStore = usePlayerNotesStore()
    watch(() => notesStore.userMutationSeq, scheduleAutoPush)
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
    startConfigWatch()
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
    } else if (autoPushTimer) {
      // 关闭开关时取消挂起的防抖推送，避免关掉后 timer 到点仍发出一次同步
      clearTimeout(autoPushTimer)
      autoPushTimer = null
    }
  }

  /**
   * 执行一次完整同步：当前召唤师 puuid → 拉取所有设备的行 → 内存合并成
   * 云端并集 → 一次性并入本地（updatedAt 新者赢，至多一次落盘+广播）→
   * 仅当本地有云端缺的内容时才推回本设备的行。
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
      // 云端行任何人可插入（spec 接受的开放写入面），容器形状必须当不可信输入
      // 过滤——jsonb 列可存 JSON null/数组/原始值，直接喂 mergeNotesMaps 的
      // Object.entries 会抛 TypeError，该 puuid 的同步从此永久失败（受害者
      // 还删不掉毒行）。条目级校验在 mergeNotesMaps 的 isValidNote，这里只管容器。
      // 先在内存里把各设备行合并成一张并集表，再一次性并入本地——
      // 逐份 importNotes 会造成 N 次全表落盘 + N 次跨窗口广播。
      let cloudUnion: PlayerNotesMap = {}
      for (const payload of payloads) {
        if (!isPlainObject(payload)) continue
        cloudUnion = mergeNotesMaps(cloudUnion, payload).merged
      }
      await notesStore.importNotes(cloudUnion, 'sync')
      // 本地有云端并集缺少/更旧的条目才需要推送；无变化的同步（启动、连接
      // 补触发的常态路径）不再对云端做无谓的全量 upsert。
      const { stats: pushNeed } = mergeNotesMaps(cloudUnion, notesStore.notes)
      if (pushNeed.added > 0 || pushNeed.replaced > 0) {
        await invoke('cloud_push_notes', { puuid: me.puuid, payload: notesStore.notes })
      }
      await syncConfig(me.puuid)
      lastSyncAt.value = Date.now()
    } catch (e) {
      lastError.value = String(e)
      throw e
    } finally {
      syncing.value = false
    }
  }

  return {
    enabled,
    syncing,
    lastSyncAt,
    lastError,
    pendingCloudConfig,
    init,
    setEnabled,
    syncNow,
    resolveCloudConfig,
    markConfigDirty
  }
})
