import { describe, it, expect } from 'vitest'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'

function makeSnapshot(opts: { queueId?: number; gameMode?: string } = {}): MatchSnapshot {
  const modeContext = classifyMode(opts.queueId ?? 420, opts.gameMode ?? 'CLASSIC')
  return {
    gameId: 1,
    queueName: '测试模式',
    queueId: opts.queueId ?? 420,
    gameMode: opts.gameMode ?? 'CLASSIC',
    durationSeconds: 1800,
    modeContext,
    teams: [],
    players: []
  } as unknown as MatchSnapshot
}

describe('buildStage2Prompt — 锐评硬规则', () => {
  const attribution: AttributionResult = {
    winReason: '测试',
    verdicts: [
      {
        participantId: 1,
        name: '玩家A',
        label: '被连累',
        champion: '圣枪游侠',
        teamPosition: 'BOTTOM',
        teamResult: '败方',
        evidenceMetrics: [{ metric: 'kda', value: 0.5 }],
        mitigatingFactors: [],
        finalCall: '测试'
      }
    ]
  } as unknown as AttributionResult

  it('禁止过程性行为叙事(防"队友死了他还在刷野"式编造)', () => {
    const prompt = buildStage2Prompt(attribution, makeSnapshot(), [])
    expect(prompt).toContain('过程性行为叙事')
    expect(prompt).toContain('timeline')
  })

  it('措辞立场必须与 label 一致(被连累不许写成拖后腿)', () => {
    const prompt = buildStage2Prompt(attribution, makeSnapshot(), [])
    expect(prompt).toContain('措辞立场必须与 label 一致')
    expect(prompt).toContain('受害者')
  })

  it('名册没给分路的玩家不得提及分路', () => {
    const prompt = buildStage2Prompt(attribution, makeSnapshot(), [])
    expect(prompt).toContain('名册没给分路的玩家')
  })
})

import { buildStage2Prompt } from '../prompts/stage2-critique'
import type { AttributionResult } from '../types'

describe('buildStage2Prompt', () => {
  const sampleAttribution: AttributionResult = {
    winReason: '蓝方运营优势滚雪球',
    verdicts: [
      {
        participantId: 1,
        name: '测试玩家',
        label: '尽力',
        evidenceMetrics: [
          { metric: 'kda', value: 5.2 },
          { metric: 'damageShare', value: 32 },
          { metric: 'killParticipation', value: 75 }
        ],
        mitigatingFactors: [],
        finalCall: '伤害 32%，参团 75%，扛起整局'
      }
    ]
  }

  it('injects modeContext.description', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain(snap.modeContext.description)
  })

  it('embeds attribution JSON', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('蓝方运营优势滚雪球')
    expect(prompt).toContain('测试玩家')
  })

  it('includes the strict markdown template section headers', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('## 一句话定论')
    expect(prompt).toContain('## 谁尽力了')
    expect(prompt).toContain('## 谁要背锅')
    expect(prompt).toContain('## 谁被打爆')
    expect(prompt).toContain('## 关键证据')
  })

  it('forbids 辱骂 / 地域黑 / 人身攻击', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('辱骂')
    expect(prompt).toContain('地域黑')
    expect(prompt).toContain('人身攻击')
  })

  it('injects vocab samples when provided', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, ['抽象', '丝血反杀', '0换4'])
    expect(prompt).toContain('抽象')
    expect(prompt).toContain('丝血反杀')
    expect(prompt).toContain('0换4')
  })

  it('falls back to 自由发挥 hint when vocab is empty', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toMatch(/自由发挥|无固定词库/)
  })

  it('名册行附对位差值的方向词(模型自己判正负会写反,真机 Muggle丶 落后写成领先)', () => {
    const snap = {
      ...makeSnapshot(),
      players: [
        {
          participantId: 7,
          vsLaneOpponent: {
            opponentChampion: '盲僧',
            goldDiff: -1885,
            csDiff: 0,
            damageShareDiff: -7.6
          }
        }
      ]
    } as unknown as MatchSnapshot
    const attribution = {
      ...sampleAttribution,
      verdicts: [{ ...sampleAttribution.verdicts[0], participantId: 7, name: 'Muggle丶' }]
    }
    const prompt = buildStage2Prompt(attribution, snap, [])
    expect(prompt).toContain('｜终局对位盲僧：经济落后 1885、补刀持平、伤害占比落后 7.6%')
  })

  it('renders 玩家名册 from backfilled verdict fields（英雄/分路/胜负/label）', () => {
    const snap = makeSnapshot()
    const attribution: AttributionResult = {
      winReason: '下路碾压',
      verdicts: [
        {
          ...sampleAttribution.verdicts[0],
          name: '幽默的二次元',
          champion: '赏金猎人',
          teamPosition: 'BOTTOM',
          teamResult: '胜方',
          label: '尽力'
        },
        {
          ...sampleAttribution.verdicts[0],
          participantId: 8,
          name: '天神下凡来撸',
          champion: '天神下凡英雄',
          teamPosition: 'JUNGLE',
          teamResult: '败方',
          label: '被连累'
        }
      ]
    }
    const prompt = buildStage2Prompt(attribution, snap, [])
    expect(prompt).toContain('【玩家名册】')
    expect(prompt).toContain('幽默的二次元｜赏金猎人｜下路｜胜方｜尽力')
    expect(prompt).toContain('天神下凡来撸｜天神下凡英雄｜打野｜败方｜被连累')
  })

  it('omits 分路 segment in 名册 when teamPosition 为空（无分路模式）', () => {
    const snap = makeSnapshot()
    const attribution: AttributionResult = {
      winReason: 'x',
      verdicts: [
        {
          ...sampleAttribution.verdicts[0],
          name: '大乱斗玩家',
          champion: '光辉女郎',
          teamPosition: '',
          teamResult: '胜方',
          label: '正常'
        }
      ]
    }
    const prompt = buildStage2Prompt(attribution, snap, [])
    expect(prompt).toContain('大乱斗玩家｜光辉女郎｜胜方｜正常')
  })

  it('states label→章节 固定映射（败方被连累不得进谁尽力了）', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('尽力 →「谁尽力了」')
    expect(prompt).toContain('犯罪/缚地灵 →「谁要背锅」')
    expect(prompt).toContain('被爆/被连累 →「谁被打爆 / 被连累」')
  })

  it('forbids 同一玩家重复上榜多个章节', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('只能出现在自己 label 对应的那一个章节')
  })

  it('forbids 名册外分路 and 材料外数据性比较', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('只能照抄【玩家名册】')
    expect(prompt).toContain('数据性比较')
  })

  it('forbids 装备/符文推荐（材料无出装数据）', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('禁止推荐或点评具体装备')
  })

  it('hasLanes=false 时确定性注入分路词禁令；ranked 不注入', () => {
    const aramSnap = makeSnapshot({ queueId: 450, gameMode: 'ARAM' })
    const aramPrompt = buildStage2Prompt(sampleAttribution, aramSnap, [])
    expect(aramPrompt).toContain('本模式无分路')
    const rankedPrompt2 = buildStage2Prompt(sampleAttribution, makeSnapshot(), [])
    expect(rankedPrompt2).not.toContain('本模式无分路')
  })
})
