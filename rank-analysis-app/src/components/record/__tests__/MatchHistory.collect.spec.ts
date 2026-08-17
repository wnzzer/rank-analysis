import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type {
  Game,
  MatchHistory,
  Participant,
  ParticipantStats
} from '@renderer/types/domain/match'

/**
 * collectMode（跨区一键全量收集）组件验收：
 * - 跨区模式渲染「收集全部」按钮，非跨区不渲染
 * - 点击后逐页合并，自然收尾后按钮禁用并显示全量场数
 * - 收集中再次点击 = 取消，保留已收集部分，按钮恢复可续收
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<typeof import('naive-ui')>('naive-ui')
  return {
    ...actual,
    useLoadingBar: () => ({ start: vi.fn(), finish: vi.fn(), error: vi.fn() })
  }
})

/** invoke mock 的最小形状（本文件只 mock 两个命令；返回类型与用例无关） */
type InvokeLike = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type InvokeMock = { mockImplementation: (fn: InvokeLike) => void } & ReturnType<typeof vi.fn>

/** 已持久化的跨区收集成果（模拟上次收集落库），默认空数组 = 无已存数据 */
const { savedCollected } = vi.hoisted(() => ({
  savedCollected: vi.fn<[], Game[]>(() => [])
}))

/** routeQuery 由 vi.hoisted 声明：mock 工厂与用例内都能安全引用；region 可选（本地模式用例置空） */
const { routeQuery } = vi.hoisted(() => ({
  routeQuery: vi.fn<[], { name: string; region?: string }>(() => ({
    name: 'Tester#0001',
    region: 'HN10'
  }))
}))

/** 本区（无 region）时 get_current_sgp_region 的返回值；默认返回本区 platformId（LCU 已连接） */
const { currentRegion } = vi.hoisted(() => ({
  currentRegion: vi.fn<[], string | null>(() => 'HN10')
}))

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<typeof import('naive-ui')>('naive-ui')
  return {
    ...actual,
    useLoadingBar: () => ({ start: vi.fn(), finish: vi.fn(), error: vi.fn() })
  }
})

vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRoute: () => ({ query: routeQuery() }) }
})

function makeGame(gameId: number): Game {
  const stats: ParticipantStats = {
    win: true,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    perk0: 0,
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    goldEarned: 0,
    goldSpent: 0,
    totalDamageDealtToChampions: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalHeal: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    damageDealtToTurrets: 0,
    groupRate: 0,
    goldEarnedRate: 0,
    damageDealtToChampionsRate: 0,
    damageTakenRate: 0,
    healRate: 0,
    playerSubteamId: 0,
    subteamPlacement: 0
  }
  const participant: Participant = {
    win: true,
    participantId: 1,
    teamId: 0,
    championId: 1,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
  return {
    mvp: '',
    gameDetail: { participants: [], participantIdentities: [], endOfGameResult: '' },
    gameId,
    gameCreationDate: new Date(1_700_000_000_000 - gameId).toISOString(),
    gameDuration: 1800,
    gameMode: '',
    gameType: '',
    mapId: 0,
    queueId: 420,
    queueName: '',
    platformId: '',
    participantIdentities: [],
    participants: [participant]
  }
}

/** 全区战绩总量：初始拉取(0..49) + 收集 3 满页(50..199) = 199 场，之后空页 */
const TOTAL_GAMES = 199
function mockSgpFetch(invoke: InvokeMock, delayMs = 5) {
  invoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_sgp_match_history_by_name') {
      const { begIndex = 0, count = 50 } = (args ?? {}) as { begIndex?: number; count?: number }
      // 满页返回 count 条，直到 TOTAL_GAMES 之后的空页（= 收集完毕）
      const games: Game[] = []
      for (let id = begIndex; id < begIndex + count && id < TOTAL_GAMES; id++) {
        games.push(makeGame(id))
      }
      const result: MatchHistory = {
        platformId: 'HN10',
        begIndex,
        endIndex: 0,
        games: { games }
      }
      return new Promise(resolve => setTimeout(() => resolve(result), delayMs))
    }
    if (cmd === 'get_champion_options') return Promise.resolve([])
    if (cmd === 'get_current_sgp_region') return Promise.resolve(currentRegion())
    if (cmd === 'load_collected_games') return Promise.resolve(savedCollected())
    if (cmd === 'clear_collected_games') return Promise.resolve(null)
    return Promise.resolve(null)
  })
}

const stubs = {
  RecordCard: true,
  RecordCardSkeleton: true,
  MatchDetailInline: true,
  TrendBar: true,
  NPagination: {
    name: 'NPagination',
    template:
      '<div class="n-pagination-stub"><slot name="prev" /><slot name="label" /><slot name="next" /></div>'
  },
  NEmpty: {
    name: 'NEmpty',
    template: '<div class="n-empty-stub">{{ description }}<slot /><slot name="extra" /></div>',
    props: ['description']
  },
  NButton: {
    name: 'NButton',
    template:
      '<button class="n-button-stub" :disabled="disabled" :class="{ loading }" @click="$emit(\'click\')"><slot /></button>',
    props: ['disabled', 'loading']
  },
  NSelect: {
    name: 'NSelect',
    template: '<div class="n-select-stub" />',
    props: ['value'],
    emits: ['update:value']
  },
  NFlex: {
    name: 'NFlex',
    template: '<div class="n-flex-stub"><slot /></div>'
  },
  NIcon: true,
  NTooltip: {
    name: 'NTooltip',
    template: '<div class="n-tooltip-stub"><slot name="trigger" /></div>'
  },
  NPopconfirm: {
    name: 'NPopconfirm',
    template: '<div class="n-popconfirm-stub"><slot name="trigger" /><slot /></div>'
  }
}

async function mountHistory() {
  const invoke = vi.mocked((await import('@tauri-apps/api/core')).invoke) as unknown as InvokeMock
  mockSgpFetch(invoke)
  const MatchHistory = (await import('../MatchHistory.vue')).default
  const wrapper = mount(MatchHistory, { global: { stubs }, attachTo: document.body })
  await flushPromises()
  // 等初始 SGP 拉取（5ms 模拟延迟）落定，保证 sgpStartIndex 已是 50
  await new Promise(r => setTimeout(r, 20))
  return { wrapper, invoke }
}

function collectButton(wrapper: VueWrapper) {
  return wrapper.find('.toolbar-collect')
}

describe('MatchHistory collectMode（跨区全量收集）', () => {
  // 首测需冷加载完整组件依赖（naive-ui importActual），放宽超时（同 MatchHistory.data.spec）
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(() => {
    vi.clearAllMocks()
    routeQuery.mockImplementation(() => ({ name: 'Tester#0001', region: 'HN10' }))
    savedCollected.mockReturnValue([])
    currentRegion.mockReturnValue('HN10')
  })

  it('跨区模式渲染「收集全部」按钮', async () => {
    const { wrapper } = await mountHistory()
    expect(collectButton(wrapper).exists()).toBe(true)
    expect(collectButton(wrapper).text()).toContain('收集全部')
    wrapper.unmount()
  })

  it('本区模式（无 region，LCU 已连接）：渲染「收集全部」（SGP 支持本区深翻页）', async () => {
    routeQuery.mockReturnValue({ name: 'Tester#0001' })
    currentRegion.mockReturnValue('HN10')
    const { wrapper } = await mountHistory()
    expect(collectButton(wrapper).exists()).toBe(true)
    expect(collectButton(wrapper).text()).toContain('收集全部')
    wrapper.unmount()
  })

  it('LCU 未连接（currentRegion 为空）时不渲染收集按钮', async () => {
    routeQuery.mockReturnValue({ name: 'Tester#0001' })
    currentRegion.mockReturnValue(null)
    const { wrapper } = await mountHistory()
    expect(collectButton(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('点击收集全部：逐页合并至空页终止，按钮禁用并显示全量场数', async () => {
    const { wrapper } = await mountHistory()
    // 初始 load：0..49（50 场），sgpStartIndex=50
    await collectButton(wrapper).trigger('click')
    await new Promise(r => setTimeout(r, 80))
    await flushPromises()
    expect(collectButton(wrapper).text()).toContain('已全量 199 场')
    expect(collectButton(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('收集中再次点击 = 取消：保留已收集部分，按钮恢复「继续收集」', async () => {
    const { wrapper } = await mountHistory()
    await collectButton(wrapper).trigger('click') // 开始收集
    expect(collectButton(wrapper).text()).toContain('收集中')
    await collectButton(wrapper).trigger('click') // 立即取消
    await new Promise(r => setTimeout(r, 60))
    await flushPromises()
    expect(collectButton(wrapper).text()).toContain('继续收集')
    expect(collectButton(wrapper).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('MatchHistory 清空跨区收集', () => {
  // 冷加载组件依赖，放宽超时（同 collectMode 块）
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(() => {
    vi.clearAllMocks()
    routeQuery.mockImplementation(() => ({ name: 'Tester#0001', region: 'HN10' }))
    savedCollected.mockReturnValue([])
    currentRegion.mockReturnValue('HN10')
  })

  function clearButton(wrapper: VueWrapper) {
    return wrapper.find('.toolbar-clear-collected')
  }

  it('已有持久化成果时渲染「清空已收」按钮', async () => {
    savedCollected.mockReturnValue([makeGame(0), makeGame(1)])
    const { wrapper } = await mountHistory()
    expect(clearButton(wrapper).exists()).toBe(true)
    wrapper.unmount()
  })

  it('无持久化成果时不渲染「清空已收」按钮', async () => {
    savedCollected.mockReturnValue([])
    const { wrapper } = await mountHistory()
    expect(clearButton(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('LCU 未连接（currentRegion 为空）即使有持久化记录也不渲染收集/清空按钮', async () => {
    savedCollected.mockReturnValue([makeGame(0)])
    routeQuery.mockReturnValue({ name: 'Tester#0001' })
    currentRegion.mockReturnValue(null)
    const { wrapper } = await mountHistory()
    expect(clearButton(wrapper).exists()).toBe(false)
    expect(collectButton(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('确认清空：调用 clear_collected_games 并回到 50 场窗口（按钮消失、可重新收集）', async () => {
    savedCollected.mockReturnValue([makeGame(0), makeGame(1), makeGame(2)])
    const { wrapper, invoke } = await mountHistory()
    expect(clearButton(wrapper).exists()).toBe(true)

    // 确认 popconfirm → 清空落库 → 重新加载（load 已置空）
    savedCollected.mockReturnValue([])
    wrapper.findComponent({ name: 'NPopconfirm' }).vm.$emit('positive-click')
    await new Promise(r => setTimeout(r, 20))
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('clear_collected_games', {
      region: 'HN10',
      name: 'Tester#0001'
    })
    expect(clearButton(wrapper).exists()).toBe(false)
    expect(collectButton(wrapper).text()).toContain('收集全部')
    wrapper.unmount()
  })
})
