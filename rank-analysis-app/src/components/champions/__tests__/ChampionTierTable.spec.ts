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
  [
    meta(86, 'MIDDLE'),
    meta(157, 'MIDDLE', { tier: 2, rank: 15, rankPrevPatch: 40, winRate: 0.259 })
  ],
  'MIDDLE',
  id => NAMES[id] ?? `英雄${id}`
)

/** 全量最大值：胜率 51.8%、登场率 8.2%、Ban 率 3.1% */
const maxima = { winRate: 0.518, pickRate: 0.082, banRate: 0.031 }

const mountTable = (props: Record<string, unknown> = {}) =>
  mount(ChampionTierTable, {
    props: { rows, loading: false, maxima, ...props },
    global: { plugins: [naive] }
  })

const bodyRows = (w: ReturnType<typeof mountTable>) => w.findAll('.champion-row')

describe('ChampionTierTable', () => {
  it('每行渲染英雄、T 级与三个百分比，不再有分路列', () => {
    const w = mountTable()
    expect(bodyRows(w)).toHaveLength(2)
    const first = bodyRows(w)[0].text()
    expect(first).toContain('盖伦')
    expect(first).toContain('T1')
    expect(first).toContain('51.8%')
    expect(first).toContain('8.2%')
    expect(first).toContain('3.1%')
    expect(first).not.toContain('中单')
  })

  it('榜位列是 OP.GG 的本路排名，不是行号', () => {
    const w = mountTable()
    expect(bodyRows(w)[0].find('.col-rank').text()).toBe('3')
    expect(bodyRows(w)[1].find('.col-rank').text()).toBe('15')
  })

  it('换个顺序传进来，榜位跟着行走而不是重新编号', () => {
    const w = mountTable({ rows: [...rows].reverse() })
    expect(bodyRows(w)[0].find('.col-rank').text()).toBe('15')
    expect(bodyRows(w)[1].find('.col-rank').text()).toBe('3')
  })

  it('迷你条按传入的全量最大值归一', () => {
    const w = mountTable()
    const fills = bodyRows(w)[0].findAll('.metric-fill')
    expect(fills[0].attributes('style')).toContain('width: 100%')
    // 亚索胜率 25.9% / 最大 51.8% = 50%
    expect(bodyRows(w)[1].findAll('.metric-fill')[0].attributes('style')).toContain('width: 50%')
  })

  it('只剩一行时条长仍按全量最大值算，不会变成满格', () => {
    const w = mountTable({ rows: [rows[1]] })
    expect(bodyRows(w)[0].findAll('.metric-fill')[0].attributes('style')).toContain('width: 50%')
  })

  it('最大值为 0 时条长归零，不做除零', () => {
    const w = mountTable({ maxima: { winRate: 0, pickRate: 0, banRate: 0 } })
    expect(bodyRows(w)[0].findAll('.metric-fill')[0].attributes('style')).toContain('width: 0%')
  })

  it('趋势只标挪动 ≥10 名的，其余留空', () => {
    const w = mountTable()
    // 盖伦 6 → 3 只挪了 3 名
    expect(bodyRows(w)[0].find('.trend-badge').exists()).toBe(false)
    // 亚索 40 → 15 挪了 25 名
    expect(bodyRows(w)[1].find('.trend-badge').text()).toBe('↑25')
  })

  it('点行发出 select，带上那一行', () => {
    const w = mountTable()
    bodyRows(w)[1].trigger('click')
    expect(w.emitted('select')?.[0][0]).toMatchObject({ championId: 157, position: 'MIDDLE' })
  })

  it('点列头发出 sort', () => {
    const w = mountTable()
    w.findAll('.col-sortable')[0].trigger('click')
    expect(w.emitted('sort')?.[0][0]).toBe('winRate')
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
