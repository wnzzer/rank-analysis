/**
 * 符文描述纯函数单测（符文 tab 数据层）。
 * 覆盖：@eogvarN@ 占位符替换、未识别占位符保留、无 selection/无描述容错。
 */
import { describe, expect, it } from 'vitest'
import { fillPerkDescription } from './runesTable'

const sel = { perk: 8112, var1: 5, var2: 10, var3: 0 }

describe('fillPerkDescription', () => {
  it('@eogvar1/2/3@ 替换为 selection 实际数值', () => {
    const desc = '伤害提升 @eogvar1@，治疗 @eogvar2@，冷却 @eogvar3@%'
    expect(fillPerkDescription(desc, sel)).toBe('伤害提升 5，治疗 10，冷却 0%')
  })

  it('同一占位符多处出现全部替换', () => {
    expect(fillPerkDescription('@eogvar1@ 与 @eogvar1@', sel)).toBe('5 与 5')
  })

  it('未识别占位符（@eogvar4@ 等）原样保留', () => {
    expect(fillPerkDescription('特殊 @eogvar4@', sel)).toBe('特殊 @eogvar4@')
  })

  it('无 selection（旧数据）原样返回描述，不猜测数值', () => {
    const desc = '数值 @eogvar1@'
    expect(fillPerkDescription(desc, undefined)).toBe(desc)
  })

  it('无描述返回空串', () => {
    expect(fillPerkDescription(undefined, sel)).toBe('')
    expect(fillPerkDescription('', sel)).toBe('')
  })
})
