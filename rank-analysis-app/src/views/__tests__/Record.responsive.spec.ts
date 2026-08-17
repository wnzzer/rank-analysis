import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Record from '@renderer/views/Record.vue'

/**
 * 战绩页响应式（§5.5 P1）：
 * - 宽窗（>=1064）：左栏常驻，无抽屉触发钮
 * - 窄窗（<1064）：左栏收抽屉，内容区左上角触发钮可用
 */

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

vi.mock('@renderer/composables/usePlayerRecordData', () => ({
  usePlayerRecordData: () => ({
    summoner: {
      puuid: 'p1',
      gameName: 'Tester',
      tagLine: '0001',
      summonerLevel: 50,
      profileIconId: 1
    },
    rank: { queueMap: { RANKED_SOLO_5x5: null, RANKED_FLEX_SR: null } },
    solo5v5: { winRate: 0 },
    flex: { winRate: 0 },
    recentData: { wins: 0, losses: 0, friendAndDispute: null },
    tags: [],
    platformIdCn: '联盟一区',
    mode: '420',
    isCrossRegion: false,
    updateMode: vi.fn()
  })
}))

const stubs = {
  PlayerBar: { template: '<div class="player-bar-stub" />' },
  UserSidePanel: { template: '<div class="user-side-panel-stub" />' },
  MatchHistory: { template: '<div class="match-history-stub" />' },
  /* 注意：stub 键须用 naive-ui 组件内部 name（Button/Drawer/Icon），
     而非 import 名（NButton/NDrawer/NIcon）——VTU 按组件 name 匹配；
     同时声明 emits 阻止父监听器以 attrs 形式落到 stub 根元素（否则点击双触发） */
  Button: {
    name: 'Button',
    emits: ['click'],
    template:
      '<button class="n-button-stub" @click="$emit(\'click\')"><slot /><slot name="icon" /></button>'
  },
  Icon: { template: '<span class="n-icon-stub"><slot /></span>' },
  Drawer: {
    name: 'Drawer',
    props: ['show'],
    emits: ['update:show'],
    template: '<div v-if="show" class="n-drawer-stub"><slot /></div>'
  },
  DrawerContent: {
    name: 'DrawerContent',
    template: '<div class="n-drawer-content-stub"><slot /></div>'
  }
}

describe('Record 响应式布局', () => {
  beforeEach(() => {
    setWidth(1280)
  })

  it('宽窗：左栏常驻，无抽屉触发钮', async () => {
    setWidth(1280)
    const wrapper = mount(Record, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('.record-side').exists()).toBe(true)
    expect(wrapper.find('.record-side-trigger').exists()).toBe(false)
    expect(wrapper.find('.n-drawer-stub').exists()).toBe(false)
  })

  it('窄窗：左栏收起进抽屉，触发钮可见', async () => {
    setWidth(1000)
    const wrapper = mount(Record, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('.record-side').exists()).toBe(false)
    expect(wrapper.find('.record-side-trigger').exists()).toBe(true)
    // 抽屉默认关闭，点触发钮打开
    expect(wrapper.find('.n-drawer-stub').exists()).toBe(false)
    await wrapper.find('.record-side-trigger').trigger('click')
    expect(wrapper.find('.n-drawer-stub').exists()).toBe(true)
  })

  it('窄窗→宽窗：抽屉自动关闭', async () => {
    setWidth(1000)
    const wrapper = mount(Record, { global: { stubs } })
    await flushPromises()
    await wrapper.find('.record-side-trigger').trigger('click')
    expect(wrapper.find('.n-drawer-stub').exists()).toBe(true)
    setWidth(1280)
    await flushPromises()
    expect(wrapper.find('.n-drawer-stub').exists()).toBe(false)
  })

  it('窄窗下抽屉内容为 UserSidePanel', async () => {
    setWidth(1000)
    const wrapper = mount(Record, { global: { stubs } })
    await flushPromises()
    await wrapper.find('.record-side-trigger').trigger('click')
    expect(wrapper.findAll('.user-side-panel-stub').length).toBe(1)
  })
})
