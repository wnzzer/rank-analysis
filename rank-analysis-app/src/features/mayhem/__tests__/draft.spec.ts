/**
 * 选人期助手纯逻辑单测：bench 打分与阵容缺口启发式。
 */
import { describe, expect, it } from 'vitest'

import { compositionGaps, scoreBench, type ChampMetaMap } from '../draft'

const META: ChampMetaMap = {
  67: { tier: 1, roles: ['marksman'] }, // 薇恩 T1 AD
  223: { tier: 1, roles: ['tank'] }, // 塔姆 T1 坦
  875: { tier: 1, roles: ['fighter', 'tank'] },
  63: { tier: 2, roles: ['mage'] }, // 布兰德 T2 AP
  555: { tier: 4, roles: ['support', 'assassin'] } // 派克 T4
}

describe('scoreBench', () => {
  it('按 T 级降序排序并产出理由', () => {
    const out = scoreBench([555, 67], META)
    expect(out[0].championId).toBe(67)
    expect(out[0].reasons.some(r => r.startsWith('T1'))).toBe(true)
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it('我的历史（≥10 场）可以翻转 T 级劣势', () => {
    // 派克 T4(40) + 我的 70% 胜率(+40) = 80 ≈ T1 无个人数据(100)? 需要更大优势：
    const mine = { 555: { games: 30, wins: 27 } } // 90% → +80 → 120 > T1 的 100
    const out = scoreBench([67, 555], META, mine)
    expect(out[0].championId).toBe(555)
    expect(out[0].reasons.join(' ')).toContain('90%')
  })

  it('样本不足时不参与胜率加成且理由如实', () => {
    const out = scoreBench([67], META, { 67: { games: 3, wins: 3 } })
    expect(out[0].reasons).toContain('我的样本不足')
  })
})

describe('compositionGaps', () => {
  it('无坦克时前排缺口优先提示', () => {
    const g = compositionGaps([67, 63], META)
    expect(g.tanks).toBe(0)
    expect(g.sentence).toContain('缺前排')
  })

  it('缺 AP / 缺 AD 分别识别', () => {
    const noAp = compositionGaps([67, 875], META)
    expect(noAp.sentence).toContain('缺 AP')

    const noAd = compositionGaps([63, 555], META)
    expect(noAd.sentence).toContain('缺 AD')
  })

  it('均衡阵容给正面结论', () => {
    // 875 含 fighter+tank：算坦克也算 adish；63 mage=AP
    const g = compositionGaps([875, 63], META)
    expect(g.sentence).toBe('阵容均衡')
  })
})
