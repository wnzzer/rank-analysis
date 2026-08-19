/**
 * EnemyThreatCard 赛前威胁评级卡（M4 战场六）单元测试。
 *
 * 覆盖：
 * - 空数组不渲染卡片；
 * - 最高威胁指示条取全列表最高等级；
 * - 逐玩家行：威胁徽章 / 分路 / 交手局数 / 统计 / 风格标签 / caveats；
 * - Low 行弱化样式类；
 * - 格式函数对 null/undefined 的安全回落。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EnemyThreatCard from '../EnemyThreatCard.vue'
import type { ThreatRating } from '@renderer/services/scouting'

function sampleRating(overrides: Partial<ThreatRating> = {}): ThreatRating {
  return {
    threatLevel: 'Medium',
    styleTags: [],
    encounterCount: 0,
    laneAggression: 1.2,
    recentPerformance: 8.0,
    mainChampionWinRate: null,
    caveats: [],
    puuid: 'p1',
    position: 'TOP',
    ...overrides
  }
}

describe('EnemyThreatCard', () => {
  it('should not render when ratings is empty', () => {
    const wrapper = mount(EnemyThreatCard, { props: { ratings: [] } })
    expect(wrapper.find('.threat-card').exists()).toBe(false)
  })

  it('should render card with max threat header', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: {
        ratings: [
          sampleRating({ threatLevel: 'Low' }),
          sampleRating({ puuid: 'p2', threatLevel: 'Critical' })
        ]
      }
    })
    expect(wrapper.find('.threat-card').exists()).toBe(true)
    expect(wrapper.find('.threat-value').text()).toBe('极高威胁')
  })

  it('should render each player row with position and badge', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: { ratings: [sampleRating({ position: 'BOTTOM' })] }
    })
    expect(wrapper.find('.threat-badge').text()).toBe('中等')
    expect(wrapper.find('.threat-pos').text()).toBe('BOTTOM')
  })

  it('should show encounter count when greater than zero', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: { ratings: [sampleRating({ encounterCount: 7 })] }
    })
    expect(wrapper.find('.threat-encounter').text()).toContain('交手 7 局')
  })

  it('should hide encounter count when zero', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: { ratings: [sampleRating({ encounterCount: 0 })] }
    })
    expect(wrapper.find('.threat-encounter').exists()).toBe(false)
  })

  it('should render performance / win rate / aggression stats', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: {
        ratings: [sampleRating({ recentPerformance: 12.34, mainChampionWinRate: 0.55 })]
      }
    })
    const stats = wrapper.find('.threat-row-stats').text()
    expect(stats).toContain('表现分 12.3')
    expect(stats).toContain('胜率 55%')
    expect(stats).toContain('侵略性 1.2')
  })

  it('should render style tags', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: {
        ratings: [sampleRating({ styleTags: ['侵略性强', '高KDA'] })]
      }
    })
    const tags = wrapper.findAll('.threat-tag').map(t => t.text())
    expect(tags).toEqual(['侵略性强', '高KDA'])
  })

  it('should render caveats', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: {
        ratings: [sampleRating({ caveats: ['数据不足', '未交手'] })]
      }
    })
    const caveats = wrapper.findAll('.threat-caveat').map(c => c.text())
    expect(caveats).toEqual(['数据不足', '未交手'])
  })

  it('should apply low-threat dimming class only to Low rows', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: {
        ratings: [
          sampleRating({ threatLevel: 'Low' }),
          sampleRating({ puuid: 'p2', threatLevel: 'High' })
        ]
      }
    })
    const rows = wrapper.findAll('.threat-row')
    expect(rows[0].classes()).toContain('threat-row-low')
    expect(rows[1].classes()).not.toContain('threat-row-low')
  })

  it('should format percent safely for null values', () => {
    const wrapper = mount(EnemyThreatCard, {
      props: { ratings: [sampleRating({ mainChampionWinRate: null })] }
    })
    expect(wrapper.find('.threat-row-stats').text()).toContain('胜率 -')
  })
})
