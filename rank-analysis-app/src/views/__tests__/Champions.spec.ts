/**
 * 英雄榜页面：数据未就绪时的空态、段位切换重取、分路筛选与搜索接线（挂载真实组件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import Champions from '../Champions.vue'
import type { ChampionMeta } from '@renderer/services/opgg'

const mockInvoke = vi.mocked(invoke)

function meta(id: number, position: string, o: Partial<ChampionMeta> = {}): ChampionMeta {
  return {
    championId: id,
    position,
    tier: 1,
    rank: 3,
    rankPrevPatch: 6,
    winRate: 0.52,
    pickRate: 0.08,
    banRate: 0.03,
    roleRate: 0.7,
    isMainPosition: true,
    ...o
  }
}

let metas: ChampionMeta[]
// 段位切换后 useOpggTier 会校验拿到的快照确实换了段位，mock 必须跟着变
let currentTier = 'emerald_plus'
let currentPosition = 'MIDDLE'

async function settle(w: { vm: { $nextTick: () => Promise<void> } }) {
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
}

const stubs = {
  Select: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template:
      '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
      '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
      '</select>'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  metas = [
    meta(157, 'MIDDLE', { tier: 1, rank: 3 }),
    meta(86, 'MIDDLE', { tier: 2, rank: 15 }),
    meta(86, 'TOP', { isMainPosition: false, tier: 3, rank: 40 })
  ]
  currentTier = 'emerald_plus'
  currentPosition = 'MIDDLE'
  vi.mocked(getConfigByIpc).mockImplementation(async (key: string) => {
    if (key === 'settings.opgg.tier') return currentTier
    if (key === 'settings.opgg.position') return currentPosition
    return undefined
  })
  // 切段位先写配置再重拉；useOpggTier 会校验拿到的快照确实换了段位，mock 必须跟着变
  vi.mocked(putConfigByIpc).mockImplementation(async (key: string, value: unknown) => {
    if (key === 'settings.opgg.tier') currentTier = value as string
    if (key === 'settings.opgg.position') currentPosition = value as string
  })
  const status = () => ({
    mode: 'ranked',
    patch: '16.18',
    fetchedAt: 0,
    stale: false,
    championCount: metas.length,
    tier: currentTier
  })
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_champion_metas') return metas
    if (cmd === 'get_champion_options') {
      return [
        { label: '德玛西亚之力', realName: '盖伦', value: 86, nickname: 'gl (Garen)' },
        { label: '疾风剑豪', realName: '亚索', value: 157, nickname: 'yasuo (Yasuo)' }
      ]
    }
    if (cmd === 'get_opgg_status' || cmd === 'update_opgg_data') return status()
    return undefined
  })
})

const mountPage = () => mount(Champions, { global: { plugins: [naive], stubs } })

describe('Champions.vue', () => {
  it('只渲染配置里那条路的行', async () => {
    const w = mountPage()
    await settle(w)

    // 夹具里 MIDDLE 两行、TOP 一行
    expect(w.findAll('.champion-row')).toHaveLength(2)
    expect(w.text()).toContain('16.18')
    w.unmount()
  })

  it('配置里存的是别的路，就落在那条路上', async () => {
    currentPosition = 'TOP'
    const w = mountPage()
    await settle(w)

    expect(w.findAll('.champion-row')).toHaveLength(1)
    expect(w.find('.champion-row').text()).toContain('盖伦')
    w.unmount()
  })

  it('没设置过（空串）时落回中单', async () => {
    currentPosition = ''
    const w = mountPage()
    await settle(w)

    expect(w.findAll('.champion-row')).toHaveLength(2)
    w.unmount()
  })

  it('切分路：写配置并只留该路的行', async () => {
    const w = mountPage()
    await settle(w)

    const positionSelect = w.findAll('select')[0]
    await positionSelect.setValue('TOP')
    await settle(w)

    expect(putConfigByIpc).toHaveBeenCalledWith('settings.opgg.position', 'TOP')
    expect(w.findAll('.champion-row')).toHaveLength(1)
    w.unmount()
  })

  it('分路选择器没有「全部分路」', async () => {
    const w = mountPage()
    await settle(w)

    expect(w.findAll('select')[0].text()).not.toContain('全部分路')
    w.unmount()
  })

  it('快照没数据时给「数据未就绪」，不渲染空表格', async () => {
    metas = []
    const w = mountPage()
    await settle(w)

    expect(w.text()).toContain('数据未就绪')
    expect(w.find('.champion-table').exists()).toBe(false)
    w.unmount()
  })

  it('搜索按名字 / 称号 / 别名过滤', async () => {
    const w = mountPage()
    await settle(w)

    const input = w.find('input')
    await input.setValue('疾风')
    await settle(w)

    expect(w.findAll('.champion-row')).toHaveLength(1)
    expect(w.find('.champion-row').text()).toContain('亚索')
    w.unmount()
  })

  it('切段位：写配置并重拉快照与榜单', async () => {
    const w = mountPage()
    await settle(w)
    mockInvoke.mockClear()

    const tierSelect = w.findAll('select')[1]
    await tierSelect.setValue('master_plus')
    await settle(w)

    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    expect(mockInvoke).toHaveBeenCalledWith('list_champion_metas', { mode: 'ranked' })
    w.unmount()
  })
})
