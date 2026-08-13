import { describe, it, expect, beforeEach } from 'vitest'

import {
  clearAiUsageLog,
  estimateCost,
  getAiUsageLog,
  recordAiUsage,
  sumAiUsage,
  QWEN_FLASH_PRICES,
  type AiUsageEntry
} from '../usage'

function entry(overrides: Partial<AiUsageEntry> = {}): AiUsageEntry {
  return {
    time: 1700000000000,
    gameId: 123,
    mode: 'overview',
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    ...overrides
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('recordAiUsage / getAiUsageLog', () => {
  it('records and reads back entries', () => {
    recordAiUsage(entry())
    recordAiUsage(entry({ gameId: 456, mode: 'player', totalTokens: 800 }))
    const log = getAiUsageLog()
    expect(log).toHaveLength(2)
    expect(log[0].gameId).toBe(123)
    expect(log[1].mode).toBe('player')
  })

  it('skips zero-token entries (cache-only hits cost nothing)', () => {
    recordAiUsage(entry({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }))
    expect(getAiUsageLog()).toHaveLength(0)
  })

  it('drops malformed persisted entries on read', () => {
    localStorage.setItem(
      'ai_usage_ledger',
      JSON.stringify([
        entry(),
        { time: 'nope' },
        null,
        {
          time: 1,
          gameId: 2,
          mode: 'champselect',
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2
        }
      ])
    )
    const log = getAiUsageLog()
    expect(log).toHaveLength(1)
    expect(log[0].gameId).toBe(123)
  })

  it('caps ledger at 500 entries', () => {
    for (let i = 0; i < 550; i++) {
      recordAiUsage(entry({ gameId: i }))
    }
    const log = getAiUsageLog()
    expect(log).toHaveLength(500)
    expect(log[0].gameId).toBe(50)
    expect(log[499].gameId).toBe(549)
  })

  it('clearAiUsageLog empties the ledger', () => {
    recordAiUsage(entry())
    clearAiUsageLog()
    expect(getAiUsageLog()).toHaveLength(0)
  })
})

describe('estimateCost / sumAiUsage', () => {
  it('estimates cost from qwen-flash unit prices', () => {
    // 1000 in * 0.0003 + 500 out * 0.0006 = 0.3 + 0.3 = 0.6 （单位元，乘 1000 后）
    expect(estimateCost({ promptTokens: 1000, completionTokens: 500 })).toBeCloseTo(
      QWEN_FLASH_PRICES.inputYuanPer1K + QWEN_FLASH_PRICES.outputYuanPer1K / 2,
      10
    )
  })

  it('sums tokens and total cost across the log', () => {
    recordAiUsage(entry({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }))
    recordAiUsage(entry({ promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 }))
    const sum = sumAiUsage(getAiUsageLog())
    expect(sum.promptTokens).toBe(3000)
    expect(sum.completionTokens).toBe(1500)
    expect(sum.totalTokens).toBe(4500)
    expect(sum.totalCostYuan).toBeCloseTo(
      estimateCost({ promptTokens: 3000, completionTokens: 1500 }),
      10
    )
  })

  it('returns zeroes for an empty log', () => {
    const sum = sumAiUsage([])
    expect(sum).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCostYuan: 0 })
  })
})
