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
  tier: 'DIAMOND',
  tierCn: '璀璨钻石',
  highestDivision: 'IV',
  highestTier: 'DIAMOND',
  isProvisional: false,
  leaguePoints: 40,
  losses: 10,
  wins: 12
} as QueueInfo

function mountCard(hiddenMmr?: HiddenMmr | null, stubs: Record<string, Component> = {}) {
  return mount(RankCard, {
    props: { label: '单双排', queueInfo, recent: { wins: 6, losses: 4, winRate: 60 }, hiddenMmr },
    global: { plugins: [naive], stubs }
  })
}

/** 让 tooltip 内容常驻渲染，绕开 naive 的 hover 延迟与 teleport */
const openTooltip = { Tooltip: { template: '<div><slot name="trigger" /><slot /></div>' } }

const ready: HiddenMmr = {
  status: 'ready',
  score: 2580,
  equivalent: '璀璨钻石 III 80LP',
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

describe('RankCard hidden MMR row', () => {
  it('should show equivalent rank and score when ready', () => {
    const row = mountCard(ready).get('[data-test="hidden-mmr"]')

    expect(row.text()).toContain('隐藏分 ≈ 璀璨钻石 III 80LP')
    expect(row.text()).toContain('2580')
    expect(row.text()).toContain('↑')
    expect(row.classes()).toContain('good')
  })

  it('should show recent deltas, averages and the disclaimer in the tooltip', () => {
    const text = mountCard(ready, openTooltip).text()

    expect(text).toContain('最近 3 局：+28 / −14 / +28')
    expect(text).toContain('平均赢 +28 / 平均输 −14，偏移 +140')
    expect(text).toContain('估算值，非官方 MMR')
  })

  it('should mark flat and down directions', () => {
    const flat = mountCard({ ...ready, direction: 'flat', offset: 20 }).get(
      '[data-test="hidden-mmr"]'
    )
    const down = mountCard({ ...ready, direction: 'down', offset: -90 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(flat.text()).toContain('持平')
    expect(flat.classes()).toContain('normal')
    expect(down.text()).toContain('↓')
    expect(down.classes()).toContain('bad')
  })

  it('should show collecting progress', () => {
    const row = mountCard({ status: 'collecting', reason: 'too_few', have: 1, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.text()).toBe('隐藏分 数据收集中 1/3')
    expect(row.classes()).toContain('muted')
  })

  it('should explain one-sided collecting', () => {
    const row = mountCard({ status: 'collecting', reason: 'one_sided', have: 4, need: 3 }).get(
      '[data-test="hidden-mmr"]'
    )

    expect(row.text()).toBe('隐藏分 数据收集中（需至少 1 胜 1 负）')
  })

  it('should render nothing when hidden or absent', () => {
    expect(mountCard({ status: 'hidden' }).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard(null).find('[data-test="hidden-mmr"]').exists()).toBe(false)
    expect(mountCard().find('[data-test="hidden-mmr"]').exists()).toBe(false)
  })
})
