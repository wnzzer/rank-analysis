/**
 * exportGoals 测试：序列化/解析 roundtrip、结构校验、按维度+标题重映射备注。
 */
import { describe, it, expect } from 'vitest'
import { serializeGoalsBackup, parseGoalsBackup, remapNotesByTitleKey } from '../exportGoals'
import type { HabitGoal } from '../../services/insight'

const goals: HabitGoal[] = [
  { id: 11, dimension: 'vision', title: '排眼数 +1', done: false },
  { id: 12, dimension: 'cs', title: '10 分钟 80 刀', done: true }
]

describe('serializeGoalsBackup / parseGoalsBackup', () => {
  it('roundtrip：goals 与 notes 完整还原', () => {
    const text = serializeGoalsBackup(goals, { '11': '本周重点' })
    const back = parseGoalsBackup(text)
    expect(back.version).toBe(1)
    expect(back.goals).toEqual(goals)
    expect(back.notes).toEqual({ '11': '本周重点' })
  })

  it('结构不符抛错（非备份文件）', () => {
    expect(() => parseGoalsBackup('{"hello":1}')).toThrow()
    expect(() => parseGoalsBackup('not json')).toThrow()
  })

  it('非法条目被过滤而非整体失败；空备注剔除', () => {
    const dirty = JSON.stringify({
      version: 1,
      exportedAt: '2026-01-01',
      goals: [
        ...goals,
        { id: 'bad', dimension: 3 },
        { id: 13, dimension: 'deaths', title: '少送', done: false }
      ],
      notes: { '11': 'ok', '12': '', badKey: 42 }
    })
    const back = parseGoalsBackup(dirty)
    expect(back.goals.map(g => g.id).sort()).toEqual([11, 12, 13])
    expect(back.notes).toEqual({ '11': 'ok' })
  })

  it('appVersion 元信息可选纳入', () => {
    const text = serializeGoalsBackup(goals, {}, '1.2.3')
    const back = parseGoalsBackup(text)
    expect(back.appVersion).toBe('1.2.3')
  })
})

describe('remapNotesByTitleKey', () => {
  it('旧 id 备注按 维度::标题 映射到新 id', () => {
    const backup = parseGoalsBackup(serializeGoalsBackup(goals, { '11': '视野周计划' }))
    const localGoals: HabitGoal[] = [
      { id: 77, dimension: 'vision', title: '排眼数 +1', done: false }
    ]
    expect(remapNotesByTitleKey(backup, localGoals)).toEqual({ '77': '视野周计划' })
  })

  it('本地没有对应目标时不产生备注', () => {
    const backup = parseGoalsBackup(serializeGoalsBackup(goals, { '12': '补刀提醒' }))
    const localGoals: HabitGoal[] = [
      { id: 90, dimension: 'vision', title: '别的目标', done: false }
    ]
    expect(remapNotesByTitleKey(backup, localGoals)).toEqual({})
  })

  it('还原全链路：缺失检测→补建→重映射（镜像视图层 importGoalsFile 步骤）', () => {
    const text = serializeGoalsBackup(goals, { '11': '视野周计划', '12': '补刀提醒' })
    const backup = parseGoalsBackup(text)
    // 本地已有「10 分钟 80 刀」（id 不同），缺「排眼数 +1」
    let local: HabitGoal[] = [{ id: 90, dimension: 'cs', title: '10 分钟 80 刀', done: true }]
    const missing = backup.goals.filter(
      g => !local.some(s => s.dimension === g.dimension && s.title === g.title)
    )
    expect(missing.map(g => g.title)).toEqual(['排眼数 +1'])
    for (const g of missing) {
      local = [
        ...local,
        { id: 100 + local.length, dimension: g.dimension, title: g.title, done: false }
      ]
    }
    const remapped = remapNotesByTitleKey(backup, local)
    expect(remapped['101']).toBe('视野周计划')
    expect(remapped['90']).toBe('补刀提醒')
  })
})
