/**
 * useReviewModel：渐进装配（先无时间线模型、后整体替换）、拉取失败降级、重开局短路、
 * 不支持的地图不拉时间线、换对局作废旧请求、构建抛错。
 *
 * @module composables/useReviewModel
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import type { Game } from '@renderer/types/domain/match'
import type { SlimTimeline } from '@renderer/services/ai/shared/timeline/types'
import b from '@renderer/services/ai/shared/scoring/__tests__/fixtures/regression-b.json'

const fetchMock = vi.fn()
// 不用 importOriginal：在 vi.mock 工厂里回取原模块会让本文件收集阶段挂起
vi.mock('@renderer/services/ai/champion-names', () => ({
  loadChampionNames: vi.fn(() => Promise.resolve()),
  getChampionName: (id: number) => `英雄${id}`
}))
vi.mock('@renderer/services/ai/shared/timeline/fetch', () => ({
  supportsTimeline: (g: Game) => g.mapId === 11 || g.mapId === 12,
  fetchMatchTimeline: (...a: unknown[]) => fetchMock(...a)
}))

import { buildPuuidMap, remapTimeline } from '@renderer/services/ai/shared/timeline/remap'
import { useReviewModel } from './useReviewModel'

const fx = b as unknown as { game: Game; slim: SlimTimeline }
const TIMELINE = remapTimeline(fx.slim, buildPuuidMap(fx.game))

function setup(initial: Game | null) {
  const game = shallowRef<Game | null>(initial)
  let result!: ReturnType<typeof useReviewModel>
  const Wrapper = defineComponent({
    setup() {
      result = useReviewModel(game)
      return () => null
    }
  })
  const wrapper = mount(Wrapper)
  return { game, result, unmount: () => wrapper.unmount() }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await nextTick()
}

/** 可由测试手动 resolve 的时间线请求 */
function deferredFetch() {
  let resolve!: (v: { timeline: SlimTimeline | null; status: string }) => void
  fetchMock.mockImplementation(() => new Promise(r => (resolve = r)))
  return (v: { timeline: SlimTimeline | null; status: string }) => resolve(v)
}

describe('useReviewModel', () => {
  // 必须用块体：mockReset() 返回 mock 本身，箭头直接返回会被 vitest 当成清理函数调用并等待
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('先给无时间线模型（图表骨架），时间线到达后整体替换', async () => {
    const resolve = deferredFetch()
    const { result, unmount } = setup(fx.game)
    await flush()
    expect(result.model.value?.hasTimeline).toBe(false)
    expect(result.timelinePending.value).toBe(true)

    resolve({ timeline: TIMELINE, status: 'ok' })
    await flush()
    expect(result.model.value?.hasTimeline).toBe(true)
    expect(result.timelinePending.value).toBe(false)
    expect(result.timelineStatus.value).toBe('ok')
    unmount()
  })

  it('时间线不可用：保留无时间线模型，状态 unavailable', async () => {
    fetchMock.mockResolvedValue({ timeline: null, status: 'unavailable' })
    const { result, unmount } = setup(fx.game)
    await flush()
    expect(result.model.value?.hasTimeline).toBe(false)
    expect(result.timelineStatus.value).toBe('unavailable')
    expect(result.timelinePending.value).toBe(false)
    unmount()
  })

  it('重开局：不装配也不拉时间线', async () => {
    const { result, unmount } = setup({ ...fx.game, gameDuration: 200 })
    await flush()
    expect(result.isRemake.value).toBe(true)
    expect(result.model.value).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    unmount()
  })

  it('不支持时间线的地图（斗魂竞技场 30）：不拉，状态 unavailable（disabled 只表示用户关了开关）', async () => {
    const { result, unmount } = setup({ ...fx.game, mapId: 30, queueId: 1700, gameMode: 'CHERRY' })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.timelineStatus.value).toBe('unavailable')
    expect(result.model.value?.hasBaseline).toBe(false)
    unmount()
  })

  it('换对局：旧时间线迟到不覆盖新对局', async () => {
    const resolveOld = deferredFetch()
    const { game, result, unmount } = setup(fx.game)
    await flush()
    fetchMock.mockResolvedValue({ timeline: null, status: 'unavailable' })
    game.value = { ...fx.game, gameId: 999 }
    await flush()
    resolveOld({ timeline: TIMELINE, status: 'ok' })
    await flush()
    expect(result.model.value?.hasTimeline).toBe(false)
    expect(result.timelineStatus.value).toBe('unavailable')
    unmount()
  })

  it('构建抛错：failed = true', async () => {
    fetchMock.mockResolvedValue({ timeline: null, status: 'unavailable' })
    const broken = { ...fx.game, gameDetail: undefined, participants: null } as unknown as Game
    const { result, unmount } = setup(broken)
    await flush()
    expect(result.failed.value).toBe(true)
    expect(result.model.value).toBeNull()
    unmount()
  })
})
