/**
 * 事件筛选纯函数单测（E-测试卡：事件筛选）。
 * 覆盖：类型归组、筛选选项命中、计数、未知类型容错。
 */
import { describe, expect, it } from 'vitest'
import {
  EVENT_FILTER_OPTIONS,
  EVENT_KIND_LABEL,
  countEventKinds,
  eventInvolves,
  kindOfEvent,
  summarizeEvents
} from './eventsTable'

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

describe('eventInvolves', () => {
  it('操作者/击杀者/受害者/助攻者任一命中即为涉及', () => {
    const kill = {
      type: 'CHAMPION_KILL',
      killerId: 1,
      victimId: 2,
      assistingParticipantIds: [3, 4]
    }
    expect(eventInvolves(kill, 1)).toBe(true)
    expect(eventInvolves(kill, 2)).toBe(true)
    expect(eventInvolves(kill, 3)).toBe(true)
    expect(eventInvolves(kill, 4)).toBe(true)
    expect(eventInvolves(kill, 5)).toBe(false)
  })

  it('普通事件按 participantId 判定', () => {
    expect(eventInvolves({ type: 'ITEM_PURCHASED', participantId: 7 }, 7)).toBe(true)
    expect(eventInvolves({ type: 'ITEM_PURCHASED', participantId: 7 }, 8)).toBe(false)
  })

  it('无效 participantId（0/负/null）恒不涉及', () => {
    expect(eventInvolves({ type: 'CHAMPION_KILL', killerId: 1 }, 0)).toBe(false)
    expect(eventInvolves({ type: 'CHAMPION_KILL', killerId: 1 }, -1)).toBe(false)
    expect(eventInvolves({ type: 'CHAMPION_KILL', killerId: 1 }, null as unknown as number)).toBe(
      false
    )
  })

  it('缺助攻数组时不抛错', () => {
    expect(eventInvolves({ type: 'CHAMPION_KILL', killerId: 1, victimId: 2 }, 3)).toBe(false)
  })
})

describe('summarizeEvents', () => {
  it('统计击杀/特殊击杀/塔皮（按队伍）/建筑（按队伍）/中立（龙族细分优先）', () => {
    const events = [
      { type: 'CHAMPION_KILL' },
      { type: 'CHAMPION_KILL' },
      { type: 'CHAMPION_SPECIAL_KILL' },
      { type: 'TURRET_PLATE_DESTROYED', teamId: 100 },
      { type: 'TURRET_PLATE_DESTROYED', teamId: 100 },
      { type: 'TURRET_PLATE_DESTROYED', teamId: 200 },
      { type: 'BUILDING_KILL', teamId: 100 },
      { type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' },
      { type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' },
      { type: 'ELITE_MONSTER_KILL', monsterType: 'BARON_NASHOR' }
    ]
    const summary = summarizeEvents(events)
    expect(summary.kills).toBe(2)
    expect(summary.specialKills).toBe(1)
    expect(summary.plates).toEqual({ 100: 2, 200: 1 })
    expect(summary.buildings).toEqual({ 100: 1 })
    expect(summary.monsters).toEqual({ FIRE_DRAGON: 2, BARON_NASHOR: 1 })
  })

  it('无关类型不进入统计', () => {
    const summary = summarizeEvents([
      { type: 'ITEM_PURCHASED' },
      { type: 'GAME_END' },
      { type: 'SKILL_LEVEL_UP' }
    ])
    expect(summary).toEqual({ kills: 0, specialKills: 0, plates: {}, buildings: {}, monsters: {} })
  })

  it('空数组返回全零统计', () => {
    expect(summarizeEvents([])).toEqual({
      kills: 0,
      specialKills: 0,
      plates: {},
      buildings: {},
      monsters: {}
    })
  })
})
