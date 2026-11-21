/**
 * RebuttalReply：三态渲染、立场标签、态度按钮的选中与改选、重试，
 * 以及「反馈去向」一栏按真实上传状态显示。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MatchLabelRebuttal } from '@renderer/services/matchLabel'
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

const ready = (
  patch: Partial<MatchLabelRebuttal> = {},
  extra: { feedback?: 'uploaded' | 'local' | 'failed'; sharing?: boolean } = {}
) => mount(RebuttalReply, { props: { state: 'ready', rebuttal: rebuttal(patch), ...extra } })

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

  it('should show the stance label when the AI concedes', () => {
    const tag = ready({ stance: 'concede' }).get('[data-test="rebuttal-stance"]')

    expect(tag.text()).toBe('你说得对')
    expect(tag.classes()).toContain('stance-concede')
  })

  it.each(['partial', 'hold', 'unknown'] as const)(
    'should not show a stance label for %s',
    stance => {
      // 正文永远站在玩家这边，「有一部分道理」「我还是这么看」摆在上面是自相矛盾的
      expect(ready({ stance }).find('[data-test="rebuttal-stance"]').exists()).toBe(false)
    }
  )

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

describe('RebuttalReply · 反馈去向', () => {
  it('should confirm the upload only when it really happened', () => {
    const w = ready({}, { feedback: 'uploaded' })

    expect(w.get('[data-test="rebuttal-feedback"]').text()).toContain('已反馈成功')
    expect(w.find('[data-test="rebuttal-share"]').exists()).toBe(false)
  })

  it('should say what was uploaded and why it matters', () => {
    const text = (patch: Partial<MatchLabelRebuttal>) =>
      ready(patch, { feedback: 'uploaded' }).get('[data-test="rebuttal-uploaded"]').text()

    expect(text({ stance: 'concede' })).toBe('评分漏算的这一点已上传，会用来改进评分。')
    expect(text({ stance: 'partial' })).toBe('评分漏算的这一点已上传，会用来改进评分。')
    expect(text({ stance: 'hold' })).toBe('你的看法已上传，会用来改进评分。')
    // 不服的那条最有用：优先说这个，不管 AI 是什么立场
    expect(text({ stance: 'concede', verdict: 'unconvinced' })).toBe(
      '你不服的这条已上传。这类反馈对改进评分最有用。'
    )
  })

  it('should be honest that the feedback is only on this computer when not shared', () => {
    const w = ready({}, { feedback: 'local' })

    expect(w.get('[data-test="rebuttal-not-uploaded"]').text()).toBe('这条反馈还只存在你的电脑上。')
    expect(w.text()).not.toContain('已反馈成功')
    expect(w.text()).not.toContain('已上传')
    // 上传前说清楚传什么、以及这等于打开了分享开关
    expect(w.text()).toContain('不含召唤师名')
    expect(w.text()).toContain('可在设置里关闭')
  })

  it('should default to not uploaded', () => {
    expect(ready().find('[data-test="rebuttal-not-uploaded"]').exists()).toBe(true)
  })

  it('should let the player choose to upload', async () => {
    const w = ready({}, { feedback: 'local' })
    const btn = w.get('[data-test="rebuttal-share"]')

    expect(btn.text()).toBe('上传反馈，帮忙改进评分')
    await btn.trigger('click')

    expect(w.emitted('share')).toHaveLength(1)
  })

  it('should show progress and block repeat clicks while uploading', () => {
    const btn = ready({}, { feedback: 'local', sharing: true }).get('[data-test="rebuttal-share"]')

    expect(btn.text()).toBe('上传中…')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('should admit a failed upload and offer a retry', async () => {
    const w = ready({}, { feedback: 'failed' })

    expect(w.get('[data-test="rebuttal-not-uploaded"]').text()).toContain('上传没成功')
    expect(w.text()).not.toContain('已反馈成功')
    const btn = w.get('[data-test="rebuttal-share"]')
    expect(btn.text()).toBe('重试上传')
    await btn.trigger('click')

    expect(w.emitted('share')).toHaveLength(1)
  })
})
