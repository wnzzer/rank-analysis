/**
 * mayhemData 纯工具函数单测：
 * stripRichText（上游富文本剥离）与 bestStage（分轮统计防御性解析）。
 */
import { describe, expect, it } from 'vitest'

import { bestStage, stripRichText } from '../mayhemData'

describe('stripRichText', () => {
  it('应剥除上游富文本标签并保留正文', () => {
    const raw =
      '在承受或造成伤害时获得层数。每10层，获得<scaleAF>适应之力</scaleAF>、<scaleArmor>护甲</scaleArmor>和<attention>体型</attention>。'
    expect(stripRichText(raw)).toBe(
      '在承受或造成伤害时获得层数。每10层，获得适应之力、护甲和体型。'
    )
  })

  it('应处理自闭合标签与换行空白折叠', () => {
    expect(stripRichText('第一行<br><br>第二行')).toBe('第一行 第二行')
  })

  it('应还原常见 HTML 实体', () => {
    expect(stripRichText('&lt;a&gt; &amp; &quot;q&quot; &#39;s&#39;')).toBe('<a> & "q" \'s\'')
  })

  it('空值安全返回空串', () => {
    expect(stripRichText(undefined)).toBe('')
    expect(stripRichText(null)).toBe('')
    expect(stripRichText('')).toBe('')
  })
})

describe('bestStage', () => {
  it('应返回胜率最高的轮次（嵌套 stats 形态）', () => {
    const stages = [
      { stage: 1, stats: { winRate: 0.55 } },
      { stage: 2, stats: { winRate: 0.61 } },
      { stage: 3, stats: { winRate: 0.58 } }
    ]
    expect(bestStage(stages)).toBe(2)
  })

  it('应兼容扁平 winRate 形态并限制到 1-4 轮', () => {
    const stages = [
      { stage: '2', winRate: '0.52' },
      { slot: 9, stats: { winRate: 0.9 } },
      { pick: 3, stats: { winRate: 0.6 } }
    ]
    // 第 9 轮超出范围，钳制为 4；其胜率最高
    expect(bestStage(stages)).toBe(4)
  })

  it('无法解析时返回 null', () => {
    expect(bestStage([])).toBeNull()
    expect(bestStage([{ stage: 'x', stats: {} }])).toBeNull()
    expect(bestStage([{ stage: 1 }])).toBeNull()
  })
})
