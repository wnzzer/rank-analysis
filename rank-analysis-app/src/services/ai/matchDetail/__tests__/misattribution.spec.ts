import { describe, it, expect } from 'vitest'
import { buildEntityFacts, stripMisattributedSentences } from '../misattribution'
import type { MatchSnapshot } from '../../shared/snapshot'

/** 真实复现场景：败方打野赵信 9500 金币，胜方打野男枪 15000 */
function snap() {
  const p = (id: number, teamId: number, champion: string, o: Record<string, number>) => ({
    participantId: id,
    teamId,
    name: `玩家${id}`,
    champion,
    teamPosition: 'JUNGLE',
    kills: 0,
    deaths: 0,
    assists: 0,
    kda: 0,
    gold: 0,
    cs: 0,
    damage: 0,
    taken: 0,
    damageShare: 0,
    damageTakenShare: 0,
    goldShare: 0,
    killParticipation: 0,
    dpm: 0,
    gpm: 0,
    csm: 0,
    wardScore: null,
    turretDamage: 0,
    multiKills: { double: 0, triple: 0, quadra: 0, penta: 0 },
    vsLaneOpponent: null,
    ...o
  })
  const players = [
    p(2, 100, '赵信', {
      kills: 1,
      deaths: 11,
      assists: 5,
      kda: 0.55,
      gold: 9500,
      killParticipation: 31.6
    }),
    p(7, 200, '男枪', {
      kills: 10,
      deaths: 3,
      assists: 9,
      kda: 6.33,
      gold: 15000,
      killParticipation: 55.9
    })
  ]
  return {
    players,
    teams: [
      {
        teamId: 100,
        totalKills: 19,
        totalDeaths: 34,
        totalAssists: 40,
        totalGold: 60500,
        totalDamage: 1
      },
      {
        teamId: 200,
        totalKills: 34,
        totalDeaths: 19,
        totalAssists: 60,
        totalGold: 69000,
        totalDamage: 2
      }
    ]
  } as unknown as MatchSnapshot
}

const facts = () => ({ players: buildEntityFacts(snap()) })

describe('stripMisattributedSentences', () => {
  it("should drop a sentence that pins another player's number on the named player", () => {
    // 评测原句：9500 是赵信的经济
    const md = '- 赵信：被打穿了。对位男枪自己只有 9500 金币。'
    expect(stripMisattributedSentences(md, facts())).toBe('- 赵信：被打穿了。')
  })

  it('should not reassign unnamed clauses that refer to someone else', () => {
    const md = '- 男枪：对面打野只有 9500 金币。'
    expect(stripMisattributedSentences(md, facts())).toBe(md)
  })

  it('should keep correct attributions, including team totals and k-notation', () => {
    const md = '- 男枪：10 杀 3 死，经济 15k，队伍 34 杀碾压。'
    expect(stripMisattributedSentences(md, facts())).toBe(md)
  })

  it('should skip comparison clauses that talk about two players', () => {
    const md = '- 赵信：KDA 0.55 对比男枪 6.33，被对位压制。'
    expect(stripMisattributedSentences(md, facts())).toBe(md)
  })

  it('should use the bullet head as subject for unnamed clauses', () => {
    // 「赵信：」后的未点名分句写了男枪的 15000 → 张冠李戴
    expect(stripMisattributedSentences('- 赵信：经济 15000 全场最高。', facts())).toBe('')
  })

  it('should check 你/本人 clauses against the single-review subject', () => {
    const material = { ...facts(), subjectId: 2 }
    expect(stripMisattributedSentences('你这局拿了 10 杀。你死了 11 次。', material)).toBe(
      '你死了 11 次。'
    )
  })

  it('should not touch numbers that belong to nobody (handled by grounding filter)', () => {
    expect(stripMisattributedSentences('- 男枪：伤害 99999。', facts())).toBe(
      '- 男枪：伤害 99999。'
    )
  })

  it('should not treat a mid-paragraph colon as a bullet head', () => {
    const md = '这局锅不在你。全队 19 杀还是输了，结论是男枪太强：10 杀 3 死。'
    expect(stripMisattributedSentences(md, { ...facts(), subjectId: 2 })).toBe(md)
  })

  it('should attribute a stat to the name it modifies (「10 杀的男枪」)', () => {
    expect(stripMisattributedSentences('- 赵信：撞上 10 杀的男枪。', facts())).toBe(
      '- 赵信：撞上 10 杀的男枪。'
    )
    expect(stripMisattributedSentences('- 赵信：撞上 1 杀的男枪。', facts())).toBe('')
  })

  it('should skip comparisons and positional references', () => {
    const material = { ...facts(), subjectId: 2 }
    expect(stripMisattributedSentences('KDA 0.55 对 6.33，10 杀对 1 杀。', material)).toBe(
      'KDA 0.55 对 6.33，10 杀对 1 杀。'
    )
    expect(stripMisattributedSentences('胜方打野 10 杀 3 死。', material)).toBe(
      '胜方打野 10 杀 3 死。'
    )
    expect(stripMisattributedSentences('你有 1 次击杀，他有 3 次死亡。', material)).toBe(
      '你有 1 次击杀，他有 3 次死亡。'
    )
    expect(
      stripMisattributedSentences('- 男枪：赵信和男枪分别 11 次死亡和 3 次死亡。', facts())
    ).toBe('- 男枪：赵信和男枪分别 11 次死亡和 3 次死亡。')
  })

  it('should not read a number from its middle (「全队 19 次击杀」≠「9 次击杀」)', () => {
    const material = { ...facts(), subjectId: 2 }
    expect(stripMisattributedSentences('全队 19 次击杀里他只沾了零头。', material)).toBe(
      '全队 19 次击杀里他只沾了零头。'
    )
  })

  it('should pass through when no players', () => {
    expect(stripMisattributedSentences('- 男枪：9500。', { players: [] })).toBe('- 男枪：9500。')
  })
})
