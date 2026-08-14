/**
 * BestPicksPanel 推荐条组件测试：
 * 常驻条渲染（敌方头像 + Top3）/ 展开 Top5 卡 / 理由行 / unknown 一次带过 /
 * 全 ≤0 提示 / 敌方锁定不足空态 / 失败降级。
 * 数据层（useBestPicks）已由 composable 单测覆盖，这里 mock 后验证 UI。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import type { BestPick } from '@renderer/services/counterIntel'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const composableMock = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue')
  return {
    picks: ref<BestPick[]>([]),
    isLoading: ref(false),
    error: ref(false)
  }
})

vi.mock('@renderer/composables/useCounterIntel', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/composables/useCounterIntel')>()
  return {
    ...actual,
    useBestPicks: vi.fn(() => ({
      picks: composableMock.picks,
      isLoading: composableMock.isLoading,
      error: composableMock.error
    }))
  }
})

vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => `英雄${id}`,
  loadChampionNames: vi.fn(async () => {})
}))

import BestPicksPanel from '../BestPicksPanel.vue'
import { useBestPicks } from '@renderer/composables/useCounterIntel'

const mockedUseBestPicks = vi.mocked(useBestPicks)

function makePicks(): BestPick[] {
  return [
    {
      championId: 51,
      score: 0.62,
      evidences: [
        { againstChampionId: 104, relation: 'favored', winRate: 0.58, play: 210 },
        { againstChampionId: 103, relation: 'countered', winRate: 0.41, play: 90 }
      ]
    },
    {
      championId: 11,
      score: 0.1,
      evidences: [{ againstChampionId: 104, relation: 'favored', winRate: 0.52, play: 300 }]
    },
    {
      championId: 67,
      score: -0.2,
      evidences: []
    }
  ]
}

async function mountPanel(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(BestPicksPanel, {
    props: {
      enemyIds: [104, 103, 102],
      candidateIds: [51, 11, 67, 1, 2],
      tier: 'emerald_plus',
      ...props
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        Popover: {
          template: '<div class="popover-stub"><slot name="trigger" /><slot /></div>'
        }
      }
    }
  })
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  composableMock.picks.value = []
  composableMock.isLoading.value = false
  composableMock.error.value = false
})

describe('BestPicksPanel', () => {
  it('把 enemyIds/candidateIds/tier 传给 useBestPicks（响应式透传）', async () => {
    await mountPanel()
    expect(mockedUseBestPicks).toHaveBeenCalledTimes(1)
    const args = mockedUseBestPicks.mock.calls[0]
    const ids = computed(() => [104, 103, 102])
    const candidates = computed(() => [51, 11, 67, 1, 2])
    const tier = computed(() => 'emerald_plus')
    expect(args[0].value).toEqual(ids.value)
    expect(args[1].value).toEqual(candidates.value)
    expect(args[2].value).toEqual(tier.value)
  })

  it('敌方锁定 ≥2 时显示推荐条，含敌方头像与 Top3 应对', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    const enemyAvatars = wrapper.findAll('.bp-enemy-avatar')
    expect(enemyAvatars).toHaveLength(3)
    const pickAvatars = wrapper.findAll('.bp-pick-avatar')
    expect(pickAvatars).toHaveLength(3)
  })

  it('敌方只锁定 1 人时不显示推荐条', async () => {
    const wrapper = await mountPanel({ enemyIds: [104] })
    expect(wrapper.find('.bp-bar').exists()).toBe(false)
  })

  it('loading 时显示分析中提示', async () => {
    composableMock.isLoading.value = true
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').text()).toContain('分析中')
  })

  it('失败时降级文案不崩溃', async () => {
    composableMock.error.value = true
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').text()).toContain('OP.GG 数据未就绪')
  })

  it('展开层渲染 Top5 卡：头像/名字/分数/证据行', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards).toHaveLength(3)
    const first = cards[0]
    expect(first.text()).toContain('英雄51')
    expect(first.text()).toContain('+0.62')
    expect(first.text()).toContain('克制 英雄104（58.0% · 210 局）')
    expect(first.text()).toContain('被克 英雄103（41.0% · 90 局）')
  })

  it('unknown 候选一次带过「无 OP.GG 数据」', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards[2].text()).toContain('其余敌方对位无 OP.GG 数据')
  })

  it('全部候选 ≤0 时显示「无正面对位优势」提示', async () => {
    composableMock.picks.value = [
      { championId: 67, score: 0, evidences: [] },
      { championId: 1, score: -0.1, evidences: [] }
    ]
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('无正面对位优势英雄')
  })

  it('无推荐结果时显示空态', async () => {
    composableMock.picks.value = []
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('暂无正面对位优势英雄')
  })
})
