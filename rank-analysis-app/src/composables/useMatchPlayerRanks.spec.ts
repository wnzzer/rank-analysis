/**
 * useMatchPlayerRanks 单元测试
 *
 * 重点：puuid → 展示数据的映射是否遵循 hasRealTier / 队列选择规则，
 * 以及批量请求中单人失败时不影响其余玩家（服务层批量语义）。
 * 缓存/去重本身的行为由 services/rank.spec.ts 覆盖，这里不重复测。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { Rank } from '@renderer/types/domain/player'

vi.mock('@renderer/services/rank', () => ({ getRanksByPuuids: vi.fn() }))
vi.mock('@renderer/services/sgp', () => ({ getSgpRanksByPuuids: vi.fn() }))
import { getRanksByPuuids } from '@renderer/services/rank'
import { getSgpRanksByPuuids } from '@renderer/services/sgp'
import { useMatchPlayerRanks } from './useMatchPlayerRanks'

const mockGetRanks = vi.mocked(getRanksByPuuids)
const mockGetSgpRanks = vi.mocked(getSgpRanksByPuuids)

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
    mockGetRanks.mockResolvedValue({ p1: makeRank('DIAMOND') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(mockGetRanks).toHaveBeenCalledWith(['p1'])
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
    mockGetRanks.mockResolvedValue({ p1: makeRank('CHALLENGER', '', 1234) })
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
    mockGetRanks.mockResolvedValue({ p1: makeRank('SILVER', 'GOLD') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(440)))

    await flush()

    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('灵活组排')
    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('GOLD')
  })

  it('falls back to solo queue for a 440 game when flex has no tier data', async () => {
    mockGetRanks.mockResolvedValue({ p1: makeRank('SILVER', '') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(440)))

    await flush()

    expect(result.tiersByPuuid.value.p1?.tooltipText).toContain('单双排')
  })

  it('yields null for a player whose rank request failed, without affecting others', async () => {
    // 批量接口的单人失败语义：该 puuid 返回 null 而非抛错（见 services/rank.ts）
    mockGetRanks.mockResolvedValue({ fail: null, ok: makeRank('GOLD') })

    const players = ref([{ puuid: 'fail' }, { puuid: 'ok' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(result.tiersByPuuid.value.fail).toBeNull()
    expect(result.tiersByPuuid.value.ok).not.toBeNull()
  })

  it('yields null for unranked players instead of leaking placeholder text', async () => {
    mockGetRanks.mockResolvedValue({ p1: makeRank('UNRANKED') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(result.tiersByPuuid.value.p1).toBeNull()
  })

  it('skips players with an empty puuid without calling getRanksByPuuids for them', async () => {
    const players = ref([{ puuid: '' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    expect(mockGetRanks).not.toHaveBeenCalled()
    expect(result.tiersByPuuid.value).toEqual({})
  })

  it('batch failure degrades to null but stays retryable on the next lookup', async () => {
    mockGetRanks
      .mockRejectedValueOnce(new Error('LCU offline'))
      .mockResolvedValueOnce({ p1: makeRank('GOLD'), p2: makeRank('SILVER') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420)))

    await flush()

    // 展示层降级为 null，不抛错
    expect(result.tiersByPuuid.value.p1).toBeNull()

    // 整体失败不落「已请求过」标记：下次列表变化时同一批 puuid 会重新发起
    players.value = [{ puuid: 'p1' }, { puuid: 'p2' }]
    await flush()

    expect(mockGetRanks).toHaveBeenCalledTimes(2)
    expect(mockGetRanks).toHaveBeenLastCalledWith(['p1', 'p2'])
    expect(result.tiersByPuuid.value.p1).not.toBeNull()
  })

  // ── 跨区（region 非空）路径：走 SGP rankedStats 批量端点，展示逻辑与 LCU 路径一致 ──

  it('uses the SGP batch endpoint when region is set, with the same display mapping', async () => {
    mockGetSgpRanks.mockResolvedValue({ p1: makeRank('DIAMOND') })
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420), ref('HN10')))

    await flush()

    expect(mockGetSgpRanks).toHaveBeenCalledWith('HN10', ['p1'])
    expect(mockGetRanks).not.toHaveBeenCalled()
    const tier = result.tiersByPuuid.value.p1
    expect(tier).not.toBeNull()
    expect(tier?.shortText).toBe('ND IV')
  })

  it('uses the LCU endpoint when region is empty, even if a previous region was set', async () => {
    mockGetSgpRanks.mockResolvedValue({ p1: makeRank('GOLD') })
    mockGetRanks.mockResolvedValue({ p2: makeRank('SILVER') })
    const players = ref([{ puuid: 'p1' }])
    const region = ref<string | undefined>('HN10')
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420), region))

    await flush()
    expect(mockGetSgpRanks).toHaveBeenCalledTimes(1)

    // 切回当前区（region 清空）且出现新玩家 → 新玩家走 LCU 路径（已缓存的 p1 不重查）
    players.value = [{ puuid: 'p1' }, { puuid: 'p2' }]
    region.value = undefined
    await flush()

    expect(mockGetSgpRanks).toHaveBeenCalledTimes(1)
    expect(mockGetRanks).toHaveBeenCalledWith(['p2'])
    expect(result.tiersByPuuid.value.p2?.tooltipText).toContain('SILVER')
  })

  it('degrades SGP failures to null without throwing', async () => {
    mockGetSgpRanks.mockRejectedValue(new Error('SGP 401'))
    const players = ref([{ puuid: 'p1' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420), ref('NA1')))

    await flush()

    expect(result.tiersByPuuid.value.p1).toBeNull()
  })

  it('skips empty puuids on the SGP path without calling the endpoint', async () => {
    const players = ref([{ puuid: '' }])
    const { result } = withSetup(() => useMatchPlayerRanks(players, ref(420), ref('HN10')))

    await flush()

    expect(mockGetSgpRanks).not.toHaveBeenCalled()
    expect(result.tiersByPuuid.value).toEqual({})
  })
})
