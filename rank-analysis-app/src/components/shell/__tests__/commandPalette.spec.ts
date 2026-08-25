import { describe, it, expect } from 'vitest'
import {
  filterCommands,
  nextIndex,
  parsePlayerQuery,
  sortByUsage,
  type PaletteCommand
} from '../commandPalette'

const list: PaletteCommand[] = [
  { key: 'a', group: '页面', label: '主页', run: () => {} },
  { key: 'b', group: '页面', label: '战绩查询', run: () => {} },
  { key: 'c', group: '动作', label: '切换主题', hint: 'Dark/Light', run: () => {} }
]

describe('filterCommands', () => {
  it('空查询返回全部', () => {
    expect(filterCommands(list, '')).toHaveLength(3)
    expect(filterCommands(list, '   ')).toHaveLength(3)
  })
  it('label 包含匹配', () => {
    expect(filterCommands(list, '战绩')).toEqual([list[1]])
    expect(filterCommands(list, '主页')).toEqual([list[0]])
  })
  it('hint 也参与匹配', () => {
    expect(filterCommands(list, 'dark')).toEqual([list[2]])
  })
  it('无命中返回空数组', () => {
    expect(filterCommands(list, '不存在')).toHaveLength(0)
  })
})

describe('nextIndex', () => {
  it('向下移动并环形回绕', () => {
    expect(nextIndex(0, 3, 1)).toBe(1)
    expect(nextIndex(2, 3, 1)).toBe(0)
  })
  it('向上移动并环形回绕', () => {
    expect(nextIndex(0, 3, -1)).toBe(2)
  })
  it('空列表返回 -1', () => {
    expect(nextIndex(0, 0, 1)).toBe(-1)
  })
})

describe('parsePlayerQuery', () => {
  it('容忍 # 两侧空格', () => {
    expect(parsePlayerQuery(' 峡谷诗人 # 5207 ')).toBe('峡谷诗人#5207')
  })
  it('纯名称原样返回', () => {
    expect(parsePlayerQuery('Faker')).toBe('Faker')
  })
  it('空串不是查询意图', () => {
    expect(parsePlayerQuery('   ')).toBeNull()
  })
})

describe('sortByUsage（最近使用组内前置）', () => {
  const make = (key: string, group: string): PaletteCommand => ({
    key,
    group,
    label: key,
    run: () => {}
  })

  it('同分组内按使用频次降序，未使用条目保持相对顺序', () => {
    const seg = [make('a', '页面'), make('b', '页面'), make('c', '页面')]
    const out = sortByUsage(seg, { c: 5, a: 2 })
    expect(out.map(x => x.key)).toEqual(['c', 'a', 'b'])
  })

  it('分组边界不因排序而合并', () => {
    const seg = [make('p1', '页面'), make('a1', '动作'), make('p2', '页面')]
    const out = sortByUsage(seg, { p2: 9, a1: 1 })
    expect(out.filter(x => x.group === '页面').map(x => x.key)).toEqual(['p1', 'p2'])
    expect(out.filter(x => x.group === '动作').map(x => x.key)).toEqual(['a1'])
  })

  it('空 usage 稳定返回原序', () => {
    const seg = [make('b', '页面'), make('a', '页面')]
    expect(sortByUsage(seg, {}).map(x => x.key)).toEqual(['b', 'a'])
  })
})

