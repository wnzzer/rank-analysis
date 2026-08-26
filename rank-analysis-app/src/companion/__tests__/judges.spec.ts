/**
 * 赛后徽章规则引擎 + 三裁判 prompt 单测。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  buildJudgeUserPrompt,
  computeBadges,
  judgePlayersFromGame,
  runJudges,
  type JudgePlayer
} from '../judges'

function player(over: Partial<JudgePlayer> & { name: string }): JudgePlayer {
  return {
    championName: 'Vayne',
    team: 100,
    win: true,
    kills: 5,
    deaths: 2,
    assists: 6,
    damageDealt: 20_000,
    damageTaken: 15_000,
    turretDamage: 1_000,
    heal: 500,
    goldEarned: 12_000,
    ...over
  }
}

const BASE: JudgePlayer[] = [
  player({ name: 'me', damageDealt: 32_000, turretDamage: 4_000 }),
  player({ name: 'mate', damageTaken: 30_000, heal: 9_000, goldEarned: 15_000 }),
  player({ name: 'foe1', team: 200, win: false, damageDealt: 28_000 }),
  player({ name: 'foe2', team: 200, win: false, kills: 8, deaths: 1, assists: 10 })
]

describe('computeBadges', () => {
  it('全场维度徽章发给正确的玩家', () => {
    const map = computeBadges(BASE)
    const of = (name: string) => (map.get(name) ?? []).map(b => b.key)

    expect(of('me')).toContain('damage-king')
    expect(of('me')).toContain('tower')
    expect(of('mate')).toContain('tank')
    expect(of('mate')).toContain('healer')
    expect(of('mate')).toContain('economy')
  })

  it('KDA 扛把子需要 ≥3 且按比值取最大', () => {
    // foe2 KDA = 18 > me 的 5.5
    const map = computeBadges(BASE)
    expect((map.get('foe2') ?? []).map(b => b.key)).toContain('kda-king')
  })

  it('虽败犹荣发给败方输出最高者；躺赢大师仅在胜方 ≥3 人时颁发', () => {
    // BASE：胜方 2 人（me/mate），不颁发躺赢
    let map = computeBadges(BASE)
    expect((map.get('foe1') ?? []).map(b => b.key)).toContain('carry-loss')
    expect((map.get('me') ?? []).some(b => b.key === 'sleeper-win')).toBe(false)

    // 胜方凑满 3 人：贡献（伤害+塔伤）最低者拿躺赢
    const with3Winners = [
      ...BASE,
      player({ name: 'mate2', damageDealt: 18_000, turretDamage: 100 })
    ]
    // me=36000 / mate=21000 / mate2=18100 → sleeper-win 归 mate2
    map = computeBadges(with3Winners)
    expect((map.get('mate2') ?? []).map(b => b.key)).toContain('sleeper-win')
  })

  it('空列表安全返回空 Map', () => {
    expect(computeBadges([]).size).toBe(0)
  })
})

describe('三裁判', () => {
  it('prompt 含 roster 与被点评标记', () => {
    const p = buildJudgeUserPrompt({ id: 'sharp', label: '锐评', system: '' }, BASE, 'me')
    expect(p).toContain('★me')
    expect(p).toContain('英雄伤害 32000')
  })

  it('runJudges 并行聚合成功项、过滤失败', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce('锐评文本')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('数据控文本')

    const results = await runJudges(BASE, 'me', callLLM)
    expect(results.map(r => r.styleId)).toEqual(['sharp', 'data'])
    expect(callLLM).toHaveBeenCalledTimes(3)
  })
})

describe('judgePlayersFromGame 适配器', () => {
  it('按下标对齐 identities 与 participants，缺字段降级为 0', () => {
    const game = {
      participants: [
        {
          participantId: 1,
          teamId: 100,
          championId: 67,
          stats: { win: true, kills: 9, totalDamageDealtToChampions: 40_000 }
        },
        { participantId: 2 }
      ],
      participantIdentities: [{ player: { gameName: 'me', summonerName: 'old' } }, {}]
    }
    const players = judgePlayersFromGame(game)
    expect(players[0]).toMatchObject({
      name: 'me',
      win: true,
      kills: 9,
      damageDealt: 40_000,
      deaths: 0
    })
    expect(players[1].name).toBe('玩家2')
  })
})
