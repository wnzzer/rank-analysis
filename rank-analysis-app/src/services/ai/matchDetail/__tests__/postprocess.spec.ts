import { describe, it, expect } from 'vitest'
import { dedupeSectionMentions } from '../postprocess'

describe('dedupeSectionMentions', () => {
  it('同一玩家出现在两个人物章节时只保留首个条目', () => {
    const md = [
      '## 谁要背锅',
      '- 木阿头#46714：工具人 — 13次死亡',
      '',
      '## 谁被打爆 / 被连累',
      '- 木阿头#46714（被爆）：13次倒地 — 15.7%经济',
      '- 花前月下#21553（被连累）：8杀 — 13.7%伤害'
    ].join('\n')
    const out = dedupeSectionMentions(md)
    expect(out).toContain('工具人')
    expect(out).not.toContain('13次倒地')
    expect(out).toContain('花前月下#21553')
  })

  it('关键证据章节不去重（复述数字属正常）', () => {
    const md = [
      '## 谁尽力了',
      '- 阿狸玩家#12345：carry — 30%伤害',
      '',
      '## 关键证据',
      '- 阿狸玩家#12345 伤害占比30%全场最高'
    ].join('\n')
    const out = dedupeSectionMentions(md)
    expect(out).toContain('伤害占比30%全场最高')
  })

  it('无重复时原样返回', () => {
    const md = ['## 谁尽力了', '- 甲#1111：好 — 1', '## 谁要背锅', '- 乙#2222：差 — 2'].join('\n')
    expect(dedupeSectionMentions(md)).toBe(md)
  })

  it('流式不完整 markdown 不抛异常', () => {
    expect(() => dedupeSectionMentions('## 谁尽')).not.toThrow()
    expect(dedupeSectionMentions('')).toBe('')
  })
})
