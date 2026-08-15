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
import type { DualPick } from '@renderer/services/counterIntel'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const composableMock = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue')
  return {
    picks: ref<DualPick[]>([]),
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

function makePicks(): DualPick[] {
  return [
    {
      championId: 51,
      score: 0.62,
      counterScore: 0.52,
      synergyScore: 0.1,
      evidences: [
        { againstChampionId: 104, relation: 'favored', winRate: 0.58, play: 210 },
        { againstChampionId: 103, relation: 'countered', winRate: 0.41, play: 90 }
      ],
      synergyEvidences: [
        { teammateChampionId: 300, synergyPosition: 'ADC', winRate: 0.6, play: 120 }
      ]
    },
    {
      championId: 11,
      score: 0.1,
      counterScore: 0.1,
      synergyScore: 0,
      evidences: [{ againstChampionId: 104, relation: 'favored', winRate: 0.52, play: 300 }],
      synergyEvidences: []
    },
    {
      championId: 67,
      score: -0.2,
      counterScore: -0.2,
      synergyScore: 0,
      evidences: [],
      synergyEvidences: []
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

  it('把 teammateIds/myPosition 传给 useBestPicks（协同维度透传）', async () => {
    await mountPanel({ teammateIds: [300, 301], myPosition: 'BOTTOM' })
    const args = mockedUseBestPicks.mock.calls[0]
    const teammates = computed(() => [300, 301])
    const pos = computed(() => 'BOTTOM')
    expect(args[4]?.value).toEqual(teammates.value)
    expect(args[5]?.value).toEqual(pos.value)
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

  it('敌方只锁定 1 人且无队友亮时隐藏（保持原有隐藏规则）', async () => {
    const wrapper = await mountPanel({ enemyIds: [104] })
    expect(wrapper.find('.bp-bar').exists()).toBe(false)
  })

  it('纯协同场景：敌方 0 锁 + 队友已亮 ≥1 时显示条（常驻条文案为「与队友」）', async () => {
    const wrapper = await mountPanel({ enemyIds: [], teammateIds: [300] })
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    expect(wrapper.find('.bp-label').text()).toBe('与队友')
    expect(wrapper.find('.bp-arrow-label').text()).toBe('最优协同')
    expect(wrapper.find('.bp-panel-title').text()).toContain('与已亮队友协同的最佳选择')
  })

  it('敌方 1 锁 + 队友 1 亮也显示（协同维度放宽显示门槛）', async () => {
    const wrapper = await mountPanel({ enemyIds: [104], teammateIds: [300] })
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    expect(wrapper.find('.bp-arrow-label').text()).toBe('双维最优')
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

  it('展开层渲染 Top5 卡：头像/名字/总分/协同与对位子分/证据行', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel({ teammateIds: [300] })
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards).toHaveLength(3)
    const first = cards[0]
    expect(first.text()).toContain('英雄51')
    expect(first.text()).toContain('分数 +0.62')
    expect(first.text()).toContain('协同 +0.10')
    expect(first.text()).toContain('对位 +0.52')
    expect(first.text()).toContain('协同 英雄300（60.0% · 120 局）')
    expect(first.text()).toContain('克制 英雄104（58.0% · 210 局）')
    expect(first.text()).toContain('被克 英雄103（41.0% · 90 局）')
  })

  it('无队友时隐藏协同子分（纯对位模式）', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-pick-card').text()).not.toContain('协同 +')
  })

  it('unknown 候选一次带过「无 OP.GG 数据」', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards[2].text()).toContain('其余对位/协同无 OP.GG 数据')
  })

  it('全部候选 ≤0 时显示「无正面对位优势」提示', async () => {
    composableMock.picks.value = [
      {
        championId: 67,
        score: 0,
        counterScore: 0,
        synergyScore: 0,
        evidences: [],
        synergyEvidences: []
      },
      {
        championId: 1,
        score: -0.1,
        counterScore: -0.1,
        synergyScore: 0,
        evidences: [],
        synergyEvidences: []
      }
    ]
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('无正面对位优势英雄')
  })

  it('无推荐结果时显示空态（敌方锁定但无收益）', async () => {
    composableMock.picks.value = []
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('敌方尚未锁定英雄')
  })
})
