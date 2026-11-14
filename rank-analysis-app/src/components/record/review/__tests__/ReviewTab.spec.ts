/**
 * ReviewTab：默认选中本人、点击切换玩家各模块同步、打开即整局点评、单人点评按需、
 * AI 引用 [D?] 定位阵亡 / [F1] 展开团战弹出卡、focusPlayer 暴露方法。
 * 两个 composable 用可控替身（真实视图模型来自回归局 B）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReviewModel } from '@renderer/services/ai/review/buildReviewModel'
import { gameB, modelB } from './fixtureModels'

const h = vi.hoisted(() => ({ review: null as unknown, ai: null as unknown }))
vi.mock('@renderer/composables/useReviewModel', () => ({ useReviewModel: () => h.review }))
vi.mock('@renderer/composables/useMatchAIAnalysis', () => ({ useMatchAIAnalysis: () => h.ai }))

import ReviewTab from '../ReviewTab.vue'

const MODEL = modelB()

function makeReview(model: ReviewModel | null = MODEL) {
  return {
    model: shallowRef(model),
    timelinePending: ref(false),
    timelineStatus: ref<'ok' | 'disabled' | 'unavailable' | null>('ok'),
    isRemake: ref(false),
    failed: ref(false)
  }
}

function makeAi() {
  return {
    aiMode: ref<'overview' | 'player'>('overview'),
    aiTargetParticipantId: ref<number | null>(null),
    aiLoading: ref(false),
    aiStateLabel: ref(''),
    renderedAiResult: ref(''),
    ensureOverview: vi.fn(),
    requestPlayer: vi.fn(),
    runCurrentAiAnalysis: vi.fn(),
    resetOnGameChange: vi.fn()
  }
}

let ai: ReturnType<typeof makeAi>

beforeEach(() => {
  h.review = makeReview()
  ai = makeAi()
  h.ai = ai
})

const mountTab = () => mount(ReviewTab, { props: { game: gameB() } })

describe('ReviewTab', () => {
  it('打开即复位并生成整局点评；默认选中本人', () => {
    const w = mountTab()
    expect(ai.resetOnGameChange).toHaveBeenCalledTimes(1)
    expect(ai.ensureOverview).toHaveBeenCalledTimes(1)
    expect(w.find('[data-test="score-card-name"]').text()).toBe('英雄112（你）')
    expect(w.find('[data-pid="9"]').classes()).toContain('is-selected')
    expect(w.find('[data-test="key-reason"]').text()).toContain('胜负关键：蓝方')
    expect(w.find('[data-test="review-disclaimer"]').text()).toContain('仅供参考')
  })

  it('点击对位玩家：个人卡、阵亡列表、曲线阵亡点同步切换', async () => {
    const w = mountTab()
    await w.find('[data-pid="4"]').trigger('click')
    const p4 = MODEL.players[4]
    expect(w.find('[data-test="score-card-name"]').text()).toBe(p4.champion)
    expect(w.findAll('[data-test="death-row"]')).toHaveLength(p4.deathList!.length)
    expect(w.findAll('[data-test="curve-death"]')).toHaveLength(p4.deathList!.length)
    expect(w.findAll('[data-test="map-dot"]')).toHaveLength(p4.deathList!.length)
    expect(ai.requestPlayer).not.toHaveBeenCalled()
  })

  it('「生成该玩家点评」按需调用 requestPlayer', async () => {
    const w = mountTab()
    await w.find('[data-pid="4"]').trigger('click')
    const btn = w.find('[data-test="ai-player"]')
    expect(btn.text()).toBe(`生成${MODEL.players[4].champion}的点评`)
    await btn.trigger('click')
    expect(ai.requestPlayer).toHaveBeenCalledWith(4)
  })

  it('正在看该玩家的单人点评时不再显示生成按钮，显示回到整局', async () => {
    ai.aiMode.value = 'player'
    ai.aiTargetParticipantId.value = 9
    const w = mountTab()
    await nextTick()
    expect(w.find('[data-test="ai-player"]').exists()).toBe(false)
    expect(w.find('[data-test="ai-title"]').text()).toBe('英雄112 单人点评')
    await w.find('[data-test="ai-overview"]').trigger('click')
    expect(ai.ensureOverview).toHaveBeenCalledTimes(2)
  })

  it('引用 [D?] 定位：切到死者并高亮该次阵亡', async () => {
    const target = MODEL.players[4].deathList![2]
    ai.renderedAiResult.value = `<p>看这里<sup class="ai-cite">${target.cardId}</sup></p>`
    const w = mountTab()
    await w.find('.ai-cite').trigger('click')
    expect(w.find('[data-test="score-card-name"]').text()).toBe(MODEL.players[4].champion)
    const row = w.find(`[data-test="death-row"][data-index="2"]`)
    expect(row.classes()).toContain('is-focused')
    expect(row.classes()).toContain('is-hovered')
  })

  it('引用 [F1] 定位：展开曲线上的团战弹出卡', async () => {
    ai.renderedAiResult.value = '<p>团战<sup class="ai-cite">F1</sup></p>'
    const w = mountTab()
    expect(w.find('[data-test="curve-popover"]').exists()).toBe(false)
    await w.find('.ai-cite').trigger('click')
    expect(w.find('[data-test="curve-popover"]').text()).toContain('6:53 下半河道团战')
  })

  it('阵亡列表悬停与地图联动', async () => {
    const w = mountTab()
    await w.findAll('[data-test="death-row"]')[3].trigger('mouseenter')
    expect(w.findAll('[data-test="map-dot"]')[3].classes()).toContain('is-hovered')
  })

  it('出装对比：本人 vs 对位', () => {
    const w = mountTab()
    expect(w.find('[data-test="item-gap"]').text()).toBe('· 第一件传说装比对位早 0.8 分钟')
  })

  it('focusPlayer：切到玩家并可同时生成单人点评', async () => {
    const w = mountTab()
    ;(w.vm as unknown as { focusPlayer: (pid: number, withAi?: boolean) => void }).focusPlayer(
      6,
      true
    )
    await nextTick()
    expect(w.find('[data-test="score-card-name"]').text()).toBe(MODEL.players[6].champion)
    expect(ai.requestPlayer).toHaveBeenCalledWith(6)
  })

  it('非 D/F 前缀的引用点击无动作', async () => {
    ai.renderedAiResult.value = '<p><sup class="ai-cite">S1</sup><sup class="ai-cite">O2</sup></p>'
    const w = mountTab()
    for (const c of w.findAll('.ai-cite')) await c.trigger('click')
    expect(w.find('[data-test="score-card-name"]').text()).toBe('英雄112（你）')
    expect(w.find('[data-test="curve-popover"]').exists()).toBe(false)
    expect(w.find('.is-focused').exists()).toBe(false)
  })

  it('重复点击同一条 [D?] 引用：再次滚动到该行', async () => {
    const scroll = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      const target = MODEL.players[4].deathList![2]
      ai.renderedAiResult.value = `<p><sup class="ai-cite">${target.cardId}</sup></p>`
      const w = mountTab()
      await w.find('.ai-cite').trigger('click')
      await flushPromises()
      const first = scroll.mock.calls.length
      expect(first).toBeGreaterThan(0)
      await w.find('.ai-cite').trigger('click')
      await flushPromises()
      expect(scroll.mock.calls.length).toBeGreaterThan(first)
      expect(w.find('[data-test="death-row"][data-index="2"]').classes()).toContain('is-focused')
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })

  it('有分路但本人无对位：不传全场中位，出装行只画本人', () => {
    const model = modelB()
    const players = { ...model.players, 9: { ...model.players[9], opponentId: null } }
    h.review = makeReview({ ...model, players })
    const w = mountTab()
    expect(w.find('[data-test="item-median"]').exists()).toBe(false)
    expect(w.findAll('[data-test="item-mine"]').length).toBeGreaterThan(0)
    expect(w.find('[data-test="item-other"]').exists()).toBe(false)
  })

  it('阵亡地图仅在峡谷 + 分路 + 时间线时渲染', () => {
    expect(mountTab().find('[data-test="map-dot"]').exists()).toBe(true)
    h.review = makeReview(modelB({ patch: { queueId: 450, gameMode: 'ARAM', mapId: 12 } }))
    expect(mountTab().find('.death-map').exists()).toBe(false)
    h.review = makeReview(modelB({ timeline: false }))
    expect(mountTab().find('.death-map').exists()).toBe(false)
  })

  it('模型未就绪：显示骨架', () => {
    h.review = makeReview(null)
    const w = mountTab()
    expect(w.find('[data-test="review-loading"]').exists()).toBe(true)
  })
})
