/**
 * useMatchPlayerRanks 单元测试
 *
 * 重点：puuid → 展示数据的映射是否遵循 hasRealTier / 队列选择规则，
 * 以及批量请求失败时不影响其余玩家（Promise.allSettled 语义）。
 * 缓存/去重本身的行为由 services/rank.spec.ts 覆盖，这里不重复测。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { Rank } from '@renderer/types/domain/player'

vi.mock('@renderer/services/rank', () => ({ getRankByPuuid: vi.fn() }))
import { getRankByPuuid } from '@renderer/services/rank'
import { useMatchPlayerRanks } from './useMatchPlayerRanks'

const mockGetRank = vi.mocked(getRankByPuuid)

function makeRank(soloTier: string, flexTier = '', soloLeaguePoints = 40): Rank {
  return {
    queueMap: {
      RANKED_SOLO_5x5: {
        queueType: 'RANKED_SOLO_5x5',
        queueTypeCn: '单双排',
        division: 'IV',
        tier: soloTier,
        tierCn: soloTier,
        highestDivision: 'IV',
        highestTier: soloTier,
        isProvisional: false,
        leaguePoints: soloLeaguePoints,
        losses: 5,
        wins: 10
      },
      RANKED_FLEX_SR: {
        queueType: 'RANKED_FLEX_SR',
        queueTypeCn: '灵活组排',
        division: flexTier ? 'II' : 'NA',
        tier: flexTier,
        tierCn: flexTier,
        highestDivision: flexTier ? 'II' : 'NA',
        highestTier: flexTier,
        isProvisional: false,
        leaguePoints: 0,
        losses: 0,
        wins: 0
      }
    }
  }
}

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return () => null
    }
  })
  const wrapper = mount(Wrapper)
  return { result, unmount: () => wrapper.unmount() }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await nextTick()
}

describe('useMatchPlayerRanks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps puuid to short/tooltip text using the solo queue for a 420 game', async () => {
    mockGetRank.mockResolvedValueOnce(makeRank('DIAMOND'))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(mockGetRank).toHaveBeenCalledWith('p1')
    const tier = result.tiersByPuuid.value.p1
    expect(tier).not.toBeNull()
    // tierCn 是测试用的原始英文 tier 值，short 只取后两字：'DIAMOND'.slice(-2) === 'ND'
    expect(tier?.shortText).toBe('ND IV')
    expect(tier?.tooltipText).toContain('单双排')
    expect(tier?.tooltipText).toContain('非本局当时段位')
  })

  // 回归用例：大师及以上用胜点而非分段展示，胜点常见 4 位数（如「王者 1234」）。
  // 详情页紧凑徽章是固定宽度槽位，带着胜点拼接会溢出撑破布局、挤到玩家名字上——
  // shortText 必须省略胜点数字，完整胜点仍要留在 tooltip 里（不能因为紧凑处省略就整体丢失）
  it('omits the league points number from the compact badge for a high tier, but keeps it in the tooltip', async () => {
    mockGetRank.mockResolvedValueOnce(makeRank('CHALLENGER', '', 1234))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    const tier = result.tiersByPuuid.value.p1
    expect(tier).not.toBeNull()
    expect(tier?.shortText).not.toMatch(/\d/)
    expect(tier?.shortText).toBe('ER')
    expect(tier?.tooltipText).toContain('1234')
    expect(tier?.tooltipText).toContain('非本局当时段位')
  })

  it('uses the flex queue tier for a 440 game when flex has real data', async () => {
    mockGetRank.mockResolvedValueOnce(makeRank('SILVER', 'GOLD'))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(440)))

    await flush()

    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('灵活组排')
    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('GOLD')
  })

  it('falls back to solo queue for a 440 game when flex has no tier data', async () => {
    mockGetRank.mockResolvedValueOnce(makeRank('SILVER', ''))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(440)))

    await flush()

    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('单双排')
  })

  it('yields null for a player whose rank request failed, without affecting others', async () => {
    // getRankByPuuid 的真实实现失败时返回 null 而非抛错（见 services/rank.ts），这里模拟该约定
    mockGetRank.mockResolvedValueOnce(null).mockResolvedValueOnce(makeRank('GOLD'))

    const players = ref([{ puuid: 'fail' }, { puuid: 'ok' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(result.tiersByPuuid.value.fail).toBeNull()
    expect(result.tiersByPuuid.value.ok).not.toBeNull()
  })

  it('yields null for unranked players instead of leaking placeholder text', async () => {
    mockGetRank.mockResolvedValueOnce(makeRank('UNRANKED'))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(result.tiersByPuuid.value.p1).toBeNull()
  })

  it('skips players with an empty puuid without calling getRankByPuuid for them', async () => {
    const players = ref([{ puuid: '' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(mockGetRank).not.toHaveBeenCalled()
    expect(result.tiersByPuuid.value).toEqual({})
  })
})
