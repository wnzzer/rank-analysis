/**
 * 选人期推荐构筑：跟随「我的英雄 / 分路 / 模式」取数，组合方案卡、选中、写入状态
 *
 * 与 useSessionSync 平行——推荐构筑只和我自己这一格有关，不进 per-player 同步链。
 *
 * @module composables/useChampionBuild
 */

import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import {
  applyRunePage,
  autoTargetKey,
  buildRuneOptions,
  defaultOptionKey,
  fetchChampionBuild,
  fetchLastAppliedRune,
  perkIdsOf,
  presetFromRune,
  presetPositionOf
} from '@renderer/services/championBuild'
import { opggRevision } from '@renderer/services/opgg'
import { useRunePresets } from '@renderer/composables/useRunePresets'
import type {
  ApplyRuneResult,
  ChampionBuild,
  RuneApplyEvent,
  RuneOption
} from '@renderer/types/championBuild'

/** 符文写入状态（针对当前选中的方案）：未写 / 写入中 / 已写入 / 失败 */
export type ApplyState = 'idle' | 'applying' | 'applied' | 'failed'

/**
 * 取数入参
 * @property active - 是否处于选人期（非选人期不取数、清空展示）
 * @property gameMode - LCU gameMode，后端据此判定 ranked / aram / 不推荐
 * @property championId - 我这一格展示的英雄（含悬停意向），0 表示未亮英雄
 * @property position - 我的分配分路（LCU 小写），无分配为 null / 空串
 */
export interface BuildQuery {
  active: boolean
  gameMode: string
  championId: number
  position: string | null
}

/** 一条写入（成功或失败）记录：只看英雄与 9 个符文 */
interface WriteRecord {
  champion_id: number
  perk_ids: number[]
}

const samePerks = (a: number[], b: number[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

/**
 * 跟随会话拉取推荐构筑，并组合出推荐栏需要的全部状态
 *
 * 取数签名只由 `gameMode | championId | position | opggRevision` 组成：会话数据在选人期
 * 每 1~2s 重推一轮，战绩 / 标签也在渐进到达，若对整个会话做深比较（或复用含战绩条数、
 * LP 等字段的 playerSignature），每一轮无关更新都会触发一次白拉。
 *
 * 写入状态针对「当前选中的方案」派生：同一套符文在后端写入记录里 → 已应用；切到别的卡，
 * 那套没写过就回到未写。
 *
 * @param source - 返回当前取数入参的 getter（传 getter 而非 ref，便于调用方从 reactive 会话里现算）
 * @returns build / loading、options（方案卡）/ selectedKey / selected / select、
 *   autoTarget（自动会写哪张卡，已接管或不写时为 null）、overridden（本次选人期已手动接管）、
 *   remembered（选中的是我的方案）、applyState / applyReason、apply（写选中那套）、
 *   toggleRemember（记住 / 取消记住选中那套）
 * @example
 * ```ts
 * const cb = useChampionBuild(() => ({
 *   active: sessionData.phase === 'ChampSelect',
 *   gameMode: sessionData.gameMode,
 *   championId: me.value?.championId ?? 0,
 *   position: me.value?.assignedPosition ?? null
 * }))
 * ```
 */
export function useChampionBuild(source: () => BuildQuery): {
  build: Ref<ChampionBuild | null>
  loading: Ref<boolean>
  options: ComputedRef<RuneOption[]>
  selectedKey: ComputedRef<string | null>
  selected: ComputedRef<RuneOption | null>
  select: (key: string) => void
  autoTarget: ComputedRef<string | null>
  overridden: Ref<boolean>
  remembered: ComputedRef<boolean>
  applyState: ComputedRef<ApplyState>
  applyReason: ComputedRef<string | null>
  apply: () => Promise<ApplyRuneResult | null>
  toggleRemember: () => Promise<'remembered' | 'forgotten' | null>
} {
  const build = ref<ChampionBuild | null>(null)
  const loading = ref(false)
  const presetsApi = useRunePresets()
  void presetsApi.reload()

  /** 用户点选的卡；null = 用默认选中 */
  const userKey = ref<string | null>(null)
  /** 本次选人期最近一次成功写入（后端记录 / 自动事件 / 手动写入） */
  const applied = ref<WriteRecord | null>(null)
  /** 最近一次失败的写入 */
  const failure = ref<(WriteRecord & { reason: string | null }) | null>(null)
  /** 正在写入的卡 */
  const applyingKey = ref<string | null>(null)
  /** 本次选人期已手动接管：自动任务不再为这个英雄写入 */
  const overridden = ref(false)

  /** 请求序号：快速换人时旧请求（取数或写入）可能后到，只认最后一次 */
  let seq = 0

  const query = computed(() => source())
  const championId = computed(() => build.value?.champion_id ?? query.value.championId)
  /** 匹配我的方案用的分路（后端解析过的构筑分路最准） */
  const presetPosition = computed(() =>
    presetPositionOf(build.value, query.value.gameMode, query.value.position)
  )
  const myPreset = computed(() =>
    presetPosition.value ? presetsApi.find(championId.value, presetPosition.value) : null
  )

  const options = computed(() => buildRuneOptions(build.value, myPreset.value))
  const selectedKey = computed(() =>
    userKey.value && options.value.some(o => o.key === userKey.value)
      ? userKey.value
      : defaultOptionKey(options.value)
  )
  const selected = computed(() => options.value.find(o => o.key === selectedKey.value) ?? null)
  const autoTarget = computed(() =>
    overridden.value
      ? null
      : autoTargetKey(options.value, !!myPreset.value, presetsApi.fallback.value)
  )
  const remembered = computed(() => !!selected.value?.starred)

  const matchesSelected = (rec: WriteRecord | null) =>
    !!rec &&
    !!selected.value &&
    rec.champion_id === championId.value &&
    samePerks(rec.perk_ids, perkIdsOf(selected.value.rune))

  const applyState = computed<ApplyState>(() => {
    if (!selected.value) return 'idle'
    if (applyingKey.value === selected.value.key) return 'applying'
    if (matchesSelected(applied.value)) return 'applied'
    if (matchesSelected(failure.value)) return 'failed'
    return 'idle'
  })
  const applyReason = computed(() =>
    matchesSelected(failure.value) ? (failure.value?.reason ?? null) : null
  )

  const key = computed(() => {
    const q = query.value
    if (!q.active || !(q.championId > 0)) return ''
    return [q.gameMode, q.championId, q.position || '', opggRevision.value].join('|')
  })

  watch(
    key,
    async k => {
      const mine = ++seq
      build.value = null
      userKey.value = null
      applied.value = null
      failure.value = null
      applyingKey.value = null
      overridden.value = false
      if (!k) {
        loading.value = false
        return
      }
      loading.value = true
      const q = query.value
      const result = await fetchChampionBuild(q.championId, q.gameMode, q.position)
      if (mine !== seq) return
      build.value = result
      loading.value = false
      await restoreApplied(mine)
    },
    { immediate: true }
  )

  /**
   * 恢复写入记录与手动接管：写入发生在后端（自动任务）或本组件上次挂载期间（切到别的页
   * 再回来），本地状态不知道。后端记录只在本次选人期有效，可以放心当真。
   */
  async function restoreApplied(mine: number): Promise<void> {
    const record = await fetchLastAppliedRune()
    if (mine !== seq || !record || record.champion_id !== championId.value) return
    applied.value = { champion_id: record.champion_id, perk_ids: record.perk_ids }
    overridden.value = record.manual_override
  }

  /** 自动应用任务的写入结果：只认当前英雄，别的英雄的结果不串过来 */
  function onApplyEvent(event: RuneApplyEvent): void {
    if (event.champion_id !== championId.value) return
    const rec = { champion_id: event.champion_id, perk_ids: event.perk_ids }
    if (event.ok) applied.value = rec
    else failure.value = { ...rec, reason: event.reason }
  }

  let unlisten: (() => void) | null = null
  let disposed = false
  void listen<RuneApplyEvent>('rune-apply-result', e => onApplyEvent(e.payload)).then(off => {
    if (disposed) off()
    else unlisten = off
  })
  onUnmounted(() => {
    disposed = true
    unlisten?.()
  })

  function select(k: string): void {
    userKey.value = k
  }

  /**
   * 把选中的那套写成临时符文页。样本少的卡也允许——用户主动点选即是知情选择。
   * 成功即手动接管（后端同步记下，本次选人期自动任务不再为这个英雄写入）；
   * 写入期间换了人，结果作废，不把旧英雄的「已应用」串到新英雄上。
   */
  async function apply(): Promise<ApplyRuneResult | null> {
    const opt = selected.value
    if (!opt || applyingKey.value) return null
    const mine = seq
    const champion = championId.value
    applyingKey.value = opt.key
    const result = await applyRunePage(champion, presetPosition.value ?? '', opt.rune)
    if (mine !== seq) return result
    applyingKey.value = null
    const rec = { champion_id: champion, perk_ids: perkIdsOf(opt.rune) }
    if (result.ok) {
      applied.value = rec
      failure.value = null
      overridden.value = true
    } else {
      failure.value = { ...rec, reason: result.reason }
    }
    return result
  }

  /** 选中的是我的方案 → 取消记住；否则把选中那套记为「这个英雄这条路」的方案 */
  async function toggleRemember(): Promise<'remembered' | 'forgotten' | null> {
    const opt = selected.value
    const position = presetPosition.value
    if (!opt || !position) return null
    if (opt.starred) {
      await presetsApi.forget(championId.value, position)
      return 'forgotten'
    }
    await presetsApi.remember(presetFromRune(championId.value, position, opt.rune))
    return 'remembered'
  }

  return {
    build,
    loading,
    options,
    selectedKey,
    selected,
    select,
    autoTarget,
    overridden,
    remembered,
    applyState,
    applyReason,
    apply,
    toggleRemember
  }
}
