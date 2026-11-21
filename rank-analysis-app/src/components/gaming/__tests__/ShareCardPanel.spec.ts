/**
 * ShareCardPanel：按标签分级展开、打点漏斗、复制成功 / 失败提示、隐藏名字、换个角度。
 * 视图模型用入库回归局 B（本人 pid 9），通过改本人标签模拟不同分级。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReviewModel } from '@renderer/services/ai/review/buildReviewModel'
import type { VerdictLabel } from '@renderer/services/ai/matchDetail/types'
import { modelB } from '@renderer/components/record/review/__tests__/fixtureModels'
import ShareCardPanel from '../ShareCardPanel.vue'

const svc = vi.hoisted(() => ({
  copy: vi.fn(),
  track: vi.fn(),
  toDataUrl: vi.fn()
}))

vi.mock('@renderer/services/shareCard', () => ({
  copyCardImage: svc.copy,
  trackShareCard: svc.track,
  toDataUrl: svc.toDataUrl
}))

const base = modelB()
const ME = 9

function withLabel(label: VerdictLabel): ReviewModel {
  return {
    ...base,
    players: { ...base.players, [ME]: { ...base.players[ME], label } }
  }
}

function mountPanel(label: VerdictLabel) {
  return mount(ShareCardPanel, { props: { model: withLabel(label), meta: ['37:12', '-18 LP'] } })
}

const tracked = () => svc.track.mock.calls.map(c => c[0])

beforeEach(() => {
  svc.copy.mockReset().mockResolvedValue(undefined)
  svc.track.mockReset()
  svc.toDataUrl.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
})

describe('ShareCardPanel', () => {
  it('被连累（primary）：直接展开卡片并打一次 shown', async () => {
    const w = mountPanel('被连累')
    await flushPromises()
    expect(w.find('[data-test="share-card"]').exists()).toBe(true)
    expect(w.text()).toContain('输了，但锅不在我')
    expect(w.findAll('.sc-chip').map(c => c.text())).toEqual(['37:12', '-18 LP'])
    expect(tracked()).toEqual(['shown'])
  })

  it('正常（secondary）：先收起，点「生成战报图」才展开并打 shown', async () => {
    const w = mountPanel('正常')
    await flushPromises()
    expect(w.find('[data-test="share-card"]').exists()).toBe(false)
    expect(tracked()).toEqual([])
    await w.get('[data-test="share-open"]').trigger('click')
    expect(w.find('[data-test="share-card"]').exists()).toBe(true)
    expect(tracked()).toEqual(['shown'])
  })

  it('犯罪（opt-in）：只给自嘲入口，点开打 self_roast + shown，卡上只有负面事实', async () => {
    const w = mountPanel('犯罪')
    await flushPromises()
    expect(w.find('[data-test="share-open"]').exists()).toBe(false)
    await w.get('[data-test="share-open-roast"]').trigger('click')
    expect(tracked()).toEqual(['self_roast', 'shown'])
    expect(w.get('[data-test="share-card-headline"]').text()).toBe('KDA 队内第 1，评分队内第 5')
  })

  it('换个角度：标题在候选事实之间轮换，并打 angle', async () => {
    const w = mountPanel('犯罪')
    await flushPromises()
    await w.get('[data-test="share-open-roast"]').trigger('click')
    const headline = () => w.get('[data-test="share-card-headline"]').text()
    const first = headline()
    await w.get('[data-test="share-angle"]').trigger('click')
    expect(headline()).not.toBe(first)
    expect(tracked()).toContain('angle')
  })

  it('隐藏名字：卡上不再出现召唤师名', async () => {
    const w = mountPanel('被连累')
    await flushPromises()
    expect(w.find('[data-test="share-card-name"]').exists()).toBe(true)
    await w.get('[data-test="share-hide-name"]').trigger('click')
    expect(w.find('[data-test="share-card-name"]').exists()).toBe(false)
  })

  it('复制成功：把卡片节点交给导出，提示粘贴并打 copied', async () => {
    const w = mountPanel('被连累')
    await flushPromises()
    await w.get('[data-test="share-copy"]').trigger('click')
    await flushPromises()
    expect(svc.copy).toHaveBeenCalledTimes(1)
    expect((svc.copy.mock.calls[0][0] as HTMLElement).dataset.test).toBe('share-card')
    expect(w.get('[data-test="share-status"]').text()).toMatch(/^已复制，去群里 (Ctrl\+V|⌘V) 粘贴$/)
    expect(tracked()).toContain('copied')
  })

  it('复制失败：提示错误，不打 copied', async () => {
    svc.copy.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mountPanel('被连累')
    await flushPromises()
    await w.get('[data-test="share-copy"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="share-status"]').text()).toContain('复制失败')
    expect(tracked()).not.toContain('copied')
  })

  it('头像与原画都转 data URL 后画进卡片；转换失败不画', async () => {
    const w = mountPanel('被连累')
    await flushPromises()
    expect(w.find('.sc-icon').attributes('src')).toBe('data:image/png;base64,AAAA')
    expect(w.find('[data-test="share-card-splash"]').attributes('src')).toBe(
      'data:image/png;base64,AAAA'
    )
    const urls = svc.toDataUrl.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.includes('/champion/'))).toBe(true)
    expect(urls.some(u => u.includes('/splash/'))).toBe(true)

    svc.toDataUrl.mockResolvedValue(null)
    const w2 = mountPanel('被连累')
    await flushPromises()
    expect(w2.find('.sc-icon').exists()).toBe(false)
    expect(w2.find('[data-test="share-card-splash"]').exists()).toBe(false)
  })
})
