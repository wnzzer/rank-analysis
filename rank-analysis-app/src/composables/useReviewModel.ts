/**
 * 复盘标签页的数据装配：英雄名 + 时间线（fetchMatchTimeline 按局记忆）→ 复盘视图模型。
 *
 * 渐进渲染：英雄名就绪后先给无时间线的模型（对位总览/个人卡立刻可看，图表区显示骨架），
 * 时间线到达后整体替换。换对局时旧请求靠代次作废。重开局（< 5 分钟）不装配。
 */
import { ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { Game } from '@renderer/types/domain/match'
import { loadChampionNames } from '@renderer/services/ai/champion-names'
import { REMAKE_MAX_SECONDS } from '@renderer/services/ai/matchDetail'
import {
  reviewModelFromGame,
  type ReviewModel
} from '@renderer/services/ai/review/buildReviewModel'
import type { TimelineStatus } from '@renderer/services/ai/shared/timeline'
import { fetchMatchTimeline, supportsTimeline } from '@renderer/services/ai/shared/timeline/fetch'

export function useReviewModel(game: MaybeRefOrGetter<Game | null>) {
  const model = shallowRef<ReviewModel | null>(null)
  /** 时间线还在拉取（图表区显示骨架） */
  const timelinePending = ref(false)
  /** 时间线状态：disabled 仅表示用户在设置里关了开关；地图不支持归为 unavailable */
  const timelineStatus = ref<TimelineStatus | null>(null)
  const isRemake = ref(false)
  /** 视图模型构建抛错（数据形状异常）；UI 显示失败提示 */
  const failed = ref(false)
  let token = 0

  async function load(): Promise<void> {
    const t = ++token
    const g = toValue(game)
    model.value = null
    timelineStatus.value = null
    timelinePending.value = false
    failed.value = false
    isRemake.value = !!g && g.gameDuration < REMAKE_MAX_SECONDS
    if (!g || isRemake.value) return

    const wantTimeline = supportsTimeline(g)
    timelinePending.value = wantTimeline
    // 与英雄名并行拉取：SGP 慢时不叠加等待
    const timelineReq = wantTimeline ? fetchMatchTimeline(g) : null
    try {
      await loadChampionNames()
      if (t !== token) return
      model.value = reviewModelFromGame(g, null)
      if (!timelineReq) {
        timelineStatus.value = 'unavailable'
        return
      }
      const { timeline, status } = await timelineReq
      if (t !== token) return
      timelineStatus.value = status
      if (timeline) model.value = reviewModelFromGame(g, timeline)
    } catch (err) {
      if (t !== token) return
      console.error('review model build failed', err)
      failed.value = true
    } finally {
      if (t === token) timelinePending.value = false
    }
  }

  watch(
    () => toValue(game)?.gameId,
    () => void load(),
    { immediate: true }
  )

  return { model, timelinePending, timelineStatus, isRemake, failed, reload: load }
}
