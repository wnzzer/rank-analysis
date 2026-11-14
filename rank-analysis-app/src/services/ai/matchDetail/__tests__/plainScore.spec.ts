/**
 * 喂模型的人话评分材料：等级词、分位人话、分路、阵亡归类、分项具体数据。
 */
import { describe, it, expect } from 'vitest'
import {
  deathSummary,
  levelOf,
  levelPhrase,
  partStats,
  percentileOf,
  rankText,
  roleCn,
  type StatContext
} from '../plainScore'

describe('levelOf / levelPhrase', () => {
  it('按阈值分五档（边界含在落后一侧）', () => {
    expect(levelOf(-1.5)).toBe('大幅落后')
    expect(levelOf(-1.49)).toBe('落后')
    expect(levelOf(-0.5)).toBe('落后')
    expect(levelOf(-0.49)).toBe('持平')
    expect(levelOf(0.49)).toBe('持平')
    expect(levelOf(0.5)).toBe('领先')
    expect(levelOf(1.49)).toBe('领先')
    expect(levelOf(1.5)).toBe('大幅领先')
  })

  it('措辞：落后/领先 + 平均水平；持平单独措辞', () => {
    expect(levelPhrase('大幅落后')).toBe('大幅落后同位置同英雄的平均水平')
    expect(levelPhrase('领先')).toBe('领先同位置同英雄的平均水平')
    expect(levelPhrase('持平')).toBe('与同位置同英雄的平均水平持平')
  })
})

describe('percentileOf / rankText', () => {
  const d = [-0.8, -0.55, -0.35, -0.15, 0, 0.15, 0.3, 0.55, 0.85]

  it('在十分位间线性插值；两端夹到 5 / 95', () => {
    expect(percentileOf(0, d)).toBeCloseTo(50)
    expect(percentileOf(-0.25, d)).toBeCloseTo(35)
    expect(percentileOf(-2, d)).toBe(5)
    expect(percentileOf(2, d)).toBe(95)
  })

  it('取整到 5；≥ P50 用「前」，否则「后」', () => {
    expect(rankText(35)).toBe('大约处于同位置玩家的后 35%')
    expect(rankText(37.4)).toBe('大约处于同位置玩家的后 35%')
    expect(rankText(50)).toBe('大约处于同位置玩家的前 50%')
    expect(rankText(81)).toBe('大约处于同位置玩家的前 20%')
    expect(rankText(99)).toBe('大约处于同位置玩家的前 5%')
    expect(rankText(1)).toBe('大约处于同位置玩家的后 5%')
  })
})

describe('roleCn', () => {
  it('五个位置的中文名；无分路模式写无分路；有分路但未知写分路未知', () => {
    expect(roleCn('TOP', true)).toBe('上单')
    expect(roleCn('JUNGLE', true)).toBe('打野')
    expect(roleCn('MIDDLE', true)).toBe('中单')
    expect(roleCn('BOTTOM', true)).toBe('下路（ADC）')
    expect(roleCn('UTILITY', true)).toBe('辅助')
    expect(roleCn('BOTTOM', false)).toBe('无分路')
    expect(roleCn('UNKNOWN', true)).toBe('分路未知')
  })
})

describe('deathSummary', () => {
  it('按责任写明各类次数，省略 0 次的类，固定顺序', () => {
    const kinds = [
      'fight',
      'isolated',
      'collapse',
      'other',
      'isolated',
      'solo',
      'ganked',
      'collapse',
      'fight',
      'isolated',
      'other'
    ] as const
    expect(deathSummary([...kinds], 11)).toBe(
      '11 次阵亡：孤立被杀 3 次（自身问题）、被对位单杀 1 次（自身问题）、被对面打野/游走抓 1 次（部分责任）、队友先倒下后阵亡 2 次（情有可原）、团战中阵亡 2 次、其他 2 次'
    )
    expect(deathSummary(['ganked'], 1)).toBe('1 次阵亡：被对面打野/游走抓 1 次（部分责任）')
  })

  it('无时间线 / 未阵亡', () => {
    expect(deathSummary(null, 7)).toBe('阵亡 7 次（无时间线，无法细分）')
    expect(deathSummary([], 0)).toBe('本局未阵亡')
  })
})

describe('partStats', () => {
  const ctx: StatContext = {
    player: {
      participantId: 4,
      deaths: 11,
      killParticipation: 48.5,
      csm: 7.23,
      gpm: 410.4,
      dpm: 812.6,
      damage: 24000,
      gold: 15000,
      wardScore: 30,
      objectiveDamage: 9000
    },
    metrics: {
      goldDiff14: -1209.4,
      xpDiff14: -300,
      csDiff14: -39,
      deathCostPerMin: 0.5,
      laneDeathResponsibility: 2,
      fightAbsenceRate: 0.3,
      fightFirstDeathRate: 0.1,
      objectiveParticipation: 0.6,
      controlWardsPerMin: 0.1,
      gankKills: 3,
      roamKills: 2,
      partnerAbsences: 1
    },
    minutes: 30,
    fights: [{ subjects: [1, 4] }, { subjects: [1, 2] }, { subjects: [4] }],
    deaths: ['solo', 'isolated', 'fight'],
    hasLanes: true
  }

  it('每个分项 1~2 条真实数据，数字取整得当', () => {
    expect(partStats('lane', ctx)).toEqual(['14 分钟对位经济落后 1209', '补刀落后 39'])
    expect(partStats('teamfight', ctx)).toEqual(['参团率 48.5%', '3 场团战缺席 1 场'])
    expect(partStats('deathQuality', ctx)).toEqual(['阵亡 11 次', '其中自身问题 2 次'])
    expect(partStats('growth', ctx)).toEqual(['每分钟补刀 7.2', '每分钟经济 410'])
    expect(partStats('resources', ctx)).toEqual([
      '己方大型野怪资源在场率 60%',
      '每分钟对建筑/野怪伤害 300'
    ])
    expect(partStats('vision', ctx)).toEqual(['每分钟视野得分 1', '插控制守卫 3 个'])
  })

  it('作为缺位搭档被分担责任时，死亡质量写出次数', () => {
    expect(partStats('deathQuality', { ...ctx, partnerAbsences: 2 })).toEqual([
      '阵亡 11 次',
      '其中自身问题 2 次',
      '下路搭档阵亡时不在身边 2 次'
    ])
    expect(partStats('deathQuality', { ...ctx, partnerAbsences: 0 })).toHaveLength(2)
  })

  it('职责按位置取数据：打野看抓人、中单/辅助看游走（缺位写在死亡质量）；其他位置为空', () => {
    expect(partStats('duty', { ...ctx, position: 'JUNGLE' })).toEqual(['对线期到线上参与击杀 3 次'])
    expect(partStats('duty', { ...ctx, position: 'MIDDLE' })).toEqual(['对线期离线参与击杀 2 次'])
    expect(partStats('duty', { ...ctx, position: 'UTILITY' })).toEqual(['对线期离线参与击杀 2 次'])
    expect(partStats('duty', { ...ctx, position: 'TOP' })).toEqual([])
    expect(partStats('duty', { ...ctx, position: 'JUNGLE', metrics: null })).toEqual([])
  })

  it('领先写领先、持平写持平；缺数据的项跳过', () => {
    const c: StatContext = {
      ...ctx,
      metrics: { ...ctx.metrics!, goldDiff14: 800, csDiff14: 0 },
      player: { ...ctx.player, wardScore: null, objectiveDamage: null }
    }
    expect(partStats('lane', c)).toEqual(['14 分钟对位经济领先 800', '补刀持平'])
    expect(partStats('vision', c)).toEqual(['插控制守卫 3 个'])
    const noTl: StatContext = { ...c, metrics: null, fights: [], deaths: null }
    expect(partStats('lane', noTl)).toEqual([])
    expect(partStats('teamfight', noTl)).toEqual(['参团率 48.5%'])
    expect(partStats('deathQuality', noTl)).toEqual(['阵亡 11 次'])
    expect(partStats('resources', noTl)).toEqual([])
  })

  it('无分路模式发育看伤害经济比', () => {
    expect(partStats('growth', { ...ctx, hasLanes: false })).toEqual([
      '每分钟伤害 813',
      '伤害经济比 1.6'
    ])
  })
})
