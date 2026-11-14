/**
 * 无时间线降级路径的逐字基线：Stage 2 prompt（Stage 1 已移除，其 prompt 与缓存键基线随之删除）。
 *
 * 快照（__snapshots__/noTimelineBaseline.spec.ts.snap）由时间线功能合入前的基线提交
 * d4a10c7 的同名代码生成，并在本分支逐字比对通过——任何让无时间线 prompt 变化的改动
 * 都会让这里失败（spec：无时间线时所有 prompt 与现状逐字一致）。
 * 有意更新记录：round3 起 Stage 1 注入【系统判定】名单/标签、标签定义改为信息性说明；
 * 单人复盘有对位时注入【对位对比】预算结论（用户批准无时间线路径同步变化）。评分版（2026-11-07）起 Stage 2 整局「语气原则」的 finalCall 说明改为结论骨架；Stage 1 移除后其基线一并删除。
 * 合入 main（2026-11-08）：名册附「终局对位」差值、【双方队伍】、「数字只能写在主人名下」与【输出用语】规则；
 * 单人复盘的目标/对位由 JSON 改为逐行带主语的事实卡（防张冠李戴），位置本分/近期画像规则改用中文措辞。
 * 2026-11-14：新增 Carry 标签，章节映射与措辞立场规则各加一句（用户要求加赞扬标签）。
 * 注意：不要随手 `-u` 更新快照；确需改 prompt 时应同时确认这是有意的行为变化。
 */
import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../../shared/snapshot'
import { buildStage2Prompt } from '../prompts/stage2-critique'
import { buildStage2PlayerPrompt } from '../prompts/stage2-player'
import { buildCritiqueUserPrompt } from '../critique'
import type { AttributionResult } from '../types'

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

/**
 * 10 人对局：1-5 蓝方（胜）、6-10 红方，按上野中下辅；数值按编号错开。
 * noPositions：模拟大乱斗 LCU 战绩不带分路（teamPosition 为空）→ 无对位。
 */
function makeGame(over: {
  queueId: number
  gameMode: string
  mapId: number
  noPositions?: boolean
}): Game {
  const { noPositions, ...meta } = over
  const ids = Array.from({ length: 10 }, (_, i) => i + 1)
  return {
    gameId: 4242,
    queueName: '测试队列',
    gameDuration: 1830,
    ...meta,
    participants: ids.map(id => {
      const pos = POSITIONS[(id - 1) % 5]
      return {
        participantId: id,
        teamId: id <= 5 ? 100 : 200,
        championId: id,
        spell1Id: 4,
        spell2Id: id % 2 ? 11 : 7,
        teamPosition: noPositions ? '' : pos,
        stats: {
          win: id <= 5,
          kills: (id * 3) % 11,
          deaths: (id * 5) % 9,
          assists: (id * 7) % 13,
          totalDamageDealtToChampions: 9000 + id * 1700,
          totalDamageTaken: 12000 + id * 900,
          goldEarned: 8000 + id * 600,
          totalMinionsKilled: pos === 'JUNGLE' || pos === 'UTILITY' ? 30 : 140 + id * 5,
          neutralMinionsKilled: pos === 'JUNGLE' ? 120 : 4,
          totalHeal: 500 + id * 100,
          damageDealtToTurrets: id * 400,
          perk0: 8005,
          perkSubStyle: 8200,
          playerAugment1: 0,
          playerAugment2: 0,
          playerAugment3: 0,
          playerAugment4: 0,
          playerAugment5: 0,
          playerAugment6: 0,
          item0: 1001,
          item1: 3031,
          item2: 0,
          item3: 0,
          item4: 0,
          item5: 0,
          item6: 3340,
          doubleKills: id % 3 === 0 ? 1 : 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          visionScore: 10 + id * 2,
          sightWardsBoughtInGame: 0,
          visionWardsBoughtInGame: id % 4
        },
        timeline: { lane: noPositions ? 'NONE' : pos, role: 'NONE' }
      }
    }),
    participantIdentities: ids.map(id => ({
      participantId: id,
      player: { gameName: `玩家${id}`, tagLine: '0000', puuid: `puuid-${id}` }
    }))
  } as unknown as Game
}

const attribution: AttributionResult = {
  winReason: '蓝方中期团战连胜滚起经济',
  verdicts: [4, 2, 9, 7].map(id => ({
    participantId: id,
    name: `玩家${id}#0000`,
    label: id <= 5 ? '尽力' : '犯罪',
    evidenceMetrics: [
      { metric: 'kda', value: 2.5, teamRank: 1 },
      { metric: 'damageShare', value: 28 },
      { metric: 'killParticipation', value: 61 }
    ],
    mitigatingFactors: [],
    finalCall: id <= 5 ? '输出拉满' : '关键团送头'
  }))
}

const VOCAB = ['提款机', '战神']

describe('无时间线 prompt 逐字基线（d4a10c7）', () => {
  const ranked = buildMatchSnapshot(makeGame({ queueId: 420, gameMode: 'CLASSIC', mapId: 11 }))
  const aram = buildMatchSnapshot(
    makeGame({ queueId: 450, gameMode: 'ARAM', mapId: 12, noPositions: true })
  )

  it('stage2 overview prompt', () => {
    expect(buildStage2Prompt(attribution, ranked, VOCAB)).toMatchSnapshot()
    expect(buildStage2Prompt(attribution, aram, [])).toMatchSnapshot()
    expect(buildCritiqueUserPrompt(attribution, ranked, { vocabSamples: VOCAB })).toMatchSnapshot()
  })

  it('stage2 player prompt: with lane opponent', () => {
    expect(buildStage2PlayerPrompt(attribution, ranked, 4, VOCAB)).toMatchSnapshot()
    expect(
      buildCritiqueUserPrompt(attribution, ranked, { mode: 'player', participantId: 4 })
    ).toMatchSnapshot()
  })

  it('stage2 player prompt: without lane opponent', () => {
    // 分路为空时快照按技能/英雄启发式推断位置：participantId 3 仍推出对位（且不在归因名单里），
    // participantId 4 推断不出同位对手 → 走"无同位对位数据"分支
    expect(buildStage2PlayerPrompt(attribution, aram, 3, VOCAB)).toMatchSnapshot()
    const noOpponent = buildStage2PlayerPrompt(attribution, aram, 4, [])
    expect(noOpponent).toContain('无同位对位数据（该模式无分路概念')
    expect(noOpponent).toMatchSnapshot()
  })
})
