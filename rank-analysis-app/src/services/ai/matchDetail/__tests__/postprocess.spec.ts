import { describe, it, expect } from 'vitest'
import { resectionByLabels } from '../postprocess'

describe('resectionByLabels(按 label 确定性重排人物章节)', () => {
  const verdicts = [
    { name: '甲甲#111', label: '尽力' },
    { name: '乙乙#222', label: '缚地灵' },
    { name: '丙丙#333', label: '被爆' },
    { name: '丁丁#444', label: '正常' }
  ]

  it('模型放错章节的条目被搬回 label 对应章节(真机复现:缚地灵进了谁尽力了)', () => {
    const md = [
      '## 一句话定论',
      '定论。',
      '## 谁尽力了',
      '- 甲甲#111：真核 — 10杀',
      '- 乙乙#222：开团机器 — 74%参团',
      '## 谁要背锅',
      '- 丙丙#333：被打成筛子 — 13死',
      '## 谁被打爆 / 被连累',
      '- 无明显被针对者',
      '## 关键证据',
      '- 数字'
    ].join('\n')
    const out = resectionByLabels(md, verdicts)
    const effort = out.split('## 谁尽力了')[1].split('## ')[0]
    const blame = out.split('## 谁要背锅')[1].split('## ')[0]
    const crushed = out.split('## 谁被打爆')[1].split('## ')[0]
    expect(effort).toContain('甲甲#111')
    expect(effort).not.toContain('乙乙#222')
    expect(blame).toContain('乙乙#222')
    expect(blame).not.toContain('丙丙#333')
    expect(crushed).toContain('丙丙#333')
  })

  it('label=正常 的条目从人物章节移除(降级后的矛盾文案不给用户看)', () => {
    const md = [
      '## 谁要背锅',
      '- 丁丁#444：队伍仍输,属于被连累 — 8.2%伤害',
      '## 关键证据',
      '- x'
    ].join('\n')
    const out = resectionByLabels(md, verdicts)
    expect(out).not.toContain('丁丁#444')
  })

  it('清空后的章节补canonical空态文案,不留空章节', () => {
    const md = ['## 谁尽力了', '- 乙乙#222：开团机器', '## 关键证据', '- x'].join('\n')
    const out = resectionByLabels(md, verdicts)
    const effort = out.split('## 谁尽力了')[1].split('## ')[0]
    expect(effort.trim().length).toBeGreaterThan(0)
    expect(effort).not.toContain('乙乙#222')
  })

  it('名册外的条目与非人物章节原样保留;无 verdicts 原样返回', () => {
    const md = ['## 谁尽力了', '- 路人#999：不在名册', '## 关键证据', '- 数字1'].join('\n')
    expect(resectionByLabels(md, verdicts)).toContain('路人#999')
    expect(resectionByLabels(md, [])).toBe(md)
  })

  it('流式不完整 markdown 不抛异常', () => {
    expect(() => resectionByLabels('## 谁尽', verdicts)).not.toThrow()
  })
})
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
