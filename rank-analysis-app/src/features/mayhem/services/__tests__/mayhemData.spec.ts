/**
 * mayhemData 纯工具函数单测：
 * stripRichText（上游富文本剥离）与 bestStage（分轮统计防御性解析）。
 */
import { describe, expect, it } from 'vitest'

import { bestStage, extractMayhemChampions, stripRichText } from '../mayhemData'
import { queueIdToOpggMode } from '../../../../services/opgg'

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

describe('extractMayhemChampions', () => {
  const dummyChamp = {
    id: 67,
    alias: 'Vayne',
    name: '薇恩',
    title: '暗夜猎手',
    roles: ['marksman'],
    iconUrl: 'https://cdn.dtodo.cn/67.png',
    stats: {
      tier: 1,
      wins: null,
      games: null,
      winRate: 0.57,
      pickRate: 0.13,
      gamePatch: '16.16',
      date: '',
      source: '',
      region: ''
    }
  }

  it('应从上游 data 属性中安全提取英雄列表', () => {
    const res = { total: 1, data: [dummyChamp] }
    expect(extractMayhemChampions(res)).toEqual([dummyChamp])
  })

  it('应从旧版 champions 属性中提取英雄列表', () => {
    const res = { champions: [dummyChamp] }
    expect(extractMayhemChampions(res)).toEqual([dummyChamp])
  })

  it('空值或无匹配时返回空数组', () => {
    expect(extractMayhemChampions(null)).toEqual([])
    expect(extractMayhemChampions(undefined)).toEqual([])
    expect(extractMayhemChampions({})).toEqual([])
  })
})

describe('queueIdToOpggMode', () => {
  it('应正确将极地大乱斗(450)和海克斯大乱斗(2400)映射为 aram 模式', () => {
    expect(queueIdToOpggMode(450)).toBe('aram')
    expect(queueIdToOpggMode(2400)).toBe('aram')
  })

  it('排位或其他常规模式映射为 ranked', () => {
    expect(queueIdToOpggMode(420)).toBe('ranked')
    expect(queueIdToOpggMode(440)).toBe('ranked')
  })
})
