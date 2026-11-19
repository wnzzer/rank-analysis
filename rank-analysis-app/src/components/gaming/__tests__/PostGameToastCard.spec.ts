/**
 * PostGameToastCard：三种状态的内容与按钮、Carry 高光、原画缺失兜底、自动关闭倒计时与悬停暂停。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PostGameToastCard from '../PostGameToastCard.vue'

const base = {
  win: true,
  champion: '疾风剑豪',
  kda: '12/3/7',
  lpText: '+21 LP',
  splashUrl: 'asset://splash/157',
  iconUrl: 'asset://champion/157',
  ttlMs: 25_000
}

function mountCard(props: Record<string, unknown> = {}) {
  return mount(PostGameToastCard, { props: { state: 'revealed', ...base, ...props } as never })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PostGameToastCard', () => {
  it('顶行：胜负、英雄、KDA、LP', () => {
    const w = mountCard()
    const text = w.text()
    expect(text).toContain('胜利')
    expect(text).toContain('疾风剑豪')
    expect(text).toContain('12/3/7')
    expect(text).toContain('+21 LP')
  })

  it('guess：不出现任何 AI 结论，只有十人头像排与「去猜一下」', async () => {
    const w = mountCard({
      state: 'guess',
      label: '被连累',
      headline: '9 次阵亡，本人责任只算 4 次',
      allies: ['a1', 'a2', 'a3', 'a4', 'a5'],
      enemies: ['e1', 'e2', 'e3', 'e4', 'e5']
    })
    expect(w.text()).not.toContain('被连累')
    expect(w.text()).not.toContain('本人责任')
    expect(w.findAll('.pgt-mini')).toHaveLength(10)
    expect(w.find('[data-test="pgt-copy"]').exists()).toBe(false)
    await w.get('[data-test="pgt-guess"]').trigger('click')
    expect(w.emitted('guess')).toHaveLength(1)
  })

  it('revealed：标签、一句人话、事实与复制按钮', async () => {
    const w = mountCard({
      label: '被连累',
      tone: 'vindicate',
      tagline: '输了，但锅不在我',
      headline: '9 次阵亡，本人责任只算 4 次'
    })
    expect(w.get('[data-test="pgt-label"]').text()).toBe('被连累')
    expect(w.get('[data-test="pgt-headline"]').text()).toContain('本人责任只算 4 次')
    expect(w.classes()).toContain('tone-vindicate')
    await w.get('[data-test="pgt-copy"]').trigger('click')
    await w.get('[data-test="pgt-open"]').trigger('click')
    await w.get('[data-test="pgt-close"]').trigger('click')
    expect(w.emitted('copy')).toHaveLength(1)
    expect(w.emitted('open')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('复制按钮文案随状态变化，生成中禁用', () => {
    expect(mountCard({ copyState: 'copied' }).get('[data-test="pgt-copy"]').text()).toContain(
      '已复制'
    )
    const copying = mountCard({ copyState: 'copying' }).get('[data-test="pgt-copy"]')
    expect(copying.attributes('disabled')).toBeDefined()
    expect(mountCard({ copyState: 'failed' }).get('[data-test="pgt-copy"]').text()).toContain(
      '复制失败'
    )
  })

  it('Carry：标签带金色高光样式', () => {
    const w = mountCard({ label: 'Carry', tone: 'brag' })
    expect(w.get('[data-test="pgt-label"]').classes()).toContain('is-carry')
  })

  it('loading：没有主按钮，只能看完整战报', () => {
    const w = mountCard({ state: 'loading' })
    expect(w.find('[data-test="pgt-guess"]').exists()).toBe(false)
    expect(w.find('[data-test="pgt-copy"]').exists()).toBe(false)
    expect(w.find('[data-test="pgt-open"]').exists()).toBe(true)
  })

  it('原画加载失败退回头像兜底', async () => {
    const w = mountCard()
    await w.get('[data-test="pgt-splash"]').trigger('error')
    expect(w.find('[data-test="pgt-splash"]').exists()).toBe(false)
    expect(w.find('.pgt-fallback-icon').attributes('src')).toBe('asset://champion/157')
  })

  it('无交互 ttlMs 后发 expire', () => {
    const w = mountCard()
    vi.advanceTimersByTime(24_999)
    expect(w.emitted('expire')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(w.emitted('expire')).toHaveLength(1)
  })

  it('悬停暂停倒计时，移开后按剩余时长继续', async () => {
    const w = mountCard()
    vi.advanceTimersByTime(20_000)
    await w.trigger('mouseenter')
    expect(w.get('[data-test="pgt-timer"]').attributes('style')).toContain('paused')
    vi.advanceTimersByTime(60_000)
    expect(w.emitted('expire')).toBeUndefined()
    await w.trigger('mouseleave')
    vi.advanceTimersByTime(4_999)
    expect(w.emitted('expire')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(w.emitted('expire')).toHaveLength(1)
  })

  it('ttlMs = 0 不自动关闭、不显示倒计时条', () => {
    const w = mountCard({ ttlMs: 0 })
    vi.advanceTimersByTime(120_000)
    expect(w.emitted('expire')).toBeUndefined()
    expect(w.find('[data-test="pgt-timer"]').exists()).toBe(false)
  })
})
