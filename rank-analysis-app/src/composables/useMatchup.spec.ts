import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, reactive } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useMatchup, sortCandidates } from './useMatchup'
import type { MatchupApi, MatchupList, MatchupQuery } from '@renderer/types/matchup'

/** 创建源上下文一致的列表样本。@param query 查询。@returns 对位列表。 */
function list(query: MatchupQuery): MatchupList {
  return {
    ...query,
    version: '16.21',
    cachedAt: null,
    fetchedAt: 100,
    stale: false,
    candidates: [{ championId: 1, enemyWinRate: 0.46, play: 500 }]
  }
}

/** 创建无需客户端的测试提供器。@returns 可替换网络动作的提供器。 */
function api(): MatchupApi {
  return {
    getList: vi.fn(async query => list(query)),
    getDetail: vi.fn(async (query, candidateId) => ({
      ...query,
      version: query.version!,
      candidateId,
      cachedAt: null,
      fetchedAt: 100,
      stale: false,
      candidateWinRate: 0.532,
      laneKillRate: 0.48,
      play: 499
    })),
    getPosition: vi.fn(async () => 'mid'),
    loadNames: async () => {},
    name: id => `英雄${id}`,
    icon: id => `/champion/${id}`
  }
}

describe('对位查询', () => {
  it.each(['其他敌方锁定', '其他敌方换英雄', '当前敌方锁定', '同内容替换玩家数组'])(
    '%s 不重载当前第2页，当前英雄变化仍应刷新',
    async action => {
      const service = api()
      service.getList = vi.fn(async query => ({
        ...list(query),
        candidates: Array.from({ length: 10 }, (_, i) => ({
          championId: i + 1,
          enemyWinRate: 0.4,
          play: 500
        }))
      }))
      const session = reactive({
        players: [
          { championId: 103, pickState: 'picking' },
          { championId: 64, pickState: 'picking' }
        ]
      })
      // 与 SubteamCard → MatchupPanel 相同：公开队伍变化会重建对象，但查询条件未必变化。
      const enemies = computed(() => session.players.map((player, slot) => ({ slot, ...player })))
      const enemy = computed(() => enemies.value.find(item => item.slot === 0))
      const scope = effectScope()
      try {
        const model = scope.run(() =>
          useMatchup(
            () => ({
              slot: 0,
              enemyId: enemy.value!.championId,
              tier: 'emerald_plus',
              active: true
            }),
            service
          )
        )!
        await flushPromises()
        model.page.value = 2
        await flushPromises()
        const previousList = model.list.value
        const previousRows = model.rows.value
        expect(service.getList).toHaveBeenCalledTimes(1)
        expect(service.getDetail).toHaveBeenCalledTimes(10)

        if (action === '其他敌方锁定') session.players[1].pickState = 'locked'
        else if (action === '其他敌方换英雄') session.players[1].championId = 86
        else if (action === '当前敌方锁定') session.players[0].pickState = 'locked'
        else session.players = session.players.map(player => ({ ...player }))
        await flushPromises()

        expect(model.page.value).toBe(2)
        expect(model.list.value).toBe(previousList)
        expect(model.rows.value).toBe(previousRows)
        expect(model.loading.value).toBe(false)
        expect(service.getList).toHaveBeenCalledTimes(1)
        expect(service.getDetail).toHaveBeenCalledTimes(10)

        session.players[0].championId = 517
        await flushPromises()
        expect(model.page.value).toBe(1)
        expect(model.list.value?.enemyId).toBe(517)
        expect(service.getList).toHaveBeenCalledTimes(2)
      } finally {
        scope.stop()
      }
    }
  )

  it('快切目标时旧请求未结束也维持最多三个在飞详情', async () => {
    const service = api()
    service.getList = async query => ({
      ...list(query),
      candidates: Array.from({ length: 8 }, (_, i) => ({
        championId: i + 1,
        enemyWinRate: 0.4,
        play: 500
      }))
    })
    const resolvers: Array<() => void> = []
    let count = 0
    let peak = 0
    service.getDetail = async (query, candidateId) => {
      count++
      peak = Math.max(peak, count)
      await new Promise<void>(resolve => resolvers.push(resolve))
      count--
      return {
        ...query,
        version: query.version!,
        candidateId,
        cachedAt: null,
        fetchedAt: 1,
        stale: false,
        candidateWinRate: 0.55,
        laneKillRate: 0.5,
        play: 500
      }
    }
    const context = reactive({ enemyId: 103, tier: 'emerald_plus' as const, active: true })
    const scope = effectScope()
    scope.run(() => useMatchup(() => context, service))
    await flushPromises()
    context.enemyId = 64
    await flushPromises()
    while (resolvers.length) {
      resolvers.splice(0).forEach(resolve => resolve())
      await flushPromises()
    }
    expect(peak).toBeLessThanOrEqual(3)
    scope.stop()
  })
  it('小样本置后且按敌方视角排序，不把50%硬分入有利组', () => {
    expect(
      sortCandidates(
        [
          { championId: 1, enemyWinRate: 0.4, play: 100 },
          { championId: 2, enemyWinRate: 0.48, play: 500 },
          { championId: 3, enemyWinRate: 0.5, play: 1000 },
          { championId: 4, enemyWinRate: 0.44, play: 700 }
        ],
        'good'
      ).map(row => row.championId)
    ).toEqual([4, 2, 1])
  })

  it('使用详情中的候选实测胜率，固定列表版本查询', async () => {
    const service = api()
    const scope = effectScope()
    const model = scope.run(() =>
      useMatchup(() => ({ enemyId: 103, tier: 'emerald_plus', active: true }), service)
    )!
    await flushPromises()
    expect(model.rows.value[0].data?.candidateWinRate).toBe(0.532)
    expect(service.getDetail).toHaveBeenCalledWith(expect.objectContaining({ version: '16.21' }), 1)
    scope.stop()
  })

  it('段位变化清空旧数字，后到的旧请求不能覆盖新段位', async () => {
    const service = api()
    let resolveOld!: (value: MatchupList) => void
    service.getList = vi.fn(query =>
      query.tier === 'emerald_plus'
        ? new Promise(resolve => {
            resolveOld = resolve
          })
        : Promise.resolve(list(query))
    )
    const context = reactive({
      enemyId: 103,
      tier: 'emerald_plus' as const as MatchupQuery['tier'],
      active: true
    })
    const scope = effectScope()
    const model = scope.run(() => useMatchup(() => context, service))!
    await flushPromises()
    context.tier = 'diamond_plus'
    await flushPromises()
    resolveOld(list({ enemyId: 103, tier: 'emerald_plus', position: 'mid' }))
    await flushPromises()
    expect(model.list.value?.tier).toBe('diamond_plus')
    scope.stop()
  })

  it('换英雄清除手动分路，关闭时拒绝后到结果', async () => {
    const service = api()
    const context = reactive({ enemyId: 103, tier: 'emerald_plus' as const, active: true })
    const scope = effectScope()
    const model = scope.run(() => useMatchup(() => context, service))!
    await flushPromises()
    model.setPosition('top')
    await flushPromises()
    expect(model.manual.value).toBe(true)
    context.enemyId = 64
    await flushPromises()
    expect(model.position.value).toBe('mid')
    expect(model.manual.value).toBe(false)
    context.active = false
    await flushPromises()
    expect(model.loading.value).toBe(false)
    scope.stop()
  })

  it('错误上下文不被当作当前统计，最多同时查询三个详情', async () => {
    const service = api()
    service.getList = async query => ({
      ...list(query),
      candidates: Array.from({ length: 10 }, (_, i) => ({
        championId: i + 1,
        enemyWinRate: 0.4,
        play: 500
      }))
    })
    let active = 0
    let peak = 0
    service.getDetail = async (query, candidateId) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return {
        ...query,
        version: 'WRONG',
        candidateId,
        cachedAt: null,
        fetchedAt: 100,
        stale: false,
        candidateWinRate: 0.7,
        laneKillRate: null,
        play: 100
      }
    }
    const scope = effectScope()
    const model = scope.run(() =>
      useMatchup(() => ({ enemyId: 103, tier: 'emerald_plus', active: true }), service)
    )!
    await flushPromises()
    expect(peak).toBeLessThanOrEqual(3)
    expect(model.rows.value).toHaveLength(8)
    expect(model.rows.value[0].error).toBeTruthy()
    expect(model.rows.value[0].data).toBeUndefined()
    scope.stop()
  })
  it('切换敌方再返回保留该槽位手动分路，换英雄才失效', async () => {
    const context = reactive({ slot: 0, enemyId: 103, tier: 'emerald_plus' as const, active: true })
    const scope = effectScope()
    const model = scope.run(() => useMatchup(() => context, api()))!
    await flushPromises()
    model.setPosition('top')
    await flushPromises()
    context.slot = 1
    context.enemyId = 64
    await flushPromises()
    context.slot = 0
    context.enemyId = 103
    await flushPromises()
    expect(model.position.value).toBe('top')
    expect(model.manual.value).toBe(true)
    context.enemyId = 86
    await flushPromises()
    expect(model.manual.value).toBe(false)
    scope.stop()
  })
})
