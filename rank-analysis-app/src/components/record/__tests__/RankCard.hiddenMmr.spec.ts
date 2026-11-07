import { describe, it, expect } from 'vitest'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import RankCard from '../RankCard.vue'
import type { HiddenMmr } from '@renderer/services/hiddenMmr'
import type { QueueInfo } from '@renderer/types/domain/player'

const queueInfo = {
  queueType: 'RANKED_SOLO_5x5',
  queueTypeCn: '单双排',
  division: 'IV',
  tier: 'EMERALD',
  tierCn: '流光翡翠',
  highestDivision: 'IV',
  highestTier: 'EMERALD',
  isProvisional: false,
  leaguePoints: 40,
  losses: 10,
  wins: 12,
  ladderScore: 2105
} as QueueInfo

function mountCard(
  hiddenMmr?: HiddenMmr | null,
  stubs: Record<string, Component> = {},
  info: QueueInfo = queueInfo
) {
  return mount(RankCard, {
    props: {
      label: '单双排',
      queueInfo: info,
      recent: { wins: 6, losses: 4, winRate: 60 },
      hiddenMmr
    },
    global: { plugins: [naive], stubs }
  })
}

/** 让 tooltip 内容常驻渲染，绕开 naive 的 hover 延迟与 teleport */
const openTooltip = { Tooltip: { template: '<div><slot name="trigger" /><slot /></div>' } }

const ready: HiddenMmr = {
  status: 'ready',
  score: 2180,
  equivalent: '流光翡翠 III 80LP',
  offset: 75,
  direction: 'up',
  avgWin: 28,
  avgLoss: 14,
  recent: [
    { delta: 28, source: 'notification' },
    { delta: -14, source: 'notification' },
    { delta: 28, source: 'snapshot' }
  ]
}

describe('RankCard ladder score', () => {
  it('should show ladder score with unit when present', () => {
    const el = mountCard().get('[data-test="ladder-score"]')

    expect(el.text()).toContain('2105')
    expect(el.text()).toContain('分')
  })

  it('should not render ladder score when null or absent', () => {
    expect(
      mountCard(null, {}, { ...queueInfo, ladderScore: null })
        .find('[data-test="ladder-score"]')
        .exists()
    ).toBe(false)
    expect(
      mountCard(null, {}, { ...queueInfo, ladderScore: undefined })
        .find('[data-test="ladder-score"]')
        .exists()
    ).toBe(false)
  })

  it('should render a ladder score even when hidden MMR is absent', () => {
    expect(mountCard(null).find('[data-test="ladder-score"]').exists()).toBe(true)
  })
})

describe('RankCard hidden MMR row', () => {
  it('should show a quiet one-line score with a win-colored arrow when up', () => {
    const row = mountCard(ready).get('[data-test="hidden-mmr"]')

    expect(row.text()).toBe('隐藏分 2180 ↑')
    expect(row.get('.rank-card-mmr-arrow').classes()).toContain('up')
  })

  it('should color the arrow as down and omit it when flat', () => {
    const flat = mountCard({ ...ready, direction: 'flat', offset: 20 }).get(
      '[data-test="hidden-mmr"]'
    )
    const down = mountCard({ ...ready, direction: 'down', offset: -90 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(flat.text()).toBe('隐藏分 2180')
    expect(flat.find('.rank-card-mmr-arrow').exists()).toBe(false)
    expect(down.text()).toBe('隐藏分 2180 ↓')
    expect(down.get('.rank-card-mmr-arrow').classes()).toContain('down')
  })

  it('should show collecting progress', () => {
    const row = mountCard({ status: 'collecting', reason: 'too_few', have: 1, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.text()).toBe('隐藏分 收集中 1/3')
  })

  it('should explain one-sided collecting', () => {
    const row = mountCard({ status: 'collecting', reason: 'one_sided', have: 4, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.text()).toBe('隐藏分 收集中（需有胜有负）')
  })

  it('should render nothing when hidden or absent', () => {
    expect(mountCard({ status: 'hidden' }).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard(null).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard().find('[data-test="hidden-mmr"]').exists()).toBe(false)
  })
})

describe('RankCard hidden MMR tooltip', () => {
  it('should show equivalent, comparison, recent deltas, rules and disclaimer when ready', () => {
    const text = mountCard(ready, openTooltip).text()

    expect(text).toContain('≈ 流光翡翠 III 80LP（2180）')
    expect(text).toContain('比天梯分高 75')
    expect(text).toContain('最近 3 局：+28 / −14 / +28')
    expect(text).toContain('平均赢 +28 / 平均输 −14')
    expect(text).toContain('计算规则')
    expect(text).toContain('估算值，非官方 MMR')
  })

  it('should say lower and equal relative to the ladder score', () => {
    const lower = mountCard({ ...ready, score: 2100 }, openTooltip).text()
    const equal = mountCard({ ...ready, score: 2105 }, openTooltip).text()

    expect(lower).toContain('比天梯分低 5')
    expect(equal).toContain('与天梯分持平')
  })

  it('should skip the comparison when there is no ladder score', () => {
    const text = mountCard(ready, openTooltip, { ...queueInfo, ladderScore: null }).text()

    expect(text).not.toContain('天梯分高')
    expect(text).not.toContain('天梯分低')
    expect(text).not.toContain('与天梯分持平')
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
