/**
 * meet 服务测试：query_meet_summary 调用参数、零值过滤与失败兜底
 * @module services/meet
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { queryMeetSummary } from '../meet'
import type { MeetSummary } from '@renderer/types/domain/meet'

function makeSummary(overrides: Partial<MeetSummary> = {}): MeetSummary {
  return {
    total: 12,
    myTeamMeets: 5,
    enemyMeets: 7,
    myTeamWins: 3,
    lastSeenAt: '2026-08-10T12:00:00.000Z',
    recent: [],
    ...overrides
  }
}

describe('queryMeetSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按 puuid 查询并返回聚合', async () => {
    vi.mocked(invoke).mockResolvedValue(makeSummary())

    const result = await queryMeetSummary('puuid-1')

    expect(invoke).toHaveBeenCalledWith('query_meet_summary', { puuid: 'puuid-1' })
    expect(result?.total).toBe(12)
    expect(result?.myTeamMeets).toBe(5)
  })

  it('零值摘要（total = 0）视为无记录，返回 null', async () => {
    vi.mocked(invoke).mockResolvedValue(makeSummary({ total: 0, recent: [] }))

    const result = await queryMeetSummary('puuid-2')

    expect(result).toBeNull()
  })

  it('查询失败返回 null（不抛出）', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('meet.db 未就绪'))

    await expect(queryMeetSummary('puuid-3')).resolves.toBeNull()
  })

  it('返回空时不视为错误，同样为 null', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    await expect(queryMeetSummary('puuid-4')).resolves.toBeNull()
  })
})
