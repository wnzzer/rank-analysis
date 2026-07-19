import { describe, it, expect } from 'vitest'
import { buildStage2PlayerPrompt } from '../prompts/stage2-player'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

function makePlayer(opts: {
  participantId: number
  teamId: number
  name: string
  champion: string
  teamPosition: string
  win: boolean
}) {
  return {
    ...opts,
    isMe: false,
    kda: 3.0,
    kills: 5,
    deaths: 3,
    assists: 7,
    gold: 12000,
    cs: 180,
    damage: 20000,
    taken: 15000,
    heal: 2000,
    turretDamage: 3000,
    damageShare: 25,
    damageTakenShare: 20,
    goldShare: 21,
    killParticipation: 60,
    dpm: 660,
    gpm: 400,
    csm: 6,
    wardScore: 20,
    multiKills: { double: 1, triple: 1, quadra: 0, penta: 0 },
    recentProfile: null
  }
}

function makeSnapshot(players: any[]): MatchSnapshot {
  return {
    gameId: 1,
    queueName: '单双排位',
    queueId: 420,
    gameMode: 'CLASSIC',
    durationSeconds: 1800,
    modeContext: classifyMode(420, 'CLASSIC'),
    teams: [],
    players
  } as unknown as MatchSnapshot
}

const target = makePlayer({
  participantId: 4,
  teamId: 100,
  name: '幽默的二次元#12510',
  champion: '赏金猎人',
  teamPosition: 'BOTTOM',
  win: true
})
const laneOpponent = makePlayer({
  participantId: 9,
  teamId: 200,
  name: '对面AD#1',
  champion: '虚空之女',
  teamPosition: 'BOTTOM',
  win: false
})

const attribution: AttributionResult = {
  winReason: '下路碾压',
  verdicts: [
    {
      participantId: 4,
      name: '幽默的二次元#12510',
      label: '尽力',
      champion: '赏金猎人',
      teamPosition: 'BOTTOM',
      teamResult: '胜方',
      evidenceMetrics: [
        { metric: 'damageShare', value: 25 },
        { metric: 'kda', value: 3.0 },
        { metric: 'kills', value: 5 }
      ],
      mitigatingFactors: [],
      finalCall: '下路核心'
    }
  ]
}

describe('buildStage2PlayerPrompt', () => {
  it('includes 目标玩家区块（名字/英雄/多杀等快照数据）', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 4, [])
    expect(prompt).toContain('【目标玩家】')
    expect(prompt).toContain('幽默的二次元#12510')
    expect(prompt).toContain('赏金猎人')
    expect(prompt).toContain('"triple":1')
  })

  it('includes 对位玩家区块 when 敌方存在同分路玩家', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 4, [])
    expect(prompt).toContain('【对位玩家】')
    expect(prompt).toContain('虚空之女')
  })

  it('shows 无对位固定句 when 无同分路对手', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target]), 4, [])
    expect(prompt).toContain('无同位对位数据')
  })

  it('includes 目标玩家的整局归因 verdict', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 4, [])
    expect(prompt).toContain('【整局归因中的判定】')
    expect(prompt).toContain('尽力')
  })

  it('shows 未列入归因固定句 when 目标无 verdict', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 9, [])
    expect(prompt).toContain('该玩家未被列入整局归因')
  })

  it('includes 单人模板章节与硬规则', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 4, [])
    expect(prompt).toContain('## 一句话定档')
    expect(prompt).toContain('## 数据面板解读')
    expect(prompt).toContain('## 对位对比')
    expect(prompt).toContain('## 责任归因')
    expect(prompt).toContain('## 改进建议')
    expect(prompt).toContain('不能编造新数字')
    expect(prompt).toContain('只能照抄材料')
  })

  it('forbids 装备推荐/击杀归属编造，且声明 null=无数据', () => {
    const prompt = buildStage2PlayerPrompt(attribution, makeSnapshot([target, laneOpponent]), 4, [])
    expect(prompt).toContain('禁止推荐或点评具体装备')
    expect(prompt).toContain('击杀归属')
    expect(prompt).toContain('null 表示无数据')
  })
})
