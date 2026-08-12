/**
 * 事件筛选纯函数单测（E-测试卡：事件筛选）。
 * 覆盖：类型归组、筛选选项命中、计数、未知类型容错。
 */
import { describe, expect, it } from 'vitest'
import { EVENT_FILTER_OPTIONS, EVENT_KIND_LABEL, countEventKinds, kindOfEvent } from './eventsTable'

const kill = { type: 'CHAMPION_KILL' }
const building = { type: 'BUILDING_KILL' }
const monster = { type: 'ELITE_MONSTER_KILL' }
const plate = { type: 'TURRET_PLATE_DESTROYED' }
const special = { type: 'CHAMPION_SPECIAL_KILL' }
const purchased = { type: 'ITEM_PURCHASED' }

describe('kindOfEvent', () => {
  it('归组六大事件类型', () => {
    expect(kindOfEvent(kill)).toBe('kill')
    expect(kindOfEvent(building)).toBe('building')
    expect(kindOfEvent(monster)).toBe('monster')
    expect(kindOfEvent(plate)).toBe('plate')
    expect(kindOfEvent(special)).toBe('special')
    expect(kindOfEvent(purchased)).toBe('other')
  })

  it('未知/空类型一律归 other 不抛错', () => {
    expect(kindOfEvent({ type: 'SOME_FUTURE_EVENT' })).toBe('other')
    expect(kindOfEvent({ type: null })).toBe('other')
    expect(kindOfEvent({ type: undefined })).toBe('other')
  })

  it('全部 6 个 kind 都有中文标签', () => {
    expect(Object.values(EVENT_KIND_LABEL)).toHaveLength(6)
    for (const label of Object.values(EVENT_KIND_LABEL)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('EVENT_FILTER_OPTIONS', () => {
  it('首项为 all，其后每项对应一个 kind 且 key 唯一', () => {
    expect(EVENT_FILTER_OPTIONS[0].value).toBe('all')
    const values = EVENT_FILTER_OPTIONS.map(o => o.value)
    expect(new Set(values).size).toBe(values.length)
    for (const kind of Object.keys(EVENT_KIND_LABEL) as (keyof typeof EVENT_KIND_LABEL)[]) {
      expect(values).toContain(kind)
    }
  })

  it('each option 只命中自己那类事件', () => {
    for (const opt of EVENT_FILTER_OPTIONS) {
      if (opt.value === 'all') {
        expect(opt.match(kill)).toBe(true)
        continue
      }
      const kind = opt.value
      expect(opt.match({ type: 'CHAMPION_KILL' })).toBe(kind === 'kill')
      expect(opt.match({ type: 'BUILDING_KILL' })).toBe(kind === 'building')
      expect(opt.match({ type: 'ITEM_SOLD' })).toBe(kind === 'other')
    }
  })
})

describe('countEventKinds', () => {
  it('统计全部与各 kind 计数，all 为总数', () => {
    const events = [kill, kill, building, monster, special, plate]
    const counts = countEventKinds(events)
    expect(counts.all).toBe(6)
    expect(counts.kill).toBe(2)
    expect(counts.building).toBe(1)
    expect(counts.monster).toBe(1)
    expect(counts.plate).toBe(1)
    expect(counts.special).toBe(1)
    expect(counts.other).toBe(0)
  })

  it('空数组全 0', () => {
    const counts = countEventKinds([])
    expect(counts.all).toBe(0)
    for (const v of Object.values(counts)) expect(v).toBe(0)
  })
})
