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

import { stripUngroundedSentences, extractNumbers } from '../postprocess'

describe('stripUngroundedSentences(单人复盘数字接地过滤)', () => {
  // 材料数字:8/3/18 KDA、参团 75、dpm 930.5、伤害占比 21 vs 15.1、经济 23.9 vs 20.9
  const allowed = new Set([8, 3, 18, 75, 930.5, 21, 15.1, 23.9, 20.9, 1.78])

  it('数字全部来自材料的句子原样保留', () => {
    const md = ['## 对位对比', '- KDA:8 vs 1.78,你把对面当提款机。'].join('\n')
    expect(stripUngroundedSentences(md, allowed)).toBe(md)
  })

  it('编造数字的句子被整句剔除,同段其余句子保留(真机:14次死亡/参团25%均不在材料)', () => {
    const md = [
      '## 责任归因',
      '你没拖后腿。数字上是负资产——14次死亡、参团率25%。但也没扛起大旗。'
    ].join('\n')
    const out = stripUngroundedSentences(md, allowed)
    expect(out).not.toContain('14次死亡')
    expect(out).not.toContain('25%')
    expect(out).toContain('你没拖后腿。')
    expect(out).toContain('但也没扛起大旗。')
  })

  it('bullet 只剩编造数字时整行删除', () => {
    const md = ['## 数据面板解读', '- 18次助攻,场均2.4次助攻,天花板。', '- 参团率75%没得黑。'].join(
      '\n'
    )
    const out = stripUngroundedSentences(md, allowed)
    expect(out).not.toContain('2.4')
    expect(out).toContain('参团率75%没得黑。')
  })

  it('标题/空行/无数字句不受影响', () => {
    const md = ['## 一句话定档', '', '打野位的人形复活甲。'].join('\n')
    expect(stripUngroundedSentences(md, allowed)).toBe(md)
  })

  it('千分位数字按去逗号后的值判断', () => {
    const withComma = new Set([3045])
    expect(stripUngroundedSentences('被压3,045经济。', withComma)).toBe('被压3,045经济。')
  })

  it('allowed 为空时不过滤(无材料可依,宁可放行)', () => {
    const md = '- 14次死亡。'
    expect(stripUngroundedSentences(md, new Set())).toBe(md)
  })

  it('流式不完整输入不抛异常', () => {
    expect(() => stripUngroundedSentences('## 责任', allowed)).not.toThrow()
    expect(stripUngroundedSentences('', allowed)).toBe('')
  })
})

describe('extractNumbers', () => {
  it('提取整数/小数/千分位并去重', () => {
    const s = extractNumbers('kda 1.78, dpm 930.5, gold 3,045, kp 75% 75%')
    expect(s.has(1.78)).toBe(true)
    expect(s.has(930.5)).toBe(true)
    expect(s.has(3045)).toBe(true)
    expect(s.has(75)).toBe(true)
  })
})
