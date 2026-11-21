/**
 * RebuttalReply：三态渲染、立场标签、认账追加语、态度按钮的选中与改选、重试。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MatchLabelRebuttal } from '@renderer/services/matchLabel'
import { REBUTTAL_CONCEDE_SUFFIX } from '@renderer/services/ai/review/rebuttal'
import RebuttalReply from '../RebuttalReply.vue'

function rebuttal(patch: Partial<MatchLabelRebuttal> = {}): MatchLabelRebuttal {
  return {
    stance: 'concede',
    category: 'absence',
    reply: '你说的全程单带不参团，目前的评分确实没算进去。',
    verdict: null,
    model: 'test-model',
    basis: '1|6|他全程单带不参团',
    ...patch
  }
}

const ready = (patch: Partial<MatchLabelRebuttal> = {}) =>
  mount(RebuttalReply, { props: { state: 'ready', rebuttal: rebuttal(patch) } })

describe('RebuttalReply', () => {
  it('should show a waiting hint while loading', () => {
    const w = mount(RebuttalReply, { props: { state: 'loading', rebuttal: null } })

    expect(w.get('[data-test="rebuttal-loading"]').text()).toContain('AI 正在看你的理由')
    expect(w.find('[data-test="rebuttal-text"]').exists()).toBe(false)
  })

  it('should offer a retry when the call failed', async () => {
    const w = mount(RebuttalReply, { props: { state: 'failed', rebuttal: null } })

    expect(w.get('[data-test="rebuttal-failed"]').text()).toContain('AI 暂时没回应')
    await w.get('[data-test="rebuttal-retry"]').trigger('click')

    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('should show the reply text', () => {
    expect(ready().get('[data-test="rebuttal-text"]').text()).toBe(
      '你说的全程单带不参团，目前的评分确实没算进去。'
    )
  })

  it.each([
    ['concede', '你说得对'],
    ['partial', '有一部分道理'],
    ['hold', '我还是这么看']
  ] as const)('should label the %s stance', (stance, text) => {
    const tag = ready({ stance }).get('[data-test="rebuttal-stance"]')

    expect(tag.text()).toBe(text)
    expect(tag.classes()).toContain(`stance-${stance}`)
  })

  it('should hide the stance label for a fallback reply', () => {
    expect(ready({ stance: 'unknown' }).find('[data-test="rebuttal-stance"]').exists()).toBe(false)
  })

  it('should tell the player the point was recorded when the AI concedes', () => {
    for (const stance of ['concede', 'partial'] as const) {
      expect(ready({ stance }).get('[data-test="rebuttal-noted"]').text()).toBe(
        REBUTTAL_CONCEDE_SUFFIX
      )
    }
  })

  it('should not claim the point was recorded when the AI holds its view', () => {
    for (const stance of ['hold', 'unknown'] as const) {
      expect(ready({ stance }).find('[data-test="rebuttal-noted"]').exists()).toBe(false)
    }
  })

  it('should emit the verdict the player clicked', async () => {
    const w = ready()

    await w.get('[data-test="rebuttal-unconvinced"]').trigger('click')
    await w.get('[data-test="rebuttal-convinced"]').trigger('click')

    expect(w.emitted('verdict')).toEqual([['unconvinced'], ['convinced']])
  })

  it('should mark the chosen verdict and still allow switching', () => {
    const w = ready({ verdict: 'unconvinced' })
    const picked = w.get('[data-test="rebuttal-unconvinced"]')
    const other = w.get('[data-test="rebuttal-convinced"]')

    expect(picked.classes()).toContain('is-picked')
    expect(picked.attributes('aria-pressed')).toBe('true')
    expect(other.classes()).not.toContain('is-picked')
    expect(other.attributes('disabled')).toBeUndefined()
  })
})
