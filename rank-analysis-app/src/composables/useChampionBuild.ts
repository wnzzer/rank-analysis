/**
 * 选人期推荐构筑：跟随「我的英雄 / 分路 / 模式」取数
 *
 * 与 useSessionSync 平行——推荐构筑只和我自己这一格有关，不进 per-player 同步链。
 *
 * @module composables/useChampionBuild
 */

import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import {
  applyRunePage,
  fetchChampionBuild,
  fetchLastAppliedRune,
  isSameRune,
  pickRecommendedRune
} from '@renderer/services/championBuild'
import { opggRevision } from '@renderer/services/opgg'
import type {
  ApplyRuneResult,
  ChampionBuild,
  RuneApplyEvent,
  RuneBuild
} from '@renderer/types/championBuild'

/** 符文写入状态：未写 / 写入中 / 已写入当前推荐 / 失败 */
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

/**
 * 跟随会话拉取推荐构筑
 *
 * 取数签名只由 `gameMode | championId | position | opggRevision` 组成：会话数据在选人期
 * 每 1~2s 重推一轮，战绩 / 标签也在渐进到达，若对整个会话做深比较（或复用含战绩条数、
 * LP 等字段的 playerSignature），每一轮无关更新都会触发一次白拉。
 *
 * @param source - 返回当前取数入参的 getter（传 getter 而非 ref，便于调用方从 reactive 会话里现算）
 * @returns build（当前构筑，拉取中 / 无数据为 null）、loading、recommended（推荐的那套符文与样本是否充足）、
 *   applyState / applyReason（符文写入状态与失败原因）、apply（把推荐符文写成临时符文页）
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
  recommended: ComputedRef<{ rune: RuneBuild | null; sufficient: boolean }>
  applyState: Ref<ApplyState>
  applyReason: Ref<string | null>
  apply: () => Promise<ApplyRuneResult | null>
} {
  const build = ref<ChampionBuild | null>(null)
  const loading = ref(false)
  const applyState = ref<ApplyState>('idle')
  const applyReason = ref<string | null>(null)

  /** 请求序号：快速换人时旧请求（取数或写入）可能后到，只认最后一次 */
  let seq = 0

  const recommended = computed(() => pickRecommendedRune(build.value))

  const key = computed(() => {
    const q = source()
    if (!q.active || !(q.championId > 0)) return ''
    return [q.gameMode, q.championId, q.position || '', opggRevision.value].join('|')
  })

  watch(
    key,
    async k => {
      const mine = ++seq
      build.value = null
      applyState.value = 'idle'
      applyReason.value = null
      if (!k) {
        loading.value = false
        return
      }
      loading.value = true
      const q = source()
      const result = await fetchChampionBuild(q.championId, q.gameMode, q.position)
      if (mine !== seq) return
      build.value = result
      loading.value = false
      if (result) await restoreApplied(mine)
    },
    { immediate: true }
  )

  /**
   * 恢复「已应用」：写入发生在后端（自动任务）或本组件上次挂载期间（切到别的页再回来），
   * 本地状态不知道。后端的写入记录只在本次选人期有效，可以放心当真。
   */
  async function restoreApplied(mine: number): Promise<void> {
    const applied = await fetchLastAppliedRune()
    const b = build.value
    const rune = recommended.value.rune
    if (mine !== seq || !applied || !b || !rune || applyState.value !== 'idle') return
    if (isSameRune(b.champion_id, rune, applied)) applyState.value = 'applied'
  }

  /** 自动应用任务的写入结果：只认「当前英雄的当前推荐」，别的英雄的结果不串过来 */
  function onApplyEvent(event: RuneApplyEvent): void {
    const b = build.value
    const rune = recommended.value.rune
    if (!b || !rune || !isSameRune(b.champion_id, rune, event)) return
    applyState.value = event.ok ? 'applied' : 'failed'
    applyReason.value = event.reason
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

  /**
   * 把推荐的那套符文写成临时符文页。样本不足、无数据或写入中时不动作（返回 null）；
   * 写入期间换了人，结果作废，不把旧英雄的「已应用」串到新英雄上。
   */
  async function apply(): Promise<ApplyRuneResult | null> {
    const b = build.value
    const { rune, sufficient } = recommended.value
    if (!b || !rune || !sufficient || applyState.value === 'applying') return null
    const mine = seq
    applyState.value = 'applying'
    applyReason.value = null
    const result = await applyRunePage(b.champion_id, b.position, rune)
    if (mine !== seq) return result
    applyState.value = result.ok ? 'applied' : 'failed'
    applyReason.value = result.reason
    return result
  }

  return { build, loading, recommended, applyState, applyReason, apply }
}
