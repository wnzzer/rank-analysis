/**
 * ChampionIntelCard 出装面板分路维度测试。
 *
 * 覆盖：
 * - 首载跟随 `myPosition`（会话位置 → getBuildStats 的 position 参数）；
 * - 位置未知/晚到时回落全部分路，数据到达后自然生效；
 * - 手动点分路 chip 后重查且不再跟随位置变动；
 * - 指定分路样本不足后端回退全部分路（position 空串）→ 面板显示降级标注；
 * - 生效分路与请求一致时不显示降级标注。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { BuildStats } from '@renderer/services/builds'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@renderer/composables/useAssetUrl', () => ({
  useAssetUrl: () => ({
    getChampionUrl: () => '',
    getItemUrl: () => '',
    getRuneUrl: () => '',
    getSpellUrl: () => ''
  })
}))
vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: () => '盖伦',
  loadChampionNames: vi.fn(() => Promise.resolve())
}))
vi.mock('@renderer/services/opgg', () => ({
  opggRevision: ref(0),
  getChampionMeta: vi.fn(() => Promise.resolve(null)),
  getLaneCounters: vi.fn(() => Promise.resolve([])),
  findCounterHints: vi.fn(() => [])
}))

import { invoke } from '@tauri-apps/api/core'
import ChampionIntelCard from '../ChampionIntelCard.vue'

const mockInvoke = vi.mocked(invoke)

/** 出装聚合结果：position 由调用方透传，模拟后端「指定分路生效」或「样本不足回退」。 */
function buildWith(position: string): BuildStats {
  return {
    championId: 86,
    position,
    mode: 420,
    samples: 8,
    winCount: 5,
    items: [[{ itemId: 3020, count: 5, winCount: 4 }]],
    runeMain: [{ id: 8100, count: 8, winCount: 5 }],
    runeSub: [{ id: 8400, count: 6, winCount: 4 }],
    keystone: [{ id: 8112, count: 8, winCount: 5 }],
    spells: [
      { spellId: 4, count: 8, winCount: 5 },
      { spellId: 7, count: 8, winCount: 5 }
    ]
  }
}

/** get_build_stats 的 curl：position 透传返回；其余命令一律 null */
function armBuilds(enabled: boolean): void {
  mockInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === 'get_build_stats' && enabled) {
      const position = (args as { position?: string }).position ?? ''
      return buildWith(position)
    }
    return null
  })
}

/** watch 回调的一串 await（loadChampionNames → getBuildStats）落定。 */
async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
}

function card(props: Record<string, unknown> = {}) {
  return mount(ChampionIntelCard, {
    props: {
      championId: 86,
      mode: 'ranked',
      myPuuid: 'me-puuid',
      ...props
    },
    global: {
      stubs: { PatchNoteBadge: true, CounterHover: true }
    }
  })
}

/** 最近一次 get_build_stats 的 position 参数。 */
function lastBuildPosition(): string {
  const call = mockInvoke.mock.calls
    .slice()
    .reverse()
    .find(c => c[0] === 'get_build_stats')
  return (call?.[1] as { position?: string }).position ?? '(no-call)'
}

beforeEach(() => {
  vi.clearAllMocks()
  armBuilds(true)
})

describe('ChampionIntelCard 出装分路', () => {
  it('首载跟随 myPosition（大写化后作为 position 请求）', async () => {
    const w = card({ myPosition: 'top' })
    await flush()
    expect(lastBuildPosition()).toBe('TOP')
    w.unmount()
  })

  it('myPosition 未知或缺失时 position 走全部分路（空串）', async () => {
    const w = card()
    await flush()
    expect(lastBuildPosition()).toBe('')
    w.unmount()
  })

  it('会话位置晚到：初始空串，位置到达后自动跟随重查', async () => {
    const w = card()
    await flush()
    expect(lastBuildPosition()).toBe('')

    await w.setProps({ myPosition: 'jungle' })
    await flush()
    expect(lastBuildPosition()).toBe('JUNGLE')
    w.unmount()
  })

  it('手动点分路 chip：重查并高亮该 chip，不再跟随位置', async () => {
    const w = card({ myPosition: 'top' })
    await flush()
    expect(lastBuildPosition()).toBe('TOP')

    // 展开出装面板 → chips 出现；点「打野」
    await w.find('.intel-build-toggle').trigger('click')
    const chips = w.findAll('.intel-build-chip')
    expect(chips.map(c => c.text())).toEqual(['全部', '上单', '打野', '中单', '下路', '辅助'])
    await chips[2].trigger('click')
    await flush()

    expect(lastBuildPosition()).toBe('JUNGLE')
    expect(w.find('.intel-build-chip-active').text()).toBe('打野')

    // 手动选择后位置变动不再覆盖（跟随已失效）
    await w.setProps({ myPosition: 'bottom' })
    await flush()
    expect(lastBuildPosition()).toBe('JUNGLE')
    w.unmount()
  })

  it('指定分路样本不足回退全部分路：显示降级标注', async () => {
    // 后端对任何指定分路都回退（返回 position 空串）；全部（空串）请求才给数据
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_build_stats') {
        const position = (args as { position?: string }).position ?? ''
        return buildWith(position === '' ? '' : '')
      }
      return null
    })
    const w = card({ myPosition: 'top' })
    await flush()
    await w.find('.intel-build-toggle').trigger('click')
    await flush()

    expect(w.find('.intel-build-degraded').exists()).toBe(true)
    expect(w.find('.intel-build-degraded').text()).toContain('已回退')
    w.unmount()
  })

  it('指定分路生效（返回 position 与请求一致）：不显示降级标注', async () => {
    const w = card({ myPosition: 'top' })
    await flush()
    await w.find('.intel-build-toggle').trigger('click')
    await flush()

    expect(w.find('.intel-build-degraded').exists()).toBe(false)
    w.unmount()
  })
})
