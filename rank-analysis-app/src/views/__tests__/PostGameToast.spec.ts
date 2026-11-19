/**
 * PostGameToast（弹卡窗口）：模型就绪才亮窗、重开局 / 构建失败直接关、先猜再揭晓、
 * 复制走离屏战报图并在成功后关闭、各按钮打点。视图模型用入库回归局 B（本人 pid 9）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import type { ReviewModel } from '@renderer/services/ai/review/buildReviewModel'
import { gameB, modelB } from '@renderer/components/record/review/__tests__/fixtureModels'
import PostGameToast from '../PostGameToast.vue'

const h = vi.hoisted(() => ({
  show: vi.fn(),
  close: vi.fn(),
  openMain: vi.fn(),
  track: vi.fn(),
  getLabel: vi.fn(),
  copy: vi.fn(),
  toDataUrl: vi.fn()
}))

const model = shallowRef<ReviewModel | null>(null)
const isRemake = ref(false)
const failed = ref(false)

vi.mock('@renderer/composables/useReviewModel', () => ({
  useReviewModel: () => ({ model, isRemake, failed })
}))
vi.mock('@renderer/composables/usePostGameReport', async importOriginal => ({
  ...(await importOriginal<typeof import('@renderer/composables/usePostGameReport')>()),
  loadEndedGameReport: () => ({
    report: ref({ game: gameB(), lpDelta: -18, mmr: null }),
    loading: ref(false)
  })
}))
vi.mock('@renderer/services/matchLabel', () => ({ getMatchLabel: h.getLabel }))
vi.mock('@renderer/services/shareCard', () => ({
  copyCardImage: h.copy,
  toDataUrl: h.toDataUrl
}))
vi.mock('@renderer/services/postGameToast', async importOriginal => ({
  ...(await importOriginal<typeof import('@renderer/services/postGameToast')>()),
  showToastWindow: h.show,
  closeToastWindow: h.close,
  openMainFromToast: h.openMain,
  trackPostGameToast: h.track
}))

const tracked = () => h.track.mock.calls.map(c => c[0])

beforeEach(() => {
  vi.useFakeTimers()
  Object.values(h).forEach(f => f.mockReset())
  h.getLabel.mockResolvedValue(null)
  h.copy.mockResolvedValue(undefined)
  h.toDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
  model.value = null
  isRemake.value = false
  failed.value = false
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PostGameToast', () => {
  it('复盘模型就绪前不亮窗，就绪后亮一次并打 shown', async () => {
    const w = mount(PostGameToast)
    await flushPromises()
    expect(h.show).not.toHaveBeenCalled()
    expect(w.find('[data-test="pgt-card"]').exists()).toBe(false)

    model.value = modelB()
    await flushPromises()
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(tracked()).toEqual(['shown'])

    model.value = modelB({ timeline: false })
    await flushPromises()
    expect(h.show).toHaveBeenCalledTimes(1)
  })

  it('重开局 / 模型构建失败：不亮窗直接关', async () => {
    isRemake.value = true
    mount(PostGameToast)
    await flushPromises()
    expect(h.close).toHaveBeenCalled()
    expect(h.show).not.toHaveBeenCalled()

    h.close.mockReset()
    isRemake.value = false
    failed.value = true
    mount(PostGameToast)
    await flushPromises()
    expect(h.close).toHaveBeenCalled()
  })

  it('一直没有模型：放弃时间到后静默关闭', async () => {
    mount(PostGameToast)
    await flushPromises()
    vi.advanceTimersByTime(90_000)
    expect(h.close).toHaveBeenCalled()
    expect(h.show).not.toHaveBeenCalled()
  })

  it('还没标注：猜测态，不露 AI 结论；点「去猜一下」跳主窗口', async () => {
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    const me = Object.values(model.value.players).find(p => p.isMe)!
    expect(w.find('[data-test="pgt-guess"]').exists()).toBe(true)
    expect(w.find('[data-test="pgt-label"]').exists()).toBe(false)
    expect(w.get('[data-test="pgt-card"]').text()).not.toContain(me.label)
    expect(w.findAll('.pgt-mini')).toHaveLength(10)

    await w.get('[data-test="pgt-guess"]').trigger('click')
    expect(h.openMain).toHaveBeenCalledTimes(1)
    expect(tracked()).toContain('guess')
  })

  it('已标注：直接揭晓标签与事实', async () => {
    h.getLabel.mockResolvedValue({ gameId: 1 })
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    const me = Object.values(model.value.players).find(p => p.isMe)!
    expect(w.get('[data-test="pgt-label"]').text()).toBe(me.label)
    expect(w.find('[data-test="pgt-copy"]').exists()).toBe(true)
  })

  it('无国服基准（没有标注卡）：直接揭晓', async () => {
    model.value = { ...modelB(), hasBaseline: false }
    const w = mount(PostGameToast)
    await flushPromises()
    expect(w.find('[data-test="pgt-copy"]').exists()).toBe(true)
  })

  it('复制：图片转 data URL 画进离屏战报图（隐藏名字），成功后打点并稍后关闭', async () => {
    h.getLabel.mockResolvedValue({ gameId: 1 })
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()

    await w.get('[data-test="pgt-copy"]').trigger('click')
    await flushPromises()
    expect(h.copy).toHaveBeenCalledTimes(1)
    const el = h.copy.mock.calls[0][0] as HTMLElement
    expect(el.querySelector('[data-test="share-card-splash"]')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    )
    expect(el.querySelector('[data-test="share-card-name"]')).toBeNull()
    expect(tracked()).toContain('copied')
    expect(w.get('[data-test="pgt-copy"]').text()).toContain('已复制')

    expect(h.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(h.close).toHaveBeenCalled()
  })

  it('复制失败：提示可重试，不打 copied、不关闭', async () => {
    h.getLabel.mockResolvedValue({ gameId: 1 })
    h.copy.mockRejectedValue(new Error('clipboard'))
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    await w.get('[data-test="pgt-copy"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="pgt-copy"]').text()).toContain('复制失败')
    expect(tracked()).not.toContain('copied')
    vi.advanceTimersByTime(5000)
    expect(h.close).not.toHaveBeenCalled()
  })

  it('关闭 / 超时 / 看完整战报 分别打点', async () => {
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    await w.get('[data-test="pgt-open"]').trigger('click')
    expect(h.openMain).toHaveBeenCalled()
    await w.get('[data-test="pgt-close"]').trigger('click')
    vi.advanceTimersByTime(25_000)
    expect(tracked()).toEqual(expect.arrayContaining(['open', 'closed', 'expired']))
  })
})
