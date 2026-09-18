import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import ChampionDetailPanel from '../ChampionDetailPanel.vue'
import type { TierRow } from '../championTier'
import type { ChampionBuild, RunePreset } from '@renderer/types/championBuild'

vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

const NAMES: Record<number, string> = {
  8000: '精密',
  8008: '致命节奏',
  8010: '征服者',
  8400: '坚决',
  4: '闪现',
  14: '点燃',
  3153: '破败王者之刃'
}
vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({
    preload: vi.fn(),
    detailOf: (_k: string, id: number) =>
      NAMES[id] ? { id, name: NAMES[id], description: '' } : null,
    srcOf: (kind: string, id: number) => `/${kind}/${id}`
  })
}))

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }))

function rune(keystone: number, play: number, pickRate: number) {
  return {
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [keystone, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    play,
    win: Math.round(play * 0.51),
    pick_rate: pickRate
  }
}

const BUILD: ChampionBuild = {
  schema_version: 1,
  champion_id: 157,
  position: 'middle',
  mode: 'ranked',
  tier: 'emerald_plus',
  patch: '16.18',
  fetched_at: 0,
  play: 77441,
  win_rate: 0.49,
  runes: [rune(8008, 24385, 0.32), rune(8010, 3901, 0.05)],
  spells: [{ ids: [4, 14], play: 42568, win: 20775, pick_rate: 0.58 }],
  starter_items: [{ ids: [1086, 2003], play: 100, win: 50, pick_rate: 0.76 }],
  boots: [{ ids: [3006], play: 100, win: 50, pick_rate: 0.88 }],
  core_items: [{ ids: [3153, 6673, 3031], play: 7603, win: 4157, pick_rate: 0.17 }],
  last_items: [{ ids: [6673], play: 100, win: 50, pick_rate: 0.74 }],
  skills: [
    {
      order: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W'],
      play: 25610,
      win: 14113,
      pick_rate: 0.52
    }
  ],
  stale: false
}

const ROW: TierRow = {
  championId: 157,
  name: '亚索',
  position: 'MIDDLE',
  tier: 2,
  rank: 15,
  winRate: 0.491,
  pickRate: 0.087,
  banRate: 0.21,
  trend: { dir: 'up', delta: 2 }
}

let build: ChampionBuild | null
let config: Record<string, unknown>

beforeEach(() => {
  invokeMock.mockReset()
  build = BUILD
  config = {}
  invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'get_champion_build') return build
    if (cmd === 'get_lane_counters') {
      return { 157: [{ opponentId: 517, position: 'MIDDLE', subjectWinRate: 0.44, play: 3302 }] }
    }
    if (cmd === 'get_config') {
      const k = args.key as string
      return k in config ? { value: config[k] } : null
    }
    if (cmd === 'put_config') {
      config[args.key as string] = (args.value as { value: unknown }).value
      return null
    }
    return undefined
  })
})

async function mountPanel(row: TierRow | null = ROW) {
  const w = mount(ChampionDetailPanel, {
    props: { row, nameOf: (id: number) => `英雄${id}` },
    global: { plugins: [naive] }
  })
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
  }
  return w
}

describe('ChampionDetailPanel', () => {
  it('头部给榜单那一行的统计', async () => {
    const w = await mountPanel()
    const head = w.find('.detail-head').text()
    expect(head).toContain('亚索')
    expect(head).toContain('中单')
    expect(head).toContain('T2')
    expect(head).toContain('49.1%')
  })

  it('按行的英雄与分路取构筑', async () => {
    await mountPanel()
    expect(invokeMock).toHaveBeenCalledWith('get_champion_build', {
      championId: 157,
      gameMode: 'CLASSIC',
      position: 'middle'
    })
  })

  it('符文 / 出装 / 加点 / 召唤师技能四块都渲染', async () => {
    const w = await mountPanel()
    expect(w.findAll('.detail-rune-row')).toHaveLength(2)
    expect(w.find('.detail-rune-row').text()).toContain('精密 · 致命节奏')
    expect(w.find('.detail-items').exists()).toBe(true)
    expect(w.find('.detail-skills').text()).toContain('Q')
    expect(w.find('.detail-spells').exists()).toBe(true)
  })

  it('苦手对位来自克制数据，带胜率与样本量', async () => {
    const w = await mountPanel()
    const counters = w.find('.detail-counters').text()
    expect(counters).toContain('44.0%')
    expect(counters).toContain('3302')
    expect(counters).toContain('英雄')
  })

  it('构筑拉不到时只降级这几块，头部与苦手照常', async () => {
    build = null
    const w = await mountPanel()
    expect(w.find('.detail-head').exists()).toBe(true)
    expect(w.text()).toContain('数据未取到')
    expect(w.find('.detail-counters').exists()).toBe(true)
  })

  it('记住某套符文：按英雄 + 分路落盘，并切成已记住', async () => {
    const w = await mountPanel()
    await w.findAll('.detail-remember')[1].trigger('click')
    await w.vm.$nextTick()

    const saved = config['settings.auto.runePresets'] as RunePreset[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ champion_id: 157, position: 'middle' })
    expect(saved[0].primary_perk_ids[0]).toBe(8010)
    expect(w.findAll('.detail-remember')[1].text()).toContain('已记住')
  })

  it('换一行时重新取数', async () => {
    const w = await mountPanel()
    invokeMock.mockClear()
    await w.setProps({ row: { ...ROW, championId: 86, name: '盖伦', position: 'TOP' } })
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 0))
      await w.vm.$nextTick()
    }
    expect(invokeMock).toHaveBeenCalledWith('get_champion_build', {
      championId: 86,
      gameMode: 'CLASSIC',
      position: 'top'
    })
  })
})
