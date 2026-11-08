/**
 * A/B 评测硬指标函数单测。
 */
import { describe, it, expect } from 'vitest'
import {
  fabricatedNumberRate,
  citationErrors,
  renderedCitationErrors,
  uncitedProcessSentences,
  specificity,
  bogusTagCount,
  labelAgreement,
  percentile,
  scoreJargonCount
} from './metrics'

const cards = [
  { id: 'D2', text: '14:32 卡莎 死于小龙坑' },
  { id: 'F1', text: '20:10 大龙坑团战' }
]

describe('metrics', () => {
  it('fabricatedNumberRate counts numbers absent from prompt', () => {
    expect(fabricatedNumberRate('死了 9 次，参团 25%', '死亡 9 参团 50')).toEqual({
      fabricated: 1,
      total: 2
    })
  })

  it('fabricatedNumberRate ignores card citation ids', () => {
    expect(fabricatedNumberRate('[D12] 死了 9 次，参团 25%', '死亡 9 参团 50')).toEqual({
      fabricated: 1,
      total: 2
    })
  })

  it('edge cases on empty input', () => {
    expect(fabricatedNumberRate('', 'x')).toEqual({ fabricated: 0, total: 0 })
    expect(percentile([], 50)).toBe(0)
    expect(specificity('')).toEqual({ distinctCards: 0, adviceCited: 0, adviceTotal: 0 })
  })

  it('citationErrors flags unknown ids and time mismatches', () => {
    const out = '- [D2] 14:32 被集火。\n- [D9] 乱引。\n- [F1] 21:00 大龙团。'
    expect(citationErrors(out, cards)).toEqual({ errors: 2, total: 3 })
  })

  it('citationErrors accepts spaced / lowercase citations', () => {
    expect(citationErrors('- [ D2 ] 14:32 被集火。\n- [d2] 14:32 又被集火。', cards)).toEqual({
      errors: 0,
      total: 2
    })
  })

  it('citationErrors checks each time only against its nearest citation', () => {
    // 20:10 属于 F1 而不是 D2：旧口径（任意引用命中即可）会放过，新口径要报错
    expect(citationErrors('[D2] 14:32 被集火，[F1] 14:32 团战。', cards)).toEqual({
      errors: 1,
      total: 2
    })
    expect(citationErrors('[D2] 14:32 被集火，[F1] 20:10 团战。', cards)).toEqual({
      errors: 0,
      total: 2
    })
    // 首个引用前的时间归第一个引用
    expect(citationErrors('14:32 被集火 [D2]，随后 [F1] 20:10 团战。', cards)).toEqual({
      errors: 0,
      total: 2
    })
  })

  it('renderedCitationErrors counts what the user sees after repair', () => {
    const cs = [...cards, { id: 'D3', text: '15:00 另一次死亡' }]
    // 换 id 可修；无匹配则摘角标（无引用不计入）；未知 id 整句剔除
    const out = [
      '- 15:00 死了 [D2]。',
      '- 99:00 乱写 [D2]。',
      '- [D9] 乱引。',
      '- [F1] 20:10 团战。'
    ].join('\n')
    expect(citationErrors(out, cs)).toEqual({ errors: 3, total: 4 })
    expect(renderedCitationErrors(out, cs)).toEqual({ errors: 0, total: 2 })
  })

  it('renderedCitationErrors falls back to the raw rate without cards', () => {
    expect(renderedCitationErrors('[D2] 14:32。', [])).toEqual({ errors: 1, total: 1 })
  })

  it('specificity normalizes spaced citations', () => {
    const md = '## 关键时刻\n- [ d2 ] a\n## 改进建议\n- 多参团 [ F1 ]'
    expect(specificity(md)).toEqual({ distinctCards: 2, adviceCited: 1, adviceTotal: 1 })
  })

  it('bogusTagCount counts letter-only bracket tags', () => {
    expect(bogusTagCount('a [TS] b [ ts ] c [D2] [链接](x) [ab](y)')).toBe(2)
    expect(bogusTagCount('')).toBe(0)
  })

  it('uncitedProcessSentences finds process talk without citation', () => {
    expect(uncitedProcessSentences('他 14:32 死于龙坑。[D2] 14:32 死于龙坑。参团 50%。')).toBe(1)
  })

  it('uncitedProcessSentences ignores generic teamfight advice based on end-of-game numbers', () => {
    expect(uncitedProcessSentences('团战别当隐身人，31.4%参团率太低。几乎每次开团都有他。')).toBe(0)
    expect(uncitedProcessSentences('他在河道被抓了两次。')).toBe(1)
  })

  it('specificity counts distinct cards and cited advice ratio', () => {
    const md = '## 关键时刻\n- [D2] a\n- [D2] b\n## 改进建议\n- 多参团 [F1]\n- 少单带'
    expect(specificity(md)).toEqual({ distinctCards: 2, adviceCited: 1, adviceTotal: 2 })
  })

  it('labelAgreement compares two runs', () => {
    expect(
      labelAgreement(
        [
          { participantId: 1, label: '犯罪' },
          { participantId: 2, label: '尽力' }
        ],
        [
          { participantId: 1, label: '犯罪' },
          { participantId: 3, label: '尽力' }
        ]
      )
    ).toBeCloseTo(1 / 3)
  })

  it('percentile', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4], 90)).toBe(4)
  })

  it('scoreJargonCount counts sentences with raw score jargon', () => {
    const out = [
      '## 定论',
      '- 甲：总分-0.2（P30~P40）。对线落后 1209 经济。',
      '- 乙：对线 -1.9，团战+1.1。',
      '- 丙：补刀差 39。'
    ].join('\n')
    expect(scoreJargonCount(out)).toBe(2)
    expect(scoreJargonCount('')).toBe(0)
  })
})
