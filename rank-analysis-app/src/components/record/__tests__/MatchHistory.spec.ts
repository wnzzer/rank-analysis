import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// Stub vue-router useRoute so the `name` query read doesn't blow up.
// Use importOriginal so other modules importing createRouter/createWebHashHistory still work.
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({ query: {} })
  }
})

// 静态导入（vi.mock 会被提升到其前）：组件 + naive-ui 的编译耗时计入收集阶段，
// 不占用例 5s 超时（动态 import 在 dev 版并行运行时实测会超时）
import MatchHistory from '../MatchHistory.vue'
import RecordCardSkeleton from '../RecordCardSkeleton.vue'

const stubs = {
  RecordCard: true,
  RecordCardSkeleton: true,
  NPagination: true,
  NEmpty: true,
  NButton: true,
  NSelect: true,
  // 测试里未全局注册 naive-ui；NFlex 是列表的外层容器，必须透传插槽才能断言其内容
  NFlex: { template: '<div><slot /></div>' },
  NIcon: true,
  NTooltip: true,
  NSpin: true
}

/** 10 局最小对局桩：RecordCard 被 stub，collectAssetIds 遇到空 participants 会跳过 */
const tenGames = Array.from({ length: 10 }, (_, i) => ({ gameId: i + 1, participants: [] }))

describe('MatchHistory', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_match_history_by_name'
        ? { games: { games: tenGames }, begIndex: 0, endIndex: 9 }
        : []
    )
  })

  it('mounts without a loading-bar provider', async () => {
    const wrapper = mount(MatchHistory, { global: { stubs } })
    await flushPromises()
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    wrapper.unmount()
  })

  it('shows skeletons before the first page arrives', () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_match_history_by_name' ? new Promise(() => {}) : []
    )
    const wrapper = mount(MatchHistory, { global: { stubs } })
    expect(wrapper.findAllComponents(RecordCardSkeleton)).toHaveLength(10)
    wrapper.unmount()
  })

  it('dims the current list while a follow-up request is in flight', async () => {
    const wrapper = mount(MatchHistory, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('.match-history-list--refreshing').exists()).toBe(false)

    // 筛选请求永不返回：旧列表应保留并变淡，而不是闪骨架
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_filter_match_history_by_name' ? new Promise(() => {}) : []
    )
    // n-select 未全局注册、按名字 stub，只能按名字查；第一个是模式筛选（v-model filterQueueId）
    wrapper.findComponent({ name: 'NSelect' }).vm.$emit('update:value', 420)
    await flushPromises()

    expect(wrapper.find('.match-history-list--refreshing').exists()).toBe(true)
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    wrapper.unmount()
  })
})
