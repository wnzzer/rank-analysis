import { describe, it, expect } from 'vitest'
import { normalizeCitations, repairCitations, resectionByLabels } from '../postprocess'

describe('normalizeCitations', () => {
  it('trims inner spaces and uppercases the card prefix', () => {
    expect(normalizeCitations('他送了 [ I4 ]，又死 [d12]。')).toBe('他送了 [I4]，又死 [D12]。')
  })

  it('removes letter-only bracket tags and collapses the leftover space', () => {
    expect(normalizeCitations('你 [TS] 补刀 [ ts ] 落后。')).toBe('你 补刀 落后。')
    expect(normalizeCitations('- [TS] 开头条目')).toBe('- 开头条目')
    expect(normalizeCitations('[TS] 行首')).toBe('行首')
  })

  it('leaves valid ids, non-card letters+digits, markdown links and long words alone', () => {
    const s = '[D4] 见 [X9] 与 [链接](http://a.b) 和 [abcde] 以及 [ab](http://c.d)'
    expect(normalizeCitations(s)).toBe(s)
  })

  it('is a no-op on text without brackets', () => {
    expect(normalizeCitations('普通文本 14:32')).toBe('普通文本 14:32')
  })
})

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

  it('名册外的玩家(带 名字#数字)不上人物章节:没有 verdict 就没有定性', () => {
    // 真机 301039452606:北辰之威丶不在名册,却被模型写进「谁要背锅」
    const md = ['## 谁要背锅', '- 路人#999：送人头打卡', '## 关键证据', '- 路人#999 死亡 14'].join(
      '\n'
    )
    const out = resectionByLabels(md, verdicts)
    expect(out).toContain('## 谁要背锅\n- 本局没人能甩锅')
    // 关键证据章节不是人物章节,名册外玩家可以出现
    expect(out).toContain('- 路人#999 死亡 14')
  })

  it('人物章节里不带玩家标识的名册外条目原样保留;无 verdicts 原样返回', () => {
    const md = ['## 谁尽力了', '- 某位路人：不在名册', '## 关键证据', '- 数字1'].join('\n')
    expect(resectionByLabels(md, verdicts)).toContain('某位路人')
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

describe('repairCitations', () => {
  const cards = [
    { id: 'D1', text: '1:34 卡莎(玩家4) 死于下半河道' },
    { id: 'D2', text: '1:59 卡莎(玩家4) 死于上半河道' },
    { id: 'F1', text: '20:10 大龙坑团战' },
    { id: 'F2', text: '20:10 另一场大龙坑团战' },
    { id: 'T1', text: '18:00-20:00 经济转折' }
  ]

  it('swaps the id when exactly one visible card contains the time', () => {
    expect(repairCitations('1:59 卡莎死于河道 [D1]。', cards)).toBe('1:59 卡莎死于河道 [D2]。')
  })

  it('removes the citation (and the leftover space) when ambiguous', () => {
    expect(repairCitations('20:10 大龙团战 [D1] 输了。', cards)).toBe('20:10 大龙团战 输了。')
  })

  it('removes the citation when no card contains the time', () => {
    expect(repairCitations('9:99 的事 [D1]。', cards)).toBe('9:99 的事。')
  })

  it('leaves citations without times, with correct times and with unknown ids untouched', () => {
    const s = '他送得很凶 [D1]。1:34 死了 [D1]。1:59 死了 [D9]。'
    expect(repairCitations(s, cards)).toBe(s)
  })

  it('repairs each citation of a multi-citation sentence on its own segment', () => {
    expect(repairCitations('1:34 死 [D2]，随后 [F1] 20:10 团战。', cards)).toBe(
      '1:34 死 [D1]，随后 [F1] 20:10 团战。'
    )
  })

  it('prefers candidates with the same prefix letter', () => {
    const cs = [
      { id: 'D1', text: '1:34 死亡' },
      { id: 'D2', text: '5:00 死亡' },
      { id: 'I3', text: '5:00 出装' }
    ]
    expect(repairCitations('5:00 死了 [D1]。', cs)).toBe('5:00 死了 [D2]。')
  })

  it('is safe on partial streaming markdown and empty inputs', () => {
    expect(repairCitations('1:59 死了 [D', cards)).toBe('1:59 死了 [D')
    expect(repairCitations('', cards)).toBe('')
    expect(repairCitations('1:59 [D1]', [])).toBe('1:59 [D1]')
  })
})

import { isScoreJargon, stripScoreJargon } from '../postprocess'

describe('stripScoreJargon(评分黑话兜底)', () => {
  it('识别分位/标准差/z 值/总分/分项带符号小数', () => {
    for (const s of [
      '总分-0.2（P30~P40），对线-1.9。',
      '处于 P30 水平。',
      '他排在大盘第 30 分位。',
      '高出 1.2 个标准差。',
      'z 值只有 0.3。',
      'z值偏低。',
      '总分 +0.4 撑场。',
      '对线 -1.9 被压穿。',
      '团战+1.1 打得好。',
      '死亡质量 -1.5 送得多。',
      '视野 −0.8 一片黑。'
    ])
      expect(isScoreJargon(s), s).toBe(true)
  })

  it('不误伤正常数据句', () => {
    for (const s of [
      '14 分钟补刀差 39。',
      '对线落后 1209 经济。',
      '参团率 48.5%，团战 0 换 4。',
      '[D3] 14:32 被单杀，不分位置都该少送。',
      '对线大幅落后同位置同英雄的平均水平。',
      'P3 和 P5 的位置都缺席。',
      '大约处于同位置玩家的后 35%。'
    ])
      expect(isScoreJargon(s), s).toBe(false)
  })

  it('整句剔除，保留同一行的其他句子；整条清空则删行；标题不动', () => {
    const md = [
      '## 一句话定论',
      '- 张三：总分-0.2（P30~P40）。对线落后 1209 经济，被压穿。',
      '- 李四：对线 -1.9。',
      '- 王五：参团率 48.5%。'
    ].join('\n')
    expect(stripScoreJargon(md)).toBe(
      ['## 一句话定论', '- 张三：对线落后 1209 经济，被压穿。', '- 王五：参团率 48.5%。'].join('\n')
    )
  })

  it('空串原样返回', () => {
    expect(stripScoreJargon('')).toBe('')
  })
})
