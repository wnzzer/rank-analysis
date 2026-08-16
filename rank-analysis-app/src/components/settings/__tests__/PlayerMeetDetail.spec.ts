/**
 * PlayerMeetDetail 行展开组件：meet.db 台账优先、本地 encounters 兜底
 *
 * @module components/settings/PlayerMeetDetail
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const mockQueryMeetSummary = vi.fn()
vi.mock('@renderer/services/meet', () => ({
  queryMeetSummary: (...args: unknown[]) => mockQueryMeetSummary(...args)
}))

import { defineComponent } from 'vue'
import PlayerMeetDetail from '../PlayerMeetDetail.vue'
import type { MeetSummary } from '@renderer/types/domain/meet'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'

const MettingPlayersCardStub = defineComponent({
  name: 'MettingPlayersCard',
  props: ['meetGames', 'meetTotal'],
  template:
    '<div class="meet-card-stub">cards:{{ meetGames?.length ?? 0 }}/total:{{ meetTotal ?? "-" }}</div>'
})

function makeGames(n: number): OneGamePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    gameCreatedAt: '2026-08-01T00:00:00.000Z',
    index: i,
    gameId: i,
    puuid: 'p',
    gameName: 'Tester',
    tagLine: '0001',
    championId: 1,
    win: true,
    kills: 1,
    deaths: 1,
    assists: 1,
    isMyTeam: true,
    queueIdCn: '排位赛'
  }))
}

function makeSummary(overrides: Partial<MeetSummary> = {}): MeetSummary {
  return {
    total: 12,
    myTeamMeets: 5,
    enemyMeets: 7,
    myTeamWins: 3,
    lastSeenAt: '2026-08-10T12:00:00.000Z',
    recent: makeGames(3),
    ...overrides
  }
}

async function mountDetail(fallbackGames: OneGamePlayer[] = makeGames(2)) {
  const wrapper = mount(PlayerMeetDetail, {
    props: { puuid: 'puuid-x', fallbackGames },
    global: {
      stubs: {
        MettingPlayersCard: MettingPlayersCardStub,
        NSpin: { template: '<span class="n-spin-stub" />' },
        'n-spin': { template: '<span class="n-spin-stub" />' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('PlayerMeetDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('meet.db 命中：渲染统计条（总数/同队/敌方/同队胜/最近相遇）与台账明细', async () => {
    mockQueryMeetSummary.mockResolvedValue(makeSummary())
    const wrapper = await mountDetail()

    const text = wrapper.text()
    expect(text).toContain('共遇见过')
    expect(text).toContain('12')
    expect(text).toContain('同队')
    expect(text).toContain('敌方')
    expect(text).toContain('最近相遇 08-10')
    expect(wrapper.find('.meet-card-stub').text()).toContain('cards:3')
    expect(wrapper.find('.meet-card-stub').text()).toContain('total:12')
    wrapper.unmount()
  })

  it('统计异常值：lastSeenAt 不可解析时隐藏最近相遇标签，不崩溃', async () => {
    mockQueryMeetSummary.mockResolvedValue(makeSummary({ lastSeenAt: 'xxx' }))
    const wrapper = await mountDetail()
    expect(wrapper.text()).not.toContain('最近相遇')
    wrapper.unmount()
  })

  it('库无记录（null）：回退展示本地 encounters（不渲染统计条）', async () => {
    mockQueryMeetSummary.mockResolvedValue(null)
    const fallback = makeGames(2)
    const wrapper = await mountDetail(fallback)

    expect(wrapper.find('.meet-stats-row').exists()).toBe(false)
    expect(wrapper.find('.meet-card-stub').text()).toContain('cards:2')
    wrapper.unmount()
  })

  it('查询失败：同样回退本地 encounters', async () => {
    mockQueryMeetSummary.mockRejectedValue(new Error('db down'))
    const fallback = makeGames(4)
    const wrapper = await mountDetail(fallback)

    expect(wrapper.find('.meet-stats-row').exists()).toBe(false)
    expect(wrapper.find('.meet-card-stub').text()).toContain('cards:4')
    wrapper.unmount()
  })
})
