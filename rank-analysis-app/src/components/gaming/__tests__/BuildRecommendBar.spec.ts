import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import BuildRecommendBar from '../BuildRecommendBar.vue'
import type { ApplyState } from '@renderer/composables/useChampionBuild'
import type { ChampionBuild, RuneBuild, RuneOption } from '@renderer/types/championBuild'

/** 符文 / 符文系名字：真实数据来自 LCU perks.json / perkstyles.json */
const NAMES: Record<number, string> = {
  8000: '精密',
  8008: '致命节奏',
  8021: '迅捷步法',
  8010: '征服者',
  8400: '坚决'
}

const preloadSpy = vi.hoisted(() => vi.fn())

vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({
    preload: preloadSpy,
    detailOf: (_kind: string, id: number) =>
      NAMES[id] ? { id, name: NAMES[id], description: '' } : null,
    srcOf: (kind: string, id: number) => `/${kind}/${id}`
  })
}))

function rune(keystone: number, play: number, win: number, pickRate: number): RuneBuild {
  return {
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [keystone, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    play,
    win,
    pick_rate: pickRate
  }
}

function opt(key: string, r: RuneBuild, extra: Partial<RuneOption> = {}): RuneOption {
  return { key, rune: r, source: 'opgg', starred: false, sufficient: r.play >= 200, ...extra }
}

const OPTIONS: RuneOption[] = [
  opt('opgg-0', rune(8008, 24385, 11314, 0.3229)),
  opt('opgg-1', rune(8021, 4668, 2254, 0.0618)),
  opt('opgg-2', rune(8010, 150, 70, 0.02))
]

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
    runes: OPTIONS.map(o => o.rune),
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

interface Props {
  build: ChampionBuild | null
  loading: boolean
  options: RuneOption[]
  selectedKey: string | null
  applyState?: ApplyState
  autoApply?: boolean
  locked?: boolean
  isAutoTarget?: boolean
  remembered?: boolean
}

const mountBar = (overrides: Partial<Props> = {}) =>
  mount(BuildRecommendBar, {
    props: {
      build: build(),
      loading: false,
      options: OPTIONS,
      selectedKey: 'opgg-0',
      ...overrides
    },
    global: { plugins: [naive] }
  })

const applyButton = (w: ReturnType<typeof mountBar>) => w.find('.build-apply')
const rememberButton = (w: ReturnType<typeof mountBar>) => w.find('.build-remember')
const cards = (w: ReturnType<typeof mountBar>) => w.findAll('.build-card')

describe('BuildRecommendBar 渲染', () => {
  it('拉取中显示骨架条，不显示按钮', () => {
    const w = mountBar({ build: null, loading: true, options: [] })
    expect(w.find('.build-bar-loading').exists()).toBe(true)
    expect(w.find('button').exists()).toBe(false)
  })

  it('没有任何方案时整条栏不渲染', () => {
    expect(mountBar({ build: null, options: [] }).find('.build-bar').exists()).toBe(false)
  })

  it('每套方案一张卡：主系 · 基石 + 出场 · 胜率，选中的高亮', () => {
    const w = mountBar()
    expect(cards(w)).toHaveLength(3)
    expect(cards(w)[0].text()).toContain('精密 · 致命节奏')
    expect(cards(w)[0].text()).toContain('32.3% · 46.4%')
    expect(cards(w)[1].text()).toContain('迅捷步法')
    expect(cards(w)[0].classes()).toContain('build-card-selected')
    expect(cards(w)[1].classes()).not.toContain('build-card-selected')
  })

  it('样本少的卡变淡并标注，我的方案带 ★', () => {
    const w = mountBar({
      options: [
        opt('preset', rune(8010, 0, 0, 0), { source: 'preset', starred: true, sufficient: true }),
        ...OPTIONS
      ],
      selectedKey: 'preset'
    })
    const [mine, , , low] = cards(w)
    expect(mine.text()).toContain('★')
    expect(mine.text()).toContain('我的方案')
    expect(low.classes()).toContain('build-card-low')
    expect(low.text()).toContain('样本少')
  })

  it('点卡片发出 select', async () => {
    const w = mountBar()
    await cards(w)[1].trigger('click')
    expect(w.emitted('select')).toEqual([['opgg-1']])
  })

  it('第二行给出选中方案的依据（永远带样本量）与核心装', () => {
    const w = mountBar()
    const info = w.find('.build-info').text()
    expect(info).toContain('32.3% 出场 · 46.4% 胜率 · 2.4万场')
    expect(w.findAll('.build-item-icon').map(i => i.attributes('src'))).toEqual([
      '/item/3153',
      '/item/6673',
      '/item/3031'
    ])
    expect(mountBar({ selectedKey: 'opgg-1' }).find('.build-info').text()).toContain('4668场')
  })

  it('选中样本少的方案时提示仅供参考，旧版本缓存提示版本', () => {
    expect(mountBar({ selectedKey: 'opgg-2' }).find('.build-info').text()).toContain(
      '样本少，仅供参考'
    )
    const stale = mountBar({ build: build({ stale: true, patch: '16.17' }) })
    expect(stale.find('.build-info').text()).toContain('版本 16.17')
    expect(mountBar().find('.build-info').text()).not.toContain('版本')
  })

  it('OP.GG 拉不到、只有我的方案时照常渲染', () => {
    const w = mountBar({
      build: null,
      options: [opt('preset', rune(8010, 0, 0, 0), { source: 'preset', starred: true })],
      selectedKey: 'preset'
    })
    expect(cards(w)).toHaveLength(1)
    expect(w.find('.build-info').text()).toContain('我的方案')
  })

  it('预取所有方案的两个系与 9 个符文名字（浮层里属性碎片也要有名字）', () => {
    preloadSpy.mockClear()
    mountBar()
    const ids = preloadSpy.mock.calls[0][0][0].ids as number[]
    expect(ids).toEqual(expect.arrayContaining([8000, 8400, 8008, 8021, 8010, 8444, 5005, 5001]))
  })
})

describe('BuildRecommendBar 按钮', () => {
  it('手动模式：应用符文，点击发出 apply', async () => {
    const w = mountBar()
    expect(applyButton(w).text()).toBe('应用符文')
    await applyButton(w).trigger('click')
    expect(w.emitted('apply')).toHaveLength(1)
  })

  it('写入中禁用；成功显示已应用；失败可重试', () => {
    const applying = mountBar({ applyState: 'applying' })
    expect(applyButton(applying).text()).toBe('应用中…')
    expect(applyButton(applying).attributes('disabled')).toBeDefined()
    expect(applyButton(mountBar({ applyState: 'applied' })).text()).toBe('已应用')
    const failed = mountBar({ applyState: 'failed' })
    expect(applyButton(failed).text()).toBe('应用失败，重试')
    expect(applyButton(failed).attributes('disabled')).toBeUndefined()
  })

  it('样本少的方案也能手动应用', () => {
    expect(applyButton(mountBar({ selectedKey: 'opgg-2' })).attributes('disabled')).toBeUndefined()
  })

  it('自动模式且选中的正是自动方案：按钮退化为状态指示', () => {
    const locked = mountBar({ autoApply: true, isAutoTarget: true, locked: true })
    expect(applyButton(locked).text()).toBe('自动应用中…')
    expect(applyButton(locked).attributes('disabled')).toBeDefined()
    const hovering = mountBar({ autoApply: true, isAutoTarget: true, locked: false })
    expect(applyButton(hovering).text()).toBe('锁定后自动应用')
  })

  it('自动模式但选了别的方案：按钮可点（点了即手动接管）', () => {
    const w = mountBar({ autoApply: true, isAutoTarget: false, locked: true })
    expect(applyButton(w).text()).toBe('应用符文')
    expect(applyButton(w).attributes('disabled')).toBeUndefined()
  })

  it('记住按钮：未记住 → ☆ 记住，已记住 → ★ 已记住，点击发出 toggle-remember', async () => {
    const w = mountBar()
    expect(rememberButton(w).text()).toBe('☆ 记住')
    await rememberButton(w).trigger('click')
    expect(w.emitted('toggle-remember')).toHaveLength(1)
    expect(rememberButton(mountBar({ remembered: true })).text()).toBe('★ 已记住')
  })
})
