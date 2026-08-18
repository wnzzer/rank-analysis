import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  backtestSummary,
  fetchAdoptionStats,
  fetchDecisionBacktest,
  reasonLabel,
  type AdoptionStats,
  type BacktestResult,
  type DecisionBacktest
} from './backtest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

function makeBacktest(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    suggestionChampionId: 64,
    actualChampionId: 61,
    matchupDelta: 0.12,
    winRateGap: 0.1,
    scoreGap: 1.5,
    confidence: 0.3,
    caveats: ['非因果'],
    insufficientData: false,
    ...overrides
  }
}

describe('fetchDecisionBacktest', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('转发 gameId 并返回对账结果', async () => {
    const payload: DecisionBacktest = {
      aligned: true,
      reason: 'ok',
      adopted: true,
      resultWin: true,
      backtest: makeBacktest()
    }
    invokeMock.mockResolvedValue(payload)
    await expect(fetchDecisionBacktest(777)).resolves.toEqual(payload)
    expect(invokeMock).toHaveBeenCalledWith('get_decision_backtest', { gameId: 777 })
  })

  it('invoke 失败时返回 null 静默降级', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    await expect(fetchDecisionBacktest(777)).resolves.toBeNull()
  })
})

describe('fetchAdoptionStats', () => {
  it('转发并返回统计', async () => {
    const payload: AdoptionStats = {
      adoptedTotal: 10,
      notAdoptedTotal: 5,
      adoptedWinRate: 0.6,
      notAdoptedWinRate: 0.4,
      pendingTotal: 3
    }
    invokeMock.mockResolvedValue(payload)
    await expect(fetchAdoptionStats()).resolves.toEqual(payload)
    expect(invokeMock).toHaveBeenCalledWith('get_adoption_stats')
  })

  it('invoke 失败时返回 null', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    await expect(fetchAdoptionStats()).resolves.toBeNull()
  })
})

describe('reasonLabel', () => {
  it('覆盖全部已知原因', () => {
    expect(reasonLabel('ok')).toBe('已对账')
    expect(reasonLabel('no_pending_suggestion')).toBe('本局无赛前建议')
    expect(reasonLabel('not_in_game')).toBe('本机玩家不在该局')
    expect(reasonLabel('position_unknown')).toBe('分路信息缺失')
  })

  it('未知原因原样返回', () => {
    expect(reasonLabel('whatever' as DecisionBacktest['reason'])).toBe('whatever')
  })
})

describe('backtestSummary', () => {
  it('正向差异输出"高于"', () => {
    expect(backtestSummary(makeBacktest({ matchupDelta: 0.12 }))).toContain('高于')
  })

  it('负向差异输出"低于"', () => {
    expect(backtestSummary(makeBacktest({ matchupDelta: -0.2 }))).toContain('低于')
  })

  it('数据不足时如实说明', () => {
    expect(backtestSummary(makeBacktest({ insufficientData: true }))).toBe('样本不足，暂不作判断')
  })
})
