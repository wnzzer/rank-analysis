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
  saveLabel: vi.fn(),
  getConfig: vi.fn(),
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
vi.mock('@renderer/services/matchLabel', async importOriginal => ({
  ...(await importOriginal<typeof import('@renderer/services/matchLabel')>()),
  getMatchLabel: h.getLabel,
  saveMatchLabel: h.saveLabel,
  currentModelVersion: () => Promise.resolve('test@0')
}))
vi.mock('@renderer/services/ipc', () => ({ getConfigByIpc: h.getConfig }))
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
  h.saveLabel.mockResolvedValue({ uploaded: false })
  h.getConfig.mockResolvedValue(undefined)
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

  it('还没标注：猜测态，不露 AI 结论，十个头像可点', async () => {
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    const me = Object.values(model.value.players).find(p => p.isMe)!
    expect(w.find('[data-test="pgt-label"]').exists()).toBe(false)
    expect(w.get('[data-test="pgt-card"]').text()).not.toContain(me.label)
    expect(w.findAll('.pgt-mini')).toHaveLength(10)
  })

  it('在卡上猜完：就地揭晓并保存标注，不跳主窗口', async () => {
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()
    const me = Object.values(model.value.players).find(p => p.isMe)!

    await w.get('[data-test="pgt-pick-1"]').trigger('click')
    await w.get('[data-test="pgt-pick-6"]').trigger('click')
    await flushPromises()

    expect(w.get('[data-test="pgt-label"]').text()).toBe(me.label)
    expect(w.get('[data-test="pgt-compare"]').text()).toContain('最关键')
    expect(h.openMain).not.toHaveBeenCalled()
    expect(tracked()).toContain('guess')
    expect(h.saveLabel).toHaveBeenCalledTimes(1)
    const [label, share] = h.saveLabel.mock.calls[0]
    expect(label).toMatchObject({
      gameId: gameB().gameId,
      keyPick: { slot: 1 },
      blamePick: { slot: 6 },
      modelVersion: 'test@0'
    })
    // 没决定过是否分享：只存本地
    expect(share).toBe(false)
  })

  it('同意过分享：卡上猜的标注一并上传', async () => {
    h.getConfig.mockResolvedValue(true)
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()

    await w.get('[data-test="pgt-pick-1"]').trigger('click')
    await w.get('[data-test="pgt-pick-6"]').trigger('click')
    await flushPromises()

    expect(h.saveLabel.mock.calls[0][1]).toBe(true)
  })

  it('两项都跳过：照样揭晓，但不保存空标注', async () => {
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()

    await w.get('[data-test="pgt-skip"]').trigger('click')
    await w.get('[data-test="pgt-skip"]').trigger('click')
    await flushPromises()

    expect(w.find('[data-test="pgt-label"]').exists()).toBe(true)
    expect(w.find('[data-test="pgt-compare"]').exists()).toBe(false)
    expect(h.saveLabel).not.toHaveBeenCalled()
  })

  it('保存失败：仍然揭晓', async () => {
    h.saveLabel.mockRejectedValue(new Error('disk full'))
    model.value = modelB()
    const w = mount(PostGameToast)
    await flushPromises()

    await w.get('[data-test="pgt-pick-1"]').trigger('click')
    await w.get('[data-test="pgt-pick-6"]').trigger('click')
    await flushPromises()

    expect(w.find('[data-test="pgt-label"]').exists()).toBe(true)
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
