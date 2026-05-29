import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { emit, listen } from '@tauri-apps/api/event'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { NoteLabel, PlayerNote, PlayerNotesMap } from '@renderer/types/domain/playerNote'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'

/** 持久化 key，复用 config 系统，无需新增 Rust command */
const STORAGE_KEY = 'playerNotes'

/**
 * 备注变更的跨窗口广播事件。
 *
 * 战绩详情是独立窗口（match-detail-*），与主窗口各自持有一份 pinia store。
 * 在任一窗口写备注后，emit 此事件广播到所有窗口，各窗口收到后从 config 重载，
 * 保证"详情页标记 → 主窗口/设置页"即时可见，无需重启。
 */
const NOTES_CHANGED_EVENT = 'player-notes-changed'

/** 单个玩家最多保留的遇见记录条数（最近在前，超出截断） */
const MAX_ENCOUNTERS = 20

/** 时间字符串转毫秒，无效值归零（用于遇见记录排序） */
function toTimestamp(date: string): number {
  const t = new Date(date).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 合并遇见记录：把新一局并入已有列表，按 gameId 去重、最近在前、截断到上限。
 * @param existing - 已有遇见记录
 * @param add - 本次要并入的对局（可空，为空时原样返回已有）
 */
function mergeEncounters(
  existing: OneGamePlayer[] | undefined,
  add: OneGamePlayer | undefined
): OneGamePlayer[] | undefined {
  const base = existing ?? []
  if (!add) return base.length ? base : undefined
  const deduped = base.filter(e => e.gameId !== add.gameId)
  return [add, ...deduped]
    .sort((a, b) => toTimestamp(b.gameCreatedAt) - toTimestamp(a.gameCreatedAt))
    .slice(0, MAX_ENCOUNTERS)
}

/**
 * 玩家备注 store
 *
 * 内存维护一张 `puuid -> 备注` 表，所有写操作（set/remove）会整体落盘到
 * config（`playerNotes` key）。组件只读 store / 调 store 方法，不直接碰 IPC。
 *
 * @see issue #67
 * @see types/domain/playerNote
 */
export const usePlayerNotesStore = defineStore('playerNotes', () => {
  /** 内存副本：puuid -> 备注 */
  const notes = ref<PlayerNotesMap>({})

  /**
   * 单调递增时间戳：保证同一毫秒内的多次写入仍有稳定先后，
   * 用于列表"最近更新优先"排序的确定性。
   */
  let lastTs = 0
  function nextTs(): number {
    const now = Date.now()
    lastTs = now > lastTs ? now : lastTs + 1
    return lastTs
  }

  /** 备注总数 */
  const count = computed(() => Object.keys(notes.value).length)

  /** 列表视图：按更新时间倒序的 `{ puuid, ...note }` 数组，供设置页表格使用 */
  const list = computed(() =>
    Object.entries(notes.value)
      .map(([puuid, note]) => ({ puuid, ...note }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  )

  /** 从 config 读取备注到内存（不注册监听，供 init 与跨窗口事件复用） */
  async function loadFromConfig(): Promise<void> {
    try {
      const saved = await getConfigByIpc<PlayerNotesMap>(STORAGE_KEY)
      notes.value = saved && typeof saved === 'object' ? saved : {}
      // 跨窗口 / 重载后保持单调时钟不回退：把 lastTs 顶到已有最大 updatedAt。
      // 否则 reload 后 lastTs 归 0，下次保存可能生成比现有更小的时间戳，
      // 破坏列表"最近更新优先"的排序。
      for (const note of Object.values(notes.value)) {
        if (note.updatedAt > lastTs) lastTs = note.updatedAt
      }
    } catch (error) {
      console.error('Failed to load player notes:', error)
      notes.value = {}
    }
  }

  /** 是否已注册跨窗口同步监听（每窗口一次） */
  let syncRegistered = false

  /**
   * 从持久化配置载入备注，并注册跨窗口同步监听。
   * 由 `main.ts` 在 app 启动时显式调用（每个窗口都会执行）。
   * 失败时安全降级为空表，不阻断启动。
   */
  async function init(): Promise<void> {
    await loadFromConfig()
    if (!syncRegistered) {
      syncRegistered = true
      // 收到其他窗口的变更广播后重载；loadFromConfig 不再 emit，无回环。
      listen(NOTES_CHANGED_EVENT, () => {
        loadFromConfig()
      }).catch(error => console.error('Failed to listen player-notes-changed:', error))
    }
  }

  /**
   * 读取某玩家的备注
   * @param puuid - 玩家唯一标识
   * @returns 备注，不存在返回 undefined
   */
  function getNote(puuid: string): PlayerNote | undefined {
    return notes.value[puuid]
  }

  /**
   * 写入 / 更新某玩家的备注，并整体落盘。
   * @param puuid - 玩家唯一标识
   * @param data - 备注内容（不含 updatedAt，由内部盖时间戳）；可选 `encounter`
   *   为"本次标记所在的对局"，会并入该玩家的遇见记录（去重、最近在前）。
   *   不传 `encounter` 时保留已有遇见记录不变。
   */
  async function setNote(
    puuid: string,
    data: {
      note: string
      label: NoteLabel
      gameName: string
      tagLine: string
      encounter?: OneGamePlayer
    }
  ): Promise<void> {
    const { encounter, ...rest } = data
    const encounters = mergeEncounters(notes.value[puuid]?.encounters, encounter)
    notes.value = {
      ...notes.value,
      [puuid]: { ...rest, updatedAt: nextTs(), ...(encounters ? { encounters } : {}) }
    }
    await persist()
  }

  /**
   * 删除某玩家的备注，并整体落盘。不存在时静默返回。
   * @param puuid - 玩家唯一标识
   */
  async function removeNote(puuid: string): Promise<void> {
    if (!(puuid in notes.value)) return
    const next = { ...notes.value }
    delete next[puuid]
    notes.value = next
    await persist()
  }

  /**
   * 整表落盘，并广播变更通知其他窗口重载。
   * 落盘失败时**重新抛出**——否则 setNote/removeNote 即使写盘失败也会 resolve，
   * 上层 try/catch 永远进不去，用户看到"已保存/已删除"却实际未持久化。
   */
  async function persist(): Promise<void> {
    try {
      await putConfigByIpc(STORAGE_KEY, notes.value)
    } catch (error) {
      console.error('Failed to persist player notes:', error)
      throw error
    }
    // 落盘成功后再广播
    emit(NOTES_CHANGED_EVENT).catch(() => {})
  }

  return { notes, count, list, init, getNote, setNote, removeNote }
})
