import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

/** 符文 / 符文系名字：真实数据来自 LCU perks.json / perkstyles.json */
const NAMES: Record<number, string> = {
  8000: '精密',
  8008: '致命节奏',
  8010: '征服者',
  8100: '主宰',
  8400: '坚决'
}
vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({
    preload: vi.fn(),
    detailOf: (_kind: string, id: number) =>
      NAMES[id] ? { id, name: NAMES[id], description: '' } : null,
    srcOf: (kind: string, id: number) => `/${kind}/${id}`
  })
}))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import RunePresetsCard from '../RunePresetsCard.vue'
import type { RunePreset } from '@renderer/types/championBuild'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)

function preset(
  championId: number,
  position: string,
  keystone: number,
  subStyle: number,
  savedAt: number
): RunePreset {
  return {
    champion_id: championId,
    position,
    primary_style_id: 8000,
    sub_style_id: subStyle,
    primary_perk_ids: [keystone, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    saved_at: savedAt,
    source: 'opgg'
  }
}

const CHAMPIONS = [
  { label: '疾风剑豪', realName: '亚索', value: 157, nickname: '' },
  { label: '魂锁典狱长', realName: '锤石', value: 412, nickname: '' }
]

let store: Record<string, unknown> = {}

beforeEach(() => {
  vi.clearAllMocks()
  store = {
    'settings.auto.applyRunesSwitch': true,
    'settings.auto.runeFallback': '',
    'settings.auto.runePresets': [
      preset(157, 'middle', 8008, 8400, 1),
      preset(157, 'none', 8010, 8100, 2)
    ]
  }
  mockGet.mockImplementation(async (key: string) => store[key])
  mockPut.mockImplementation(async (key: string, value: unknown) => {
    store[key] = value
  })
})

async function mountCard() {
  const w = mount(RunePresetsCard, {
    props: { championOptions: CHAMPIONS },
    global: { plugins: [naive] }
  })
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
  return w
}

const rows = (w: Awaited<ReturnType<typeof mountCard>>) => w.findAll('.preset-row')

describe('RunePresetsCard', () => {
  it('列出我的方案：英雄 · 分路 + 主系 · 基石 / 副系，新记住的在前', async () => {
    const w = await mountCard()
    expect(rows(w)).toHaveLength(2)
    expect(rows(w)[0].text()).toContain('亚索 · 大乱斗')
    expect(rows(w)[0].text()).toContain('精密 · 征服者')
    expect(rows(w)[0].text()).toContain('主宰')
    expect(rows(w)[1].text()).toContain('亚索 · 中单')
    expect(rows(w)[1].text()).toContain('坚决')
  })

  it('没有方案时给出怎么添加的空态说明', async () => {
    store['settings.auto.runePresets'] = ''
    const w = await mountCard()
    expect(rows(w)).toHaveLength(0)
    expect(w.text()).toContain('还没有记住的方案')
  })

  it('删除只去掉这一条并落盘', async () => {
    const w = await mountCard()
    await rows(w)[0].find('.preset-delete').trigger('click')
    expect(mockPut).toHaveBeenCalledWith('settings.auto.runePresets', [
      preset(157, 'middle', 8008, 8400, 1)
    ])
    await w.vm.$nextTick()
    expect(rows(w)).toHaveLength(1)
  })

  it('兜底策略：默认用 OP.GG，改为不写时落盘', async () => {
    const w = await mountCard()
    const radios = w.findAll('.fallback-radio input')
    expect((radios[0].element as HTMLInputElement).checked).toBe(true)
    await radios[1].setValue(true)
    expect(mockPut).toHaveBeenCalledWith('settings.auto.runeFallback', 'none')
  })

  it('头部总开关回显并写 settings.auto.applyRunesSwitch', async () => {
    const w = await mountCard()
    const sw = w.find('.n-card-header [role="switch"]')
    expect(sw.attributes('aria-checked')).toBe('true')
    await sw.trigger('click')
    expect(mockPut).toHaveBeenCalledWith('settings.auto.applyRunesSwitch', false)
  })
})
