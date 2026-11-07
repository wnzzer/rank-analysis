import { describe, it, expect } from 'vitest'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import RankCard from '../RankCard.vue'
import type { HiddenMmr } from '@renderer/services/hiddenMmr'
import type { QueueInfo } from '@renderer/types/domain/player'
import { tierImage } from '@renderer/utils/tier-image'

const queueInfo = {
  queueType: 'RANKED_SOLO_5x5',
  queueTypeCn: '单双排',
  division: 'IV',
  tier: 'DIAMOND',
  tierCn: '璀璨钻石',
  highestDivision: 'IV',
  highestTier: 'DIAMOND',
  isProvisional: false,
  leaguePoints: 40,
  losses: 10,
  wins: 12
} as QueueInfo

const emeraldInfo = {
  ...queueInfo,
  tier: 'EMERALD',
  tierCn: '流光翡翠',
  division: 'III',
  leaguePoints: 24
} as QueueInfo

function mountCard(
  hiddenMmr?: HiddenMmr | null,
  stubs: Record<string, Component> = {},
  info: QueueInfo = emeraldInfo,
  extra: { recent?: { wins: number; losses: number; winRate: number }; loading?: boolean } = {}
) {
  return mount(RankCard, {
    props: {
      label: '单双排',
      queueInfo: info,
      recent: extra.recent ?? { wins: 28, losses: 22, winRate: 56 },
      loading: extra.loading,
      hiddenMmr
    },
    global: { plugins: [naive], stubs }
  })
}

/** 让 tooltip 内容常驻渲染，绕开 naive 的 hover 延迟与 teleport */
const openTooltip = { Tooltip: { template: '<div><slot name="trigger" /><slot /></div>' } }

const ready: HiddenMmr = {
  status: 'ready',
  score: 2580,
  equivalent: '流光翡翠 III 99LP',
  equivalentShort: '翡翠 III 99LP',
  equivalentTier: 'EMERALD',
  offset: 140,
  direction: 'up',
  avgWin: 28,
  avgLoss: 14,
  recent: [
    { delta: 28, source: 'notification' },
    { delta: -14, source: 'notification' },
    { delta: 28, source: 'snapshot' }
  ]
}

describe('RankCard tier ring and text', () => {
  it('should show ring, LP under the ring, tier text and record line', () => {
    const wrapper = mountCard()

    expect(wrapper.find('[data-test="tier-ring"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="tier-lp"]').text()).toBe('24 LP')
    expect(wrapper.get('.rank-card-tier-text').text()).toBe('流光翡翠 III')
    const record = wrapper.get('[data-test="recent-record"]').text()
    expect(record).toContain('56%')
    expect(record).toContain('28胜22负')
    expect(wrapper.get('[data-test="tier-progress"]').attributes('data-progress')).toBe('0.24')
  })

  it('should show a full arc and tier name only for master and above', () => {
    const wrapper = mountCard(
      null,
      {},
      {
        ...emeraldInfo,
        tier: 'MASTER',
        tierCn: '超凡大师',
        division: 'NA',
        leaguePoints: 233
      }
    )

    expect(wrapper.get('.rank-card-tier-text').text()).toBe('超凡大师')
    expect(wrapper.get('[data-test="tier-lp"]').text()).toBe('233 LP')
    expect(wrapper.get('[data-test="tier-progress"]').attributes('data-progress')).toBe('1')
  })

  it('should show no LP and no progress arc when unranked', () => {
    for (const tier of ['', 'UNRANKED']) {
      const wrapper = mountCard(null, {}, { ...emeraldInfo, tier })

      expect(wrapper.get('.rank-card-tier-text').text()).toBe('无段位')
      expect(wrapper.find('[data-test="tier-lp"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="tier-progress"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="tier-ring"]').exists()).toBe(true)
    }
  })

  it('should show a minimum progress arc at 0 LP', () => {
    const wrapper = mountCard(null, {}, { ...emeraldInfo, leaguePoints: 0 })

    expect(wrapper.get('[data-test="tier-progress"]').attributes('data-progress')).toBe('0.02')
  })

  it('should show a placeholder when there are no recent games', () => {
    const text = mountCard(null, {}, emeraldInfo, {
      recent: { wins: 0, losses: 0, winRate: 0 }
    })
      .get('[data-test="recent-record"]')
      .text()

    expect(text).toBe('暂无对局')
  })

  it('should color the win rate by threshold', () => {
    const rate = (winRate: number) =>
      mountCard(null, {}, emeraldInfo, { recent: { wins: 6, losses: 4, winRate } }).get(
        '[data-test="recent-record"] .wr'
      )

    expect(rate(60).classes()).toContain('good')
    expect(rate(45).classes()).toContain('bad')
    expect(rate(52).classes()).toContain('normal')
  })

  it('should explain the recent record in a tooltip', () => {
    const text = mountCard(null, openTooltip).text()

    expect(text).toContain('近期 50 场：28 胜 22 负，胜率 56%')
  })

  it('should render a skeleton without the ring while loading', () => {
    const wrapper = mountCard(null, {}, emeraldInfo, { loading: true })

    expect(wrapper.find('.sk').exists()).toBe(true)
    expect(wrapper.find('[data-test="tier-ring"]').exists()).toBe(false)
  })
})

describe('RankCard hidden MMR row', () => {
  it('should show label, short rank, tier emblem and up trend icon without score or offset', () => {
    const row = mountCard(ready).get('[data-test="hidden-mmr"]')

    expect(row.text()).toContain('隐藏分')
    expect(row.text()).toContain('翡翠 III 99LP')
    expect(row.text()).not.toContain('2580')
    expect(row.text()).not.toContain('140')
    expect(row.get('[data-test="hidden-mmr-tier"]').attributes('src')).toBe(tierImage('EMERALD'))
    expect(row.find('.rank-card-mmr-trend.up').exists()).toBe(true)
  })

  it('should use down and flat trend icons', () => {
    const down = mountCard({ ...ready, direction: 'down', offset: -90 }).get(
      '[data-test="hidden-mmr"]'
    )
    const flat = mountCard({ ...ready, direction: 'flat', offset: 20 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(down.find('.rank-card-mmr-trend.down').exists()).toBe(true)
    expect(flat.find('.rank-card-mmr-trend.flat').exists()).toBe(true)
    expect(down.text()).not.toMatch(/[↑↓]/)
  })

  it('should show collecting progress dots and text', () => {
    const row = mountCard({ status: 'collecting', reason: 'too_few', have: 2, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.text()).toContain('隐藏分')
    expect(row.text()).toContain('记录中')
    expect(row.findAll('.rank-card-mmr-dot')).toHaveLength(3)
    expect(row.findAll('.rank-card-mmr-dot.filled')).toHaveLength(2)
    expect(row.find('[data-test="hidden-mmr-tier"]').exists()).toBe(false)
  })

  it('should fill every dot when one-sided', () => {
    const row = mountCard({ status: 'collecting', reason: 'one_sided', have: 4, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.findAll('.rank-card-mmr-dot')).toHaveLength(3)
    expect(row.findAll('.rank-card-mmr-dot.filled')).toHaveLength(3)
  })

  it('should render nothing when hidden or absent', () => {
    expect(mountCard({ status: 'hidden' }).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard(null).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard().find('[data-test="hidden-mmr"]').exists()).toBe(false)
  })
})

describe('RankCard hidden MMR tooltip', () => {
  it('should show comparison in LP, recent deltas, rules and disclaimer when ready', () => {
    const text = mountCard(ready, openTooltip).text()

    expect(text).toContain('≈ 流光翡翠 III 99LP，比当前段位高 140 LP')
    expect(text).toContain('最近 3 局：+28 / −14 / +28')
    expect(text).toContain('平均赢 +28 / 平均输 −14')
    expect(text).toContain('计算规则')
    expect(text).toContain('估算值，非官方 MMR')
    expect(text).not.toContain('2580')
    expect(text).not.toContain('天梯分')
  })

  it('should say lower and equal relative to the current tier', () => {
    const lower = mountCard({ ...ready, direction: 'down', offset: -35 }, openTooltip).text()
    const equal = mountCard({ ...ready, direction: 'flat', offset: 0 }, openTooltip).text()

    expect(lower).toContain('比当前段位低 35 LP')
    expect(equal).toContain('与当前段位持平')
  })

  it('should show progress hint and rules when collecting', () => {
    const text = mountCard(
      { status: 'collecting', reason: 'too_few', have: 1, need: 3 },
      openTooltip
    ).text()

    expect(text).toContain('已记录 1 局有效排位，至少需要 3 局且有胜有负')
    expect(text).toContain('计算规则')
    expect(text).toContain('估算值，非官方 MMR')
  })
})
