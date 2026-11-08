/**
 * Stage 2 prompt 的【表现评估】注入：整局列点名玩家，单人列目标玩家。
 * 模型不得看到原始分数（总分/分项分/分位段），只看到等级词 + 具体数据 + 带责任的阵亡归类 + 明确分路。
 */
import { describe, it, expect } from 'vitest'
import { buildMatchSnapshot } from '../../shared/snapshot'
import {
  EMPTY_SCORING_DATA as EMPTY_DATA,
  makeScoringGame
} from '../../shared/__tests__/scoringFixtures'
import { buildStage2Prompt } from '../prompts/stage2-critique'
import { buildStage2PlayerPrompt } from '../prompts/stage2-player'
import { buildScoredAttribution } from '../scoredAttribution'
const snap = buildMatchSnapshot(makeScoringGame())
const att = buildScoredAttribution(snap, EMPTY_DATA)

/** 原始分数痕迹 */
const RAW_SCORE = /总分|分项分|P\d0~P\d0|低于 P10|高于 P90|标准差为单位|单位为基准标准差/

const NO_SCORE_RULE =
  '禁止写任何分数、分位、标准差、z 值（如“总分 -0.2”“P30”“对线 -1.9”）；只能用材料里的等级词和具体数据。'
const ROLE_RULE = '分路只能照抄材料里的位置，禁止写别的位置。'
const DEATH_RULE = '阵亡的责任只能按材料里的分类转述：标“自身问题”的不得说成被连累。'

describe('stage2 prompts with scores', () => {
  it('整局：每位点名玩家一行（分路开头）+ 三条人话规则；归因 JSON 不含 scores', () => {
    const p = buildStage2Prompt(att, snap, [])
    expect(p).toContain('【表现评估】')
    for (const v of att.verdicts) {
      const role = att.scores![v.participantId].role
      expect(p).toContain(`- ${role}｜${v.name}｜${v.label}｜整体：大约处于同位置玩家的`)
    }
    expect(p).toContain(NO_SCORE_RULE)
    expect(p).toContain(ROLE_RULE)
    expect(p).toContain(DEATH_RULE)
    expect(p).not.toContain('"scores"')
  })

  it('整局与单人 prompt 除禁令原文的反例外都不含原始分数', () => {
    const material = (p: string) => p.replace(NO_SCORE_RULE, '')
    expect(material(buildStage2Prompt(att, snap, []))).not.toMatch(RAW_SCORE)
    for (const pl of snap.players)
      expect(material(buildStage2PlayerPrompt(att, snap, pl.participantId, []))).not.toMatch(
        RAW_SCORE
      )
  })

  it('单人：目标玩家（即使不在名单里）也有表现评估、立场规则与三条人话规则', () => {
    const outsider = snap.players.find(
      p => !att.verdicts.some(v => v.participantId === p.participantId)
    )!
    const p = buildStage2PlayerPrompt(att, snap, outsider.participantId, [])
    expect(p).toContain(`｜${outsider.name}｜`)
    expect(p).toContain('必须与【表现评估】的 label 立场一致')
    expect(p).toContain(NO_SCORE_RULE)
    expect(p).toContain(ROLE_RULE)
    expect(p).toContain(DEATH_RULE)
  })

  it('没有 scores 时不出表现评估块与相关规则', () => {
    const bare = { winReason: att.winReason, verdicts: att.verdicts }
    for (const p of [
      buildStage2Prompt(bare, snap, []),
      buildStage2PlayerPrompt(bare, snap, 1, [])
    ]) {
      expect(p).not.toContain('【表现评估】')
      expect(p).not.toContain(NO_SCORE_RULE)
      expect(p).not.toContain(DEATH_RULE)
    }
  })

  it('被连累玩家：表现评估列出短板，整局与单人规则都要求点出短板', () => {
    const v = att.verdicts[0]
    const brief = {
      ...att.scores![v.participantId],
      label: '被连累' as const,
      parts: [
        {
          key: 'lane',
          cn: '对线',
          value: -1.8,
          level: '大幅落后' as const,
          stats: ['14 分钟对位经济落后 1209']
        },
        { key: 'teamfight', cn: '团战', value: 1.2, level: '领先' as const, stats: [] }
      ]
    }
    const a2 = {
      ...att,
      verdicts: [{ ...v, label: '被连累' as const }, ...att.verdicts.slice(1)],
      scores: { ...att.scores, [v.participantId]: brief }
    }
    const overview = buildStage2Prompt(a2, snap, [])
    expect(overview).toContain('  短板：对线大幅落后（14 分钟对位经济落后 1209）')
    expect(overview).toContain('被连累玩家在惋惜之外必须点出')
    const player = buildStage2PlayerPrompt(a2, snap, v.participantId, [])
    expect(player).toContain('  短板：对线大幅落后（14 分钟对位经济落后 1209）')
    expect(player).toContain('label 为被连累时「责任归因」与「改进建议」必须点出')
  })

  it('finalCall 说明改为模板骨架', () => {
    expect(buildStage2Prompt(att, snap, [])).toContain('finalCall 是系统按标签生成的结论骨架')
  })
})
