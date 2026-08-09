import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { emit, listen } from '@tauri-apps/api/event'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import type { NoteLabel, PlayerNote, PlayerNotesMap } from '@renderer/types/domain/playerNote'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import { mergeNotesMaps, TOMBSTONE_TTL_MS, type MergeStats } from '@renderer/utils/mergePlayerNotes'

/** 备注写入来源：用户操作（编辑/手动导入）或云同步合并 */
export type NotesMutationOrigin = 'user' | 'sync'

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
   * 用户来源写操作的单调计数（setNote/removeNote/手动导入，含其他窗口广播来的）。
   *
   * 云同步的防抖调度信号：只有用户改动需要排期推送——若直接 watch `notes`
   * 引用，云同步自己 pull 合并的写入也会调度 30s 后再来一轮同步，形成
   * "每次有合并的同步都附赠一轮空同步"的自触发回环。
   */
  const userMutationSeq = ref(0)

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

  /** 备注总数（不含墓碑——已删除条目对消费者视同不存在） */
  const count = computed(() => Object.values(notes.value).filter(n => !n.deleted).length)

  /** 列表视图：按更新时间倒序的 `{ puuid, ...note }` 数组（不含墓碑），供设置页表格使用 */
  const list = computed(() =>
    Object.entries(notes.value)
      .filter(([, note]) => !note.deleted)
      .map(([puuid, note]) => ({ puuid, ...note }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  )

  /**
   * 从 config 读取备注到内存（不注册监听，供 init 与跨窗口事件复用）。
   *
   * 载入时顺带做墓碑 GC：`deleted` 且超过 {@link TOMBSTONE_TTL_MS} 的条目
   * 不再进内存（防 map 无限增长）。只过滤不落盘——下次任何写操作的整表
   * persist 会自然把瘦身结果带到盘上，启动路径不多打一次 IPC 写。
   */
  async function loadFromConfig(): Promise<void> {
    try {
      const saved = await getConfigByIpc<PlayerNotesMap>(STORAGE_KEY)
      const loaded = saved && typeof saved === 'object' ? saved : {}
      const expireBefore = Date.now() - TOMBSTONE_TTL_MS
      notes.value = Object.fromEntries(
        Object.entries(loaded).filter(
          ([, note]) => !(note.deleted && note.updatedAt < expireBefore)
        )
      )
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
      // 用户来源的广播同时递增 userMutationSeq——详情窗口的编辑要靠主窗口
      // 的防抖调度才能推送云端；sync 来源不递增（防同步自触发）。
      listen<{ origin?: NotesMutationOrigin }>(NOTES_CHANGED_EVENT, event => {
        loadFromConfig()
        if (event.payload?.origin !== 'sync') userMutationSeq.value++
      }).catch(error => console.error('Failed to listen player-notes-changed:', error))
    }
  }

  /**
   * 读取某玩家的备注
   * @param puuid - 玩家唯一标识
   * @returns 备注；不存在或已删除（墓碑）返回 undefined，墓碑对消费者透明
   */
  function getNote(puuid: string): PlayerNote | undefined {
    const note = notes.value[puuid]
    return note && !note.deleted ? note : undefined
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
    userMutationSeq.value++
    await persist()
  }

  /**
   * 删除某玩家的备注，并整体落盘。不存在（或已是墓碑）时静默返回。
   *
   * 不做物理删除而是写墓碑：直接 delete key 的话，云同步 pull 回的旧数据
   * （本机上次推送的、或其他设备的行）里还有这条，合并会把它当"新增"复活，
   * push 又推回云端——删除永远传播不出去。墓碑带上新 updatedAt，在
   * "新者赢"合并里压过所有旧活备注，删除得以跨设备生效；之后若用户重新
   * 标记同一玩家，新 setNote 的 updatedAt 更新，又会自然覆盖墓碑。
   * 内容字段清空（note 空串、encounters 丢弃——隐私 + 瘦身），仅保留
   * gameName/tagLine 便于调试排查。
   * @param puuid - 玩家唯一标识
   */
  async function removeNote(puuid: string): Promise<void> {
    const existing = notes.value[puuid]
    if (!existing || existing.deleted) return
    notes.value = {
      ...notes.value,
      [puuid]: {
        note: '',
        label: 'normal',
        gameName: existing.gameName,
        tagLine: existing.tagLine,
        updatedAt: nextTs(),
        deleted: true
      }
    }
    userMutationSeq.value++
    await persist()
  }

  /**
   * 批量并入外部备注表（手动导入 / 云端拉取共用），同 puuid 按 updatedAt 新者赢。
   * 无实际变化（仅 kept/invalid/expired）时不落盘、不广播。
   * 墓碑就是普通条目，走同一套"新者赢"——较新的墓碑压过旧活备注（删除传播），
   * 较新的活备注压过旧墓碑（删除后重新标记）；过期墓碑由 mergeNotesMaps 拦下。
   * @param incoming - 外部备注表
   * @param origin - 写入来源：'user'（默认，手动导入）会触发云同步防抖调度，
   *   'sync'（云同步 pull 合并）不触发——否则每次有合并的同步都自触发下一轮
   * @returns 合并统计，供 UI 反馈
   */
  async function importNotes(
    incoming: PlayerNotesMap,
    origin: NotesMutationOrigin = 'user'
  ): Promise<MergeStats> {
    const { merged, stats } = mergeNotesMaps(notes.value, incoming)
    if (stats.added === 0 && stats.replaced === 0) return stats
    notes.value = merged
    // 与 loadFromConfig 同理：把单调时钟顶到并入后的最大 updatedAt，防止后续写入回退
    for (const note of Object.values(merged)) {
      if (note.updatedAt > lastTs) lastTs = note.updatedAt
    }
    if (origin === 'user') userMutationSeq.value++
    await persist(origin)
    return stats
  }

  /**
   * 整表落盘，并广播变更通知其他窗口重载。
   * 落盘失败时**重新抛出**——否则 setNote/removeNote 即使写盘失败也会 resolve，
   * 上层 try/catch 永远进不去，用户看到"已保存/已删除"却实际未持久化。
   * @param origin - 广播携带的来源标记，各窗口据此决定是否调度云同步推送
   */
  async function persist(origin: NotesMutationOrigin = 'user'): Promise<void> {
    try {
      await putConfigByIpc(STORAGE_KEY, notes.value)
    } catch (error) {
      console.error('Failed to persist player notes:', error)
      throw error
    }
    // 落盘成功后再广播
    emit(NOTES_CHANGED_EVENT, { origin }).catch(() => {})
  }

  return { notes, count, list, userMutationSeq, init, getNote, setNote, removeNote, importNotes }
})
