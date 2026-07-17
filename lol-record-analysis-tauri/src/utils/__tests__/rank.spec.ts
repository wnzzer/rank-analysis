import { describe, it, expect } from 'vitest'
import { winRate, formatTierText, hasRealTier } from '../rank'
import { defaultQueueInfo, type QueueInfo } from '@renderer/types/domain/player'

function queueInfo(partial: Partial<QueueInfo>): QueueInfo {
  return { ...defaultQueueInfo(), ...partial }
}

describe('winRate', () => {
  it('should return zero when no games', () => {
    expect(winRate(0, 0)).toBe(0)
  })

  it('should round to nearest integer', () => {
    expect(winRate(7, 3)).toBe(70)
    expect(winRate(1, 2)).toBe(33)
  })
})

describe('hasRealTier', () => {
  it('should be false for LCU unranked placeholder (tier=UNRANKED, division=NA)', () => {
    expect(hasRealTier(queueInfo({ tier: 'UNRANKED', tierCn: '无', division: 'NA' }))).toBe(false)
  })

  it('should be false for empty tier', () => {
    expect(hasRealTier(queueInfo({ tier: '' }))).toBe(false)
  })

  it('should be true for a real tier', () => {
    expect(hasRealTier(queueInfo({ tier: 'PLATINUM' }))).toBe(true)
  })
})

describe('formatTierText', () => {
  it('should show 无段位 instead of leaking division NA when unranked', () => {
    expect(formatTierText(queueInfo({ tier: 'UNRANKED', tierCn: '无', division: 'NA' }))).toBe(
      '无段位'
    )
  })

  it('should join tierCn with division for normal tiers', () => {
    expect(formatTierText(queueInfo({ tier: 'PLATINUM', tierCn: '华贵铂金', division: 'I' }))).toBe(
      '华贵铂金 I'
    )
  })

  it('should shorten tierCn to last two chars with short option', () => {
    expect(
      formatTierText(queueInfo({ tier: 'PLATINUM', tierCn: '华贵铂金', division: 'I' }), {
        short: true
      })
    ).toBe('铂金 I')
  })

  it('should show league points for master and above', () => {
    expect(
      formatTierText(queueInfo({ tier: 'MASTER', tierCn: '超凡大师', leaguePoints: 233 }))
    ).toBe('超凡大师 233')
  })
})
