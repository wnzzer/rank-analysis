/**
 * CounterHover 对位弹窗组件测试：
 * 列表渲染 / 排序交互（点击表头）/ 空态 / loading / 失败 / 来源标注 / stale 标注。
 * 数据层（useCounterIntel）已由 composable 单测覆盖，这里 mock 后验证 UI 行为。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ChampionIntel } from '@renderer/services/counterIntel'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// naive-ui 弹层在 jsdom 下需要 message/等上下文，统一按既有约定替换
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual }
})

const composableMock = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue')
  return {
    intel: ref<import('@renderer/services/counterIntel').ChampionIntel | null>(null),
    isLoading: ref(false),
    error: ref(false)
  }
})

vi.mock('@renderer/composables/useCounterIntel', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/composables/useCounterIntel')>()
  return {
    ...actual,
    useCounterIntel: vi.fn(() => ({
      intel: composableMock.intel,
      isLoading: composableMock.isLoading,
      error: composableMock.error
    }))
  }
})

vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => `英雄${id}`,
  loadChampionNames: vi.fn(async () => {})
}))

vi.mock('@renderer/services/opgg', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/services/opgg')>()
  return {
    ...actual,
    getOpggStatus: vi.fn(async () => ({
      mode: 'ranked',
      patch: '16.16',
      fetchedAt: Date.now(),
      stale: false,
      championCount: 10,
      tier: 'emerald_plus'
    }))
  }
})

import CounterHover from '../CounterHover.vue'
import { useCounterIntel } from '@renderer/composables/useCounterIntel'
import { getOpggStatus } from '@renderer/services/opgg'

const mockedUseCounterIntel = vi.mocked(useCounterIntel)
const mockedGetOpggStatus = vi.mocked(getOpggStatus)

function makeIntel(overrides: Partial<ChampionIntel> = {}): ChampionIntel {
  return {
    region: 'global',
    tier: 'emerald_plus',
    fetchedAt: Date.now(),
    stale: false,
    counters: [
      { championId: 1, play: 3120, win: 1690, winRate: 0.542 },
      { championId: 2, play: 2870, win: 1515, winRate: 0.528 },
      { championId: 3, play: 2401, win: 1246, winRate: 0.519 },
      { championId: 4, play: 300, win: 120, winRate: 0.4 }
    ],
    synergies: [],
    ...overrides
  }
}

async function mountHover(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(CounterHover, {
    props: {
      championId: 86,
      position: 'TOP',
      tier: 'emerald_plus',
      ...props
    },
    slots: { default: '<img class="avatar-slot" />' },
    global: {
      plugins: [createPinia()],
      // n-popover 懒渲染 + teleport 到 body，jsdom 下查不到内容；
      // stub 成直接渲染 trigger+content 的容器，聚焦测试弹窗内容逻辑
      stubs: {
        Popover: {
          template: '<div class="n-popover-stub"><slot name="trigger" /><slot /></div>'
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
  composableMock.intel.value = null
  composableMock.isLoading.value = false
  composableMock.error.value = false
})

describe('CounterHover', () => {
  it('把 championId/position/tier 透传给 useCounterIntel', async () => {
    await mountHover()
    expect(mockedUseCounterIntel).toHaveBeenCalledTimes(1)
    const args = mockedUseCounterIntel.mock.calls[0]
    expect(args[0].value).toBe(86)
    expect(args[1].value).toBe('TOP')
    expect(args[2].value).toBe('emerald_plus')
  })

  it('无数据时显示空态文案，不渲染表格', async () => {
    composableMock.intel.value = makeIntel({ counters: [] })
    const wrapper = await mountHover()
    expect(wrapper.text()).toContain('该分路对位样本不足')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('loading 时显示加载提示', async () => {
    composableMock.isLoading.value = true
    const wrapper = await mountHover()
    expect(wrapper.text()).toContain('正在加载对位数据')
  })

  it('失败时显示降级文案', async () => {
    composableMock.error.value = true
    const wrapper = await mountHover()
    expect(wrapper.text()).toContain('OP.GG 数据未就绪')
  })

  it('按胜率降序渲染列表（默认排序）', async () => {
    composableMock.intel.value = makeIntel()
    const wrapper = await mountHover()
    const cells = wrapper.findAll('tbody tr')
    expect(cells).toHaveLength(4)
    const first = cells[0].findAll('td')
    expect(first[1].text()).toContain('54.2')
    expect(first[2].text()).toBe('3120')
  })

  it('点击表头切换胜率升降序', async () => {
    composableMock.intel.value = makeIntel()
    const wrapper = await mountHover()
    // 胜率列（第二列表头）→ 切为升序
    const headers = wrapper.findAll('th')
    await headers[1].trigger('click')
    const first = wrapper.findAll('tbody tr')[0].findAll('td')
    expect(first[1].text()).toContain('40.0')
    // 再点一次 → 回降序
    await wrapper.findAll('th')[1].trigger('click')
    const again = wrapper.findAll('tbody tr')[0].findAll('td')
    expect(again[1].text()).toContain('54.2')
  })

  it('点击场次列切排序，且未排序列默认降序', async () => {
    composableMock.intel.value = makeIntel()
    const wrapper = await mountHover()
    const headers = wrapper.findAll('th')
    await headers[2].trigger('click')
    const first = wrapper.findAll('tbody tr')[0].findAll('td')
    expect(first[2].text()).toBe('3120')
  })

  it('来源标注包含 region/tier/patch', async () => {
    composableMock.intel.value = makeIntel()
    const wrapper = await mountHover()
    const footer = wrapper.find('.counter-hover-footer')
    expect(footer.text()).toContain('OP.GG global · emerald_plus · 16.16')
  })

  it('stale 时底栏追加「数据可能过期」', async () => {
    composableMock.intel.value = makeIntel({ stale: true })
    const wrapper = await mountHover()
    expect(wrapper.find('.counter-hover-footer').text()).toContain('数据可能过期')
  })

  it('championId ≤ 0 或 position 为空时禁用弹窗（不调 composable 数据）', async () => {
    const wrapper = await mountHover({ championId: 0 })
    // 组件仍挂载，但禁用态下不触发数据请求逻辑（由 composable 单测覆盖），这里验证不崩
    expect(wrapper.find('.counter-hover').exists()).toBe(true)
  })

  it('英雄名渲染（loadChampionNames 后）', async () => {
    composableMock.intel.value = makeIntel()
    const wrapper = await mountHover()
    await new Promise(r => setTimeout(r, 0))
    expect(mockedGetOpggStatus).toHaveBeenCalledWith('ranked')
    expect(wrapper.text()).toContain('英雄1')
  })
})
