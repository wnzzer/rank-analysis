import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TeamStrengthBar from '../TeamStrengthBar.vue'
import { EMPTY_LINEUP_SCORE, type LineupScore } from '@renderer/services/lineupScore'

vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => `英雄${id}`
}))

function score(
  v: number,
  opts: { covered?: number; total?: number; playerAdjusted?: boolean } = {}
): LineupScore {
  const covered = opts.covered ?? 5
  return {
    score: v,
    covered,
    total: opts.total ?? 5,
    bestTier: 1,
    playerAdjusted: opts.playerAdjusted ?? false,
    breakdown: [
      { championId: 1, baseWinRate: 51, playerWinRate: null, adjustedWinRate: 51, reasons: [] },
      ...Array.from({ length: covered - 1 }, (_, i) => ({
        championId: 100 + i,
        baseWinRate: 50,
        playerWinRate: null,
        adjustedWinRate: 50,
        reasons: [] as string[]
      }))
    ]
  }
}

function adjustedScore(): LineupScore {
  return {
    score: 53.0,
    covered: 2,
    total: 2,
    bestTier: 1,
    playerAdjusted: true,
    breakdown: [
      {
        championId: 64,
        baseWinRate: 51,
        playerWinRate: 58,
        adjustedWinRate: 55,
        reasons: ['近期胜率 58%', '绝活']
      }
    ]
  }
}

describe('TeamStrengthBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('双方都有分数时渲染对比条与差值文案', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0), enemy: score(50.0) }
    })
    expect(wrapper.find('.lineup-strength').exists()).toBe(true)
    expect(wrapper.text()).toContain('53.0')
    expect(wrapper.text()).toContain('50.0')
    expect(wrapper.text()).toContain('我方领先 3.0')
  })

  it('敌方领先时文案反向', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(48.0), enemy: score(52.4) }
    })
    expect(wrapper.text()).toContain('敌方领先 4.4')
  })

  it('双方接近时文案中性', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(50.0), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('双方阵容接近')
  })

  it('任一方无数据（null）→ 整块隐藏，不渲染', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: EMPTY_LINEUP_SCORE, enemy: score(50.0) }
    })
    expect(wrapper.find('.lineup-strength').exists()).toBe(false)
  })

  it('加权后显示「已按玩家近期画像加权」提示', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: adjustedScore(), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('已按玩家近期画像加权')
  })

  it('未加权时标注数据来源为 OP.GG meta', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('OP.GG 全球 meta')
  })

  it('覆盖度信息：双方 covered/total 都展示', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0, { covered: 3, total: 5 }), enemy: score(50.0, { covered: 4, total: 5 }) }
    })
    expect(wrapper.text()).toContain('3/5')
    expect(wrapper.text()).toContain('4/5')
  })

  it('明细常驻渲染，英雄名来自 getChampionName，调整过的英雄金色标明理由', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: adjustedScore(), enemy: score(50.0, { covered: 1 }) }
    })
    expect(wrapper.text()).toContain('英雄64')
    expect(wrapper.text()).toContain('51.0 → 55.0')
    const row = wrapper.find('.ls-detail-changed')
    expect(row.exists()).toBe(true)
    expect(row.attributes('title')).toContain('近期胜率 58%')
    expect(row.attributes('title')).toContain('绝活')
  })
})