import { describe, it, expect } from 'vitest'
import { STAGE1_SYSTEM_PROMPT, buildStage1UserPrompt } from '../../prompts/stage1-profile'
import type { GameFeature } from '../../featureExtract'

describe('STAGE1_SYSTEM_PROMPT', () => {
  it('declares the role as 数据分析师 (no naming yet)', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('数据分析师')
    expect(STAGE1_SYSTEM_PROMPT).toContain('不输出标签名')
  })

  it('requires sampleSize ≥ 5 per candidate', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('sampleSize')
    expect(STAGE1_SYSTEM_PROMPT).toContain('≥ 5')
  })

  it('warns about queue bucketing (排位 vs 娱乐)', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('420')
    expect(STAGE1_SYSTEM_PROMPT).toContain('440')
    expect(STAGE1_SYSTEM_PROMPT).toContain('分桶')
  })

  it('mentions the input field whitelist', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('killParticipation')
    expect(STAGE1_SYSTEM_PROMPT).toContain('damageShare')
    expect(STAGE1_SYSTEM_PROMPT).toContain('teamPosition')
  })

  it('declares the metric whitelist', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('kda')
    expect(STAGE1_SYSTEM_PROMPT).toContain('multiKillsMax')
    expect(STAGE1_SYSTEM_PROMPT).toContain('streak')
  })

  it('embeds the output JSON schema with goodCandidates/badCandidates', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('goodCandidates')
    expect(STAGE1_SYSTEM_PROMPT).toContain('badCandidates')
    expect(STAGE1_SYSTEM_PROMPT).toContain('modeBreakdown')
  })

  it('contains no specific tag-name exemplars (avoid few-shot bias)', () => {
    // The point of Stage 1 is to NOT name things.
    expect(STAGE1_SYSTEM_PROMPT).not.toContain('排位送葬人')
    expect(STAGE1_SYSTEM_PROMPT).not.toContain('海克斯送葬')
    expect(STAGE1_SYSTEM_PROMPT).not.toContain('排位刺客')
  })

  it('describes vibe array as style guidance not names', () => {
    expect(STAGE1_SYSTEM_PROMPT).toContain('vibe')
    expect(STAGE1_SYSTEM_PROMPT).toContain('风格指南')
  })
})

describe('buildStage1UserPrompt', () => {
  function gf(opts: Partial<GameFeature> = {}): GameFeature {
    return {
      win: true,
      championId: 64,
      queueId: 420,
      queueName: '单双排位',
      durationMin: 30,
      kda: { k: 10, d: 5, a: 15, ratio: 5 },
      damage: 30000,
      gold: 15000,
      cs: 200,
      killParticipation: 0.8,
      damageShare: 0.3,
      damageTakenShare: 0.2,
      wardScore: 20,
      multiKillsMax: 3,
      dpm: 1000,
      gpm: 500,
      csm: 6.7,
      lane: 'JUNGLE',
      teamPosition: 'JUNGLE',
      ...opts
    }
  }

  it('reports N for wins / losses', () => {
    const p = buildStage1UserPrompt([gf(), gf()], [gf({ win: false })])
    expect(p).toContain('赢局 (N=2)')
    expect(p).toContain('输局 (N=1)')
  })

  it('embeds JSON of features', () => {
    const p = buildStage1UserPrompt([gf()], [])
    expect(p).toContain('"championId":64')
    expect(p).toContain('"queueName":"单双排位"')
  })

  it('handles empty arrays', () => {
    const p = buildStage1UserPrompt([], [])
    expect(p).toContain('赢局 (N=0)')
    expect(p).toContain('输局 (N=0)')
  })
})
