import { describe, expect, it } from 'vitest'
import { formatReviewReport } from '../reviewReport'
import type { Badge, JudgePlayer, JudgeResult } from '../judges'

const MOCK_PLAYER: JudgePlayer = {
  name: 'Uzi',
  championName: 'Vayne',
  team: 100,
  win: true,
  kills: 12,
  deaths: 2,
  assists: 8,
  damageDealt: 35_420,
  damageTaken: 14_200,
  turretDamage: 3_200,
  heal: 1_200,
  goldEarned: 16_000
}

const MOCK_BADGES: Badge[] = [
  { key: 'damage-king', label: '输出之王', desc: '全场最高输出', tier: 'gold' },
  { key: 'kda-king', label: 'KDA扛把子', desc: '高KDA', tier: 'gold' }
]

const MOCK_JUDGES: JudgeResult[] = [
  { styleId: 'warm', label: '暖心鼓励', text: '走位犀利，团战收割非常果断！' },
  { styleId: 'sharp', label: '毒舌锐评', text: '输出拉满，但别忘了感谢辅助的贴身保护。' }
]

describe('formatReviewReport', () => {
  it('正确格式化完整战报（包含胜负、KDA、伤害、徽章与AI点评）', () => {
    const text = formatReviewReport({
      player: MOCK_PLAYER,
      badges: MOCK_BADGES,
      judges: MOCK_JUDGES,
      queueName: '极地大乱斗'
    })

    expect(text).toContain('【Rank Analysis · 极地大乱斗战报】')
    expect(text).toContain('玩家：Uzi · Vayne · 胜利 🏆')
    expect(text).toContain('12/2/8 (KDA 10.00)')
    expect(text).toContain('伤害 35.4k · 承伤 14.2k')
    expect(text).toContain('徽章：🥇 输出之王、🥇 KDA扛把子')
    expect(text).toContain('• 暖心鼓励：走位犀利，团战收割非常果断！')
    expect(text).toContain('• 毒舌锐评：输出拉满，但别忘了感谢辅助的贴身保护。')
  })

  it('0 死亡时输出 PERFECT KDA，且无徽章时友好提示', () => {
    const deathless: JudgePlayer = {
      ...MOCK_PLAYER,
      name: 'Faker',
      championName: 'Ahri',
      win: false,
      deaths: 0,
      damageDealt: 18_100,
      damageTaken: 8_300
    }

    const text = formatReviewReport({ player: deathless })

    expect(text).toContain('玩家：Faker · Ahri · 惜败 💔')
    expect(text).toContain('KDA PERFECT')
    expect(text).toContain('徽章：稳扎稳打（稳定发挥）')
    expect(text).not.toContain('AI 裁判点评')
  })
})
