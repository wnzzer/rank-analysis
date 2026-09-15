import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import BuildRecommendBar from '../BuildRecommendBar.vue'
import type { ChampionBuild, RuneBuild } from '@renderer/types/championBuild'

/** 符文 / 符文系名字：真实数据来自 LCU perks.json / perkstyles.json */
const NAMES: Record<number, string> = { 8000: '精密', 8008: '致命节奏', 8400: '坚决' }

const preloadSpy = vi.hoisted(() => vi.fn())

vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({
    preload: preloadSpy,
    detailOf: (_kind: string, id: number) =>
      NAMES[id] ? { id, name: NAMES[id], description: '' } : null,
    srcOf: (kind: string, id: number) => `/${kind}/${id}`
  })
}))

function rune(overrides: Partial<RuneBuild> = {}): RuneBuild {
  return {
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [8008, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    play: 24385,
    win: 11314,
    pick_rate: 0.3229,
    ...overrides
  }
}

function build(overrides: Partial<ChampionBuild> = {}): ChampionBuild {
  return {
    schema_version: 1,
    champion_id: 157,
    position: 'middle',
    mode: 'ranked',
    tier: 'emerald_plus',
    patch: '16.18',
    fetched_at: 0,
    play: 77441,
    win_rate: 0.49,
    runes: [rune()],
    spells: [],
    starter_items: [],
    boots: [],
    core_items: [{ ids: [3153, 6673, 3031], play: 7603, win: 4157, pick_rate: 0.1661 }],
    last_items: [],
    skills: [],
    stale: false,
    ...overrides
  }
}

const mountBar = (props: {
  build: ChampionBuild | null
  loading: boolean
  applyState?: 'idle' | 'applying' | 'applied' | 'failed'
  autoApply?: boolean
  locked?: boolean
}) => mount(BuildRecommendBar, { props, global: { plugins: [naive] } })

const applyButton = (w: ReturnType<typeof mountBar>) => w.find('.build-apply')

describe('BuildRecommendBar', () => {
  it('拉取中显示骨架条，不显示按钮', () => {
    const w = mountBar({ build: null, loading: true })
    expect(w.find('.build-bar-loading').exists()).toBe(true)
    expect(w.find('button').exists()).toBe(false)
  })

  it('拉取失败且无缓存（build 为 null）时整条栏不渲染', () => {
    expect(mountBar({ build: null, loading: false }).find('.build-bar').exists()).toBe(false)
  })

  it('构筑里没有符文时不渲染', () => {
    const w = mountBar({ build: build({ runes: [] }), loading: false })
    expect(w.find('.build-bar').exists()).toBe(false)
  })

  it('展示主系 · 基石、核心三件套与依据（永远带样本量）', () => {
    const w = mountBar({ build: build(), loading: false })
    const text = w.text()
    expect(text).toContain('精密 · 致命节奏')
    expect(text).toContain('32.3% 出场')
    expect(text).toContain('46.4% 胜率') // 11314 / 24385
    expect(text).toContain('2.4万场')
    const items = w.findAll('.build-item-icon')
    expect(items.map(i => i.attributes('src'))).toEqual(['/item/3153', '/item/6673', '/item/3031'])
  })

  it('预取完整 9 个符文与两个系的名字（hover 浮层里属性碎片也要有名字）', () => {
    preloadSpy.mockClear()
    mountBar({ build: build(), loading: false })
    const ids = preloadSpy.mock.calls[0][0][0].ids as number[]
    expect(ids).toEqual(expect.arrayContaining([8000, 8400, 8008, 8444, 5005, 5008, 5001]))
  })

  it('样本不足万场时按原数显示', () => {
    const w = mountBar({
      build: build({ runes: [rune({ play: 4668, win: 2254 })] }),
      loading: false
    })
    expect(w.text()).toContain('4668场')
  })

  it('命中旧版本缓存时追加版本提示', () => {
    const stale = mountBar({ build: build({ stale: true, patch: '16.17' }), loading: false })
    expect(stale.text()).toContain('版本 16.17')
    expect(mountBar({ build: build(), loading: false }).text()).not.toContain('版本')
  })

  it('全部构筑低于样本阈值时标注仅供参考，且应用按钮禁用', () => {
    const w = mountBar({ build: build({ runes: [rune({ play: 120, win: 60 })] }), loading: false })
    expect(w.text()).toContain('样本不足，仅供参考')
    expect(applyButton(w).attributes('disabled')).toBeDefined()
  })

  it('手动模式显示「应用符文」，点击发出 apply', async () => {
    const w = mountBar({ build: build(), loading: false })
    expect(applyButton(w).text()).toBe('应用符文')
    await applyButton(w).trigger('click')
    expect(w.emitted('apply')).toHaveLength(1)
  })

  it('写入中禁用按钮防连点', () => {
    const w = mountBar({ build: build(), loading: false, applyState: 'applying' })
    expect(applyButton(w).text()).toBe('应用中…')
    expect(applyButton(w).attributes('disabled')).toBeDefined()
  })

  it('写入成功显示已应用，失败给出可重试的按钮', () => {
    expect(
      applyButton(mountBar({ build: build(), loading: false, applyState: 'applied' })).text()
    ).toBe('已应用')
    const failed = mountBar({ build: build(), loading: false, applyState: 'failed' })
    expect(applyButton(failed).text()).toBe('应用失败，重试')
    expect(applyButton(failed).attributes('disabled')).toBeUndefined()
  })

  describe('自动应用开启时按钮退化为状态指示', () => {
    it('已锁定、等待写入：自动应用中…（不可点）', () => {
      const w = mountBar({ build: build(), loading: false, autoApply: true, locked: true })
      expect(applyButton(w).text()).toBe('自动应用中…')
      expect(applyButton(w).attributes('disabled')).toBeDefined()
    })

    it('还在悬停（未锁定）：说明锁定后才写，不给假承诺', () => {
      const w = mountBar({ build: build(), loading: false, autoApply: true, locked: false })
      expect(applyButton(w).text()).toBe('锁定后自动应用')
      expect(applyButton(w).attributes('disabled')).toBeDefined()
    })

    it('写入成功显示已应用；失败时仍可手动重试', async () => {
      const applied = mountBar({
        build: build(),
        loading: false,
        autoApply: true,
        locked: true,
        applyState: 'applied'
      })
      expect(applyButton(applied).text()).toBe('已应用')

      const failed = mountBar({
        build: build(),
        loading: false,
        autoApply: true,
        locked: true,
        applyState: 'failed'
      })
      expect(applyButton(failed).text()).toBe('应用失败，重试')
      await applyButton(failed).trigger('click')
      expect(failed.emitted('apply')).toHaveLength(1)
    })
  })
})
