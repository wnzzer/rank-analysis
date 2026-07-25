/**
 * unifiedTagRow 纯函数单元测试:排序稳定性与溢出切片边界
 * @module components/common/__tests__/unifiedTagRowHelpers
 */
import { describe, it, expect } from 'vitest'
import { orderTags, splitVisible } from '../unifiedTagRow'
import type { RankTag } from '@renderer/types/domain/analysis'

const t = (tagName: string, good: boolean): RankTag => ({ tagName, tagDesc: '', good })

describe('orderTags', () => {
  it('bad 排在 good 前', () => {
    const result = orderTags([t('专精', true), t('炸鱼嫌疑', false)])
    expect(result.map(x => x.tagName)).toEqual(['炸鱼嫌疑', '专精'])
  })

  it('同组保持原序(稳定排序)', () => {
    const result = orderTags([
      t('good1', true),
      t('bad1', false),
      t('good2', true),
      t('bad2', false)
    ])
    expect(result.map(x => x.tagName)).toEqual(['bad1', 'bad2', 'good1', 'good2'])
  })

  it('不修改原数组', () => {
    const input = [t('专精', true), t('炸鱼嫌疑', false)]
    orderTags(input)
    expect(input.map(x => x.tagName)).toEqual(['专精', '炸鱼嫌疑'])
  })
})

describe('splitVisible', () => {
  const four = [t('a', false), t('b', false), t('c', true), t('d', true)]

  it('未传 maxVisible 时全部可见', () => {
    expect(splitVisible(four)).toEqual({ visible: four, overflow: [] })
  })

  it('长度不超过 maxVisible 时无溢出', () => {
    expect(splitVisible(four, 4).overflow).toEqual([])
    expect(splitVisible(four, 9).overflow).toEqual([])
  })

  it('超出时按序切片', () => {
    const { visible, overflow } = splitVisible(four, 2)
    expect(visible.map(x => x.tagName)).toEqual(['a', 'b'])
    expect(overflow.map(x => x.tagName)).toEqual(['c', 'd'])
  })

  it('maxVisible 为 0 时全部进溢出', () => {
    const { visible, overflow } = splitVisible(four, 0)
    expect(visible).toEqual([])
    expect(overflow).toHaveLength(4)
  })
})
