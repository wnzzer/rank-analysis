/**
 * ReviewTab 降级：重开局、构建失败、时间线拉取中（骨架）、无时间线（提示 + 隐藏曲线/地图/出装、
 * 阵亡只给小结）、无分路（两队并列、无地图、出装对全场中位）、无基准队列（不显示分位）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import type { Game } from '@renderer/types/domain/match'
import type { ReviewModel } from '@renderer/services/ai/review/buildReviewModel'
import { gameB, modelB } from './fixtureModels'

const h = vi.hoisted(() => ({ review: null as unknown, ai: null as unknown }))
vi.mock('@renderer/composables/useReviewModel', () => ({ useReviewModel: () => h.review }))
vi.mock('@renderer/composables/useMatchAIAnalysis', () => ({ useMatchAIAnalysis: () => h.ai }))

import ReviewTab from '../ReviewTab.vue'

function setReview(
  model: ReviewModel | null,
  extra: Partial<{
    timelinePending: boolean
    isRemake: boolean
    failed: boolean
    timelineStatus: 'ok' | 'disabled' | 'unavailable' | null
  }> = {}
) {
  h.review = {
    model: shallowRef(model),
    timelinePending: ref(extra.timelinePending ?? false),
    timelineStatus: ref(extra.timelineStatus ?? null),
    isRemake: ref(extra.isRemake ?? false),
    failed: ref(extra.failed ?? false)
  }
}

let ensureOverview: ReturnType<typeof vi.fn>

beforeEach(() => {
  ensureOverview = vi.fn()
  h.ai = {
    aiMode: ref('overview'),
    aiTargetParticipantId: ref(null),
    aiLoading: ref(false),
    aiStateLabel: ref(''),
    renderedAiResult: ref(''),
    ensureOverview,
    requestPlayer: vi.fn(),
    runCurrentAiAnalysis: vi.fn(),
    resetOnGameChange: vi.fn()
  }
})

const mountTab = (game: Game = gameB()) => mount(ReviewTab, { props: { game } })

describe('ReviewTab 降级', () => {
  it('重开局：提示且不请求 AI', () => {
    setReview(null, { isRemake: true })
    const w = mountTab(gameB({ gameDuration: 200 }))
    expect(w.find('[data-test="review-remake"]').text()).toContain('重开局')
    expect(ensureOverview).not.toHaveBeenCalled()
  })

  it('构建失败：提示', () => {
    setReview(null, { failed: true })
    expect(mountTab().find('[data-test="review-failed"]').exists()).toBe(true)
  })

  it('时间线拉取中：对位与个人卡先显示，图表区骨架', () => {
    setReview(modelB({ timeline: false }), { timelinePending: true })
    const w = mountTab()
    expect(w.find('[data-test="score-card"]').exists()).toBe(true)
    expect(w.find('[data-test="timeline-skeleton"]').exists()).toBe(true)
    expect(w.find('[data-test="timeline-notice"]').exists()).toBe(false)
    // 加载中不显示「无时间线」小结，改为加载提示
    expect(w.find('[data-test="death-summary"]').exists()).toBe(false)
    expect(w.find('[data-test="death-loading"]').text()).toContain('时间线加载中')
  })

  it('已有模型但时间线步骤抛错：保留模型并显示时间线不可用提示，不出失败面板', () => {
    setReview(modelB({ timeline: false }), { failed: true })
    const w = mountTab()
    expect(w.find('[data-test="review-failed"]').exists()).toBe(false)
    expect(w.find('[data-test="score-card"]').exists()).toBe(true)
    expect(w.find('[data-test="timeline-notice"]').exists()).toBe(true)
  })

  it('无时间线：提示，曲线/地图/出装隐藏，阵亡只给小结，个人卡无对线项', () => {
    setReview(modelB({ timeline: false }))
    const w = mountTab()
    expect(w.find('[data-test="timeline-notice"]').text()).toContain('本局时间线不可用')
    expect(w.find('[data-test="curve-plot"]').exists()).toBe(false)
    expect(w.find('[data-test="map-dot"]').exists()).toBe(false)
    expect(w.find('.item-timeline').exists()).toBe(false)
    expect(w.find('[data-test="death-summary"]').text()).toBe('阵亡 11 次（无时间线，无法细分）')
    expect(w.find('[data-test="matchup-diff"]').exists()).toBe(false)
    expect(w.findAll('[data-test="score-part"]').map(x => x.text())).not.toContainEqual(
      expect.stringContaining('对线')
    )
  })

  it('用户在设置里关了时间线：提示改为已关闭，而非不可用', () => {
    setReview(modelB({ timeline: false }), { timelineStatus: 'disabled' })
    const notice = mountTab().find('[data-test="timeline-notice"]').text()
    expect(notice).toContain('已在设置中关闭时间线')
    expect(notice).not.toContain('不可用')
  })

  it('无分路（大乱斗）：两队并列、无阵亡地图、出装对比全场中位', () => {
    setReview(modelB({ patch: { queueId: 450, gameMode: 'ARAM' } }))
    const w = mountTab()
    expect(w.findAll('[data-test="matchup-team"]')).toHaveLength(2)
    expect(w.find('[data-test="matchup-lane"]').exists()).toBe(false)
    expect(w.find('[data-test="curve-plot"]').exists()).toBe(true)
    expect(w.find('[data-test="death-row"]').exists()).toBe(true)
    expect(w.find('[data-test="map-dot"]').exists()).toBe(false)
    expect(w.find('[data-test="item-median"]').exists()).toBe(true)
  })

  it('无出装模式（海克斯大乱斗 2400）：不显示出装对比', () => {
    setReview(modelB({ patch: { queueId: 2400, gameMode: 'KIWI' } }))
    const w = mountTab()
    expect(w.find('[data-test="curve-plot"]').exists()).toBe(true)
    expect(w.find('.item-timeline').exists()).toBe(false)
  })

  it('无国服基准（斗魂竞技场）：个人卡不显示分位，说明改为本局平均', () => {
    setReview(modelB({ patch: { queueId: 1700, gameMode: 'CHERRY' }, timeline: false }))
    const w = mountTab()
    expect(w.find('[data-test="score-card-rank"]').exists()).toBe(false)
    expect(w.find('[data-test="score-card-note"]').text()).toContain('本模式暂无国服基准')
  })
})
