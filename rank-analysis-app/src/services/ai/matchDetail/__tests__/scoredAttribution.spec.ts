/**
 * TS 归因骨架：名单/标签来自评分，finalCall/winReason 为模板句，【表现评估】渲染格式。
 * 喂模型的部分（归因 JSON 与表现评估块）不得出现原始分数、分位段。
 */
import { describe, it, expect } from 'vitest'
import { buildMatchSnapshot } from '../../shared/snapshot'
import {
  EMPTY_SCORING_DATA as EMPTY_DATA,
  makeScoringGame,
  makeScoringTimeline
} from '../../shared/__tests__/scoringFixtures'
import { buildScoredAttribution, renderScoreBlock, SCORE_BLOCK_HEADER } from '../scoredAttribution'
import type { ScoreBrief } from '../types'
import { DEFAULT_SCORING_DATA } from '../../shared/scoring/match'

/** 原始分数的痕迹：分位段、带符号一位小数、"总分" */
const RAW_SCORE = /P\d0|[-+]\d+\.\d|总分|分项分/

describe('buildScoredAttribution', () => {
  const snap = buildMatchSnapshot(makeScoringGame())
  const a = buildScoredAttribution(snap, EMPTY_DATA)

  it('名单 4-7 人、含本人；名册字段回填；证据是具体数据；finalCall 以 label 开头、写分位人话', () => {
    expect(a.verdicts.length).toBeGreaterThanOrEqual(4)
    expect(a.verdicts.length).toBeLessThanOrEqual(7)
    expect(a.verdicts.map(v => v.participantId)).toContain(1)
    for (const v of a.verdicts) {
      expect(v.evidenceMetrics.map(m => m.metric)).toEqual(['kda', 'deaths', 'killParticipation'])
      expect(v.finalCall).toMatch(new RegExp(`^${v.label}：大约处于同位置玩家的[前后] \\d+%`))
      expect(v.champion).toBeTruthy()
      expect(v.teamResult).toBe(v.participantId <= 5 ? '胜方' : '败方')
    }
  })

  it('喂模型的归因 JSON 不含原始分数', () => {
    expect(JSON.stringify({ winReason: a.winReason, verdicts: a.verdicts })).not.toMatch(RAW_SCORE)
  })

  it('全员都有评分拆解（内部仍保留分数）；分路中文；无时间线 deaths 为 null', () => {
    expect(Object.keys(a.scores!)).toHaveLength(10)
    expect(a.scores![1].deaths).toBeNull()
    expect(a.scores![1].deathSummary).toBe('阵亡 10 次（无时间线，无法细分）')
    expect(a.scores![4].role).toBe('下路（ADC）')
    expect(typeof a.scores![1].total).toBe('number')
    for (const part of a.scores![1].parts) expect(part.level).toBeTruthy()
  })

  it('winReason 是胜方视角的模板句', () => {
    expect(a.winReason.startsWith('蓝方')).toBe(true)
  })

  it('确定性', () => {
    expect(buildScoredAttribution(snap, EMPTY_DATA)).toEqual(a)
  })

  it('胜方每项队均都不如败方：中性措辞，不写"优势最大"，不带分数', () => {
    const g = makeScoringGame()
    const poor = {
      kills: 0,
      deaths: 10,
      assists: 0,
      totalDamageDealtToChampions: 1000,
      goldEarned: 5000,
      damageDealtToObjectives: 0,
      timeCCingOthers: 0,
      visionScore: 0,
      totalMinionsKilled: 10,
      neutralMinionsKilled: 0
    }
    for (const p of g.participants) if (p.participantId <= 5) Object.assign(p.stats, poor)
    const w = buildScoredAttribution(buildMatchSnapshot(g), DEFAULT_SCORING_DATA).winReason
    expect(w).not.toContain('优势最大')
    expect(w).toBe('蓝方获胜，但没有哪一项整体占优（差距最小的是视野）。')
  })

  it('有时间线：死亡归责带 D 卡编号与类型', () => {
    const tlSnap = buildMatchSnapshot(makeScoringGame(), undefined, makeScoringTimeline())
    const b = buildScoredAttribution(tlSnap, EMPTY_DATA)
    expect(b.scores![6].deaths).toEqual([
      { cardId: 'D1', time: '5:00', kind: 'solo', responsibility: 1 }
    ])
    expect(b.scores![6].deathSummary).toBe('1 次阵亡：被对位单杀 1 次（自身问题）')
  })
})

describe('renderScoreBlock', () => {
  const brief: ScoreBrief = {
    total: -0.9,
    band: 'P10~P20',
    label: '被爆',
    role: '下路（ADC）',
    rank: '大约处于同位置玩家的后 15%',
    parts: [
      {
        key: 'lane',
        cn: '对线',
        value: -1.6,
        level: '大幅落后',
        stats: ['14 分钟对位经济落后 1209', '补刀落后 39']
      },
      { key: 'teamfight', cn: '团战', value: 0.3, level: '持平', stats: [] }
    ],
    deaths: [
      { cardId: 'D3', time: '14:32', kind: 'solo', responsibility: 1 },
      { cardId: 'D9', time: '20:10', kind: 'fight', responsibility: 0.6 }
    ],
    deathSummary: '2 次阵亡：被对位单杀 1 次（自身问题）、团战中阵亡 1 次',
    mitigation: ['阵亡 4 次中 2 次是被抓或队友先倒下']
  }

  it('分路开头 + 分位人话 + 等级词与数据 + 减责证据 + 阵亡归类与明细（不可见的卡不写编号）', () => {
    expect(renderScoreBlock([{ name: '玩家4#0000', brief }], new Set(['D3']))).toBe(
      [
        SCORE_BLOCK_HEADER,
        '- 下路（ADC）｜玩家4#0000｜被爆｜整体：大约处于同位置玩家的后 15%',
        '  对线：大幅落后同位置同英雄的平均水平（14 分钟对位经济落后 1209、补刀落后 39）',
        '  团战：与同位置同英雄的平均水平持平',
        '  减责证据：阵亡 4 次中 2 次是被抓或队友先倒下',
        '  阵亡情况：2 次阵亡：被对位单杀 1 次（自身问题）、团战中阵亡 1 次',
        '  阵亡明细：[D3] 14:32 被对位单杀（自身问题）；20:10 团战中阵亡'
      ].join('\n')
    )
  })

  it('不出现原始分数与分位段', () => {
    expect(renderScoreBlock([{ name: 'A', brief }], null)).not.toMatch(RAW_SCORE)
  })

  it('无时间线 / 未阵亡：只有归类行；无减责证据不出该行', () => {
    const noTl = renderScoreBlock(
      [
        {
          name: 'A',
          brief: {
            ...brief,
            deaths: null,
            deathSummary: '阵亡 7 次（无时间线，无法细分）',
            mitigation: []
          }
        }
      ],
      null
    )
    expect(noTl).toContain('  阵亡情况：阵亡 7 次（无时间线，无法细分）')
    expect(noTl).not.toContain('阵亡明细')
    expect(noTl).not.toContain('减责证据')
    const none = renderScoreBlock(
      [{ name: 'A', brief: { ...brief, deaths: [], deathSummary: '本局未阵亡' } }],
      null
    )
    expect(none).toContain('  阵亡情况：本局未阵亡')
    expect(none).not.toContain('阵亡明细')
  })

  it('被连累：列出落后及以下的最低至多 2 项为短板（等级词 + 数据）；没有落后项不出该行', () => {
    const carry: ScoreBrief = {
      ...brief,
      total: 0.1,
      band: 'P50~P60',
      label: '被连累',
      parts: [
        { key: 'lane', cn: '对线', value: -1.8, level: '大幅落后', stats: ['补刀落后 39'] },
        { key: 'teamfight', cn: '团战', value: 1.9, level: '大幅领先', stats: [] },
        { key: 'deathQuality', cn: '死亡质量', value: -1, level: '落后', stats: ['阵亡 11 次'] },
        { key: 'growth', cn: '发育', value: -0.4, level: '持平', stats: [] }
      ],
      deaths: [],
      deathSummary: '本局未阵亡',
      mitigation: []
    }
    expect(renderScoreBlock([{ name: 'A', brief: carry }], null)).toContain(
      '  短板：对线大幅落后（补刀落后 39）、死亡质量落后（阵亡 11 次）'
    )
    const clean = { ...carry, parts: carry.parts.filter(x => x.value > -0.5) }
    expect(renderScoreBlock([{ name: 'A', brief: clean }], null)).not.toContain('短板')
  })

  it('无行时返回空串', () => {
    expect(renderScoreBlock([], null)).toBe('')
  })
})
