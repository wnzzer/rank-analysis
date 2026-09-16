import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import ChampionTierTable from '../ChampionTierTable.vue'
import { toRows } from '../championTier'
import type { ChampionMeta } from '@renderer/services/opgg'

vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

function meta(id: number, position: string, o: Partial<ChampionMeta> = {}): ChampionMeta {
  return {
    championId: id,
    position,
    tier: 1,
    rank: 3,
    rankPrevPatch: 6,
    winRate: 0.518,
    pickRate: 0.082,
    banRate: 0.031,
    roleRate: 0.7,
    isMainPosition: true,
    ...o
  }
}

const NAMES: Record<number, string> = { 86: '盖伦', 157: '亚索' }
const rows = toRows(
  [meta(86, 'TOP'), meta(157, 'MIDDLE', { tier: 2, rank: 15, rankPrevPatch: 0 })],
  'all',
  id => NAMES[id] ?? `英雄${id}`
)

const mountTable = (props: Partial<{ rows: typeof rows; loading: boolean }> = {}) =>
  mount(ChampionTierTable, {
    props: { rows, loading: false, ...props },
    global: { plugins: [naive] }
  })

const bodyRows = (w: ReturnType<typeof mountTable>) => w.findAll('.champion-row')

describe('ChampionTierTable', () => {
  it('每行渲染英雄、分路、T 级与三个百分比', () => {
    const w = mountTable()
    expect(bodyRows(w)).toHaveLength(2)
    const first = bodyRows(w)[0].text()
    expect(first).toContain('盖伦')
    expect(first).toContain('上单')
    expect(first).toContain('T1')
    expect(first).toContain('51.8%')
    expect(first).toContain('8.2%')
    expect(first).toContain('3.1%')
  })

  it('趋势：走强显示 ↑n，没有上版本数据显示占位', () => {
    const w = mountTable()
    expect(bodyRows(w)[0].find('.champion-trend').text()).toContain('↑3')
    expect(bodyRows(w)[1].find('.champion-trend').text()).toBe('—')
  })

  it('点行发出 select，带上那一行', () => {
    const w = mountTable()
    bodyRows(w)[1].trigger('click')
    expect(w.emitted('select')?.[0][0]).toMatchObject({ championId: 157, position: 'MIDDLE' })
  })

  it('无数据时给空态文案，不渲染空表', () => {
    const w = mountTable({ rows: [] })
    expect(bodyRows(w)).toHaveLength(0)
    expect(w.text()).toContain('没有匹配的英雄')
  })

  it('加载中显示骨架，不显示空态', () => {
    const w = mountTable({ rows: [], loading: true })
    expect(w.find('.champion-skeleton').exists()).toBe(true)
    expect(w.text()).not.toContain('没有匹配的英雄')
  })
})
