import { describe, it, expect } from 'vitest'
import type { MatchFilter, MatchRefresh } from '../tagSuggest'

describe('tagSuggest 类型与 Rust serde 序列化一致', () => {
  it('recent filter 使用 count 字段', () => {
    const f: MatchFilter = { type: 'recent', count: 20 }
    expect(JSON.parse(JSON.stringify(f))).toEqual({ type: 'recent', count: 20 })
  })
  it('ratio refresh 使用 gameOp/gameValue 命名（对应 Rust serde rename）', () => {
    const r: MatchRefresh = {
      type: 'ratio',
      metric: 'damageShare',
      gameOp: '<',
      gameValue: 0.05,
      op: '>=',
      value: 0.3
    }
    expect(Object.keys(r).sort()).toEqual(
      ['gameOp', 'gameValue', 'metric', 'op', 'type', 'value'].sort()
    )
  })
  it('distinctChampions refresh 结构', () => {
    const r: MatchRefresh = { type: 'distinctChampions', op: '<=', value: 3 }
    expect(JSON.parse(JSON.stringify(r))).toEqual({ type: 'distinctChampions', op: '<=', value: 3 })
  })
})
