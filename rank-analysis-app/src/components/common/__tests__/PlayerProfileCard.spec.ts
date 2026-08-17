import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PlayerProfileCard from '../PlayerProfileCard.vue'
import { fetchPlayerProfile } from '@renderer/services/ai/shared/recentProfile.batch'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

vi.mock('@renderer/services/ai/shared/recentProfile.batch', () => ({
  fetchPlayerProfile: vi.fn()
}))

const PROFILE: RecentPlayerProfile = {
  positionDistribution: [
    { pos: 'JUNGLE', ratio: 0.7, games: 14 },
    { pos: 'TOP', ratio: 0.3, games: 6 }
  ],
  mainPosition: 'JUNGLE',
  currentLanePlayedRatio: 0.7,
  championDistribution: [
    { championId: 64, name: '李青', games: 12, winRate: 0.66, avgKda: 3.1 },
    { championId: 86, name: '嘉文四世', games: 4, winRate: 0.5, avgKda: 2.2 }
  ],
  currentChampionMastery: {
    gamesInRecent: 12,
    winRate: 0.66,
    avgKda: 3.1,
    isOnetrick: true,
    isFirstTimeInRecent: false
  },
  recentWinRate: 0.6,
  recentKda: 3.2,
  streak: { kind: 'win', count: 3 },
  isOffRole: false,
  offRoleSeverity: 'none'
}

describe('PlayerProfileCard', () => {
  beforeEach(() => {
    vi.mocked(fetchPlayerProfile).mockReset()
    vi.mocked(fetchPlayerProfile).mockResolvedValue(PROFILE)
  })

  it('渲染近期胜率 / KDA / 连胜', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1', name: '测试玩家' } })
    await flushPromises()
    expect(wrapper.text()).toContain('测试玩家')
    expect(wrapper.text()).toContain('60%')
    expect(wrapper.text()).toContain('3.20')
    expect(wrapper.text()).toContain('连胜3')
    expect(wrapper.text()).toContain('李青')
    expect(wrapper.text()).toContain('12场 66%')
  })

  it('主玩位置高亮 chip', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    const main = wrapper.find('.chip-main')
    expect(main.exists()).toBe(true)
    expect(main.text()).toContain('打野')
  })

  it('传 championId 时显示本局英雄熟练度', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1', championId: 64 } })
    await flushPromises()
    expect(wrapper.text()).toContain('绝活')
    expect(wrapper.text()).toContain('12 场')
  })

  it('不传 championId 时不渲染本局英雄小节', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('本局英雄')
    expect(wrapper.find('.profile-mastery').exists()).toBe(false)
  })

  it('数据为空时显示空态', async () => {
    vi.mocked(fetchPlayerProfile).mockResolvedValue(null)
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
  })

  it('拉取失败时显示空态而非崩溃', async () => {
    vi.mocked(fetchPlayerProfile).mockRejectedValue(new Error('boom'))
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
  })
})
