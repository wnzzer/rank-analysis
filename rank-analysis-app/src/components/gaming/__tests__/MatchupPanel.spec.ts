/** 对位面板真实组件回归：百分比、缺失值及来源时间语义。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NProgress } from 'naive-ui'
import MatchupPanel from '../MatchupPanel.vue'
import ProgressMiniRow from '../ProgressMiniRow.vue'
import { MATCHUP_API } from '@renderer/services/matchup'
import type { MatchupApi, MatchupDetail, MatchupPosition } from '@renderer/types/matchup'

/** 保存本测试创建的组件，确保卸载查询订阅及浮层。 */
const wrappers: VueWrapper[] = []

/** 挂载正式面板，仅用固定数据替代外部 OP.GG 与客户端访问。
 * @param detail 候选详情覆盖值，默认展示两个有效比例。
 * @param position 当前分析分路。
 * @returns 已加载候选详情的真实面板。
 */
async function mountPanel(
  detail: Partial<MatchupDetail> = {},
  position: MatchupPosition = 'mid'
): Promise<VueWrapper> {
  const source = {
    version: '16.21',
    cachedAt: '2026-10-28T09:30:00',
    fetchedAt: 1793147400,
    stale: false,
    ...detail
  }
  const api: MatchupApi = {
    getList: async query => ({
      ...query,
      ...source,
      candidates: [{ championId: 1, enemyWinRate: 0.4, play: 1000 }]
    }),
    getDetail: async (query, candidateId) => ({
      ...query,
      candidateId,
      candidateWinRate: 0.523,
      laneKillRate: 0.617,
      play: 1000,
      ...source
    }),
    getPosition: async () => position,
    loadNames: async () => {},
    name: id => `英雄${id}`,
    icon: id => `/champion/${id}`
  }
  const wrapper = mount(MatchupPanel, {
    attachTo: document.body,
    props: {
      enemies: [{ slot: 0, championId: 103 }],
      selectedSlot: 0,
      tier: 'emerald_plus',
      active: true
    },
    global: { provide: { [MATCHUP_API as symbol]: api } }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('对位统计展示', () => {
  it('复用真实进度组件展示精确百分比，且不持续播放 processing 动画', async () => {
    const wrapper = await mountPanel()
    const row = wrapper.get('.matchup-row')
    expect(row.text()).toContain('52.3%')
    expect(row.text()).toContain('61.7%')
    const bars = wrapper.findAllComponents(ProgressMiniRow)
    expect(bars).toHaveLength(2)
    expect(bars[0].getComponent(NProgress).props('percentage')).toBeCloseTo(52.3)
    expect(bars[1].getComponent(NProgress).props('percentage')).toBeCloseTo(61.7)
    expect(bars.every(bar => bar.getComponent(NProgress).props('processing') === false)).toBe(true)
  })

  it('有效零值仍保留进度轨道和 0.0% 数字', async () => {
    const wrapper = await mountPanel({ candidateWinRate: 0, laneKillRate: 0 })
    const bars = wrapper.findAllComponents(ProgressMiniRow)
    expect(bars).toHaveLength(2)
    for (const bar of bars) {
      expect(bar.text()).toContain('0.0%')
      expect(bar.getComponent(NProgress).props('percentage')).toBe(0)
    }
  })

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    '缺失或非法比例 %s 显示暂无数据且不绘制进度条',
    async rate => {
      const wrapper = await mountPanel({ candidateWinRate: rate, laneKillRate: rate })
      expect(
        wrapper
          .get('.matchup-row')
          .text()
          .match(/暂无数据/g)
      ).toHaveLength(2)
      expect(wrapper.findAllComponents(NProgress)).toHaveLength(0)
    }
  )

  it('打野即使返回线杀数值也只显示不适用', async () => {
    const wrapper = await mountPanel({}, 'jungle')
    expect(wrapper.get('.matchup-row').text()).toContain('不适用')
    expect(wrapper.get('.matchup-row').text()).not.toContain('61.7%')
    expect(wrapper.findAllComponents(ProgressMiniRow)).toHaveLength(1)
  })

  it('旧进度组件调用仍保留标签、原精度及 processing 动画', () => {
    const wrapper = mount(ProgressMiniRow, {
      props: { label: '胜率', percent: 52, color: 'var(--semantic-win)' }
    })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('胜率')
    expect(wrapper.text()).toContain('52%')
    expect(wrapper.getComponent(NProgress).props('processing')).toBe(true)
  })
})

describe('来源时间语义', () => {
  it.each(['2026-10-28T09:30:00', '2026-10-30 21:25:30'])(
    '无时区来源 %s 保留原文，并明确提示时区未明确',
    async cachedAt => {
      const wrapper = await mountPanel({ cachedAt, stale: true })
      const footer = wrapper.get('.matchup-footer').text()
      expect(footer).toContain(`来源时间：${cachedAt}`)
      expect(footer).toContain('时区未明确')
      expect(footer).toContain('过期缓存')
      expect(footer).not.toMatch(/UTC|GMT|本地时间/)
    }
  )

  it.each(['2026-10-28T09:30:00Z', '2026-10-28T09:30:00+09:00'])(
    '带明确时区的来源 %s 保留原文且不换算本地时间',
    async cachedAt => {
      const wrapper = await mountPanel({ cachedAt })
      const footer = wrapper.get('.matchup-footer').text()
      expect(footer).toContain(`来源时间：${cachedAt}`)
      expect(footer).not.toContain('时区未明确')
    }
  )

  it('缺失来源时间时继续说明源未提供，不借用本地获取时间', async () => {
    const wrapper = await mountPanel({ cachedAt: null, stale: true })
    const footer = wrapper.get('.matchup-footer').text()
    expect(footer).toContain('源未提供更新时间')
    expect(footer).toContain('过期缓存')
    expect(footer).not.toContain('1793147400')
  })

  it('候选详情的提示也保留原始来源时间和时区缺失说明', async () => {
    const wrapper = await mountPanel()
    await wrapper.get('.candidate-rate').trigger('mouseenter')
    await vi.waitFor(() => {
      const tooltip = document.body.querySelector('.n-tooltip')
      expect(tooltip?.textContent).toContain('来源时间：2026-10-28T09:30:00')
      expect(tooltip?.textContent).toContain('时区未明确')
    })
  })
})
