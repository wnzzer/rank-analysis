import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'
import type { ChampionPoolEntry } from '../championPool'
import { aggregateChampionPool } from '../championPool'
import { TIME_WINDOW_HOURS, type MatchFilterState } from '../matchFilters'

/**
 * M1 B-测试(单元部分):MatchHistory 数据流与交互验收
 * - 50 场一次拉取,客户端 10 条/页切片(列表 / 趋势条 / 英雄池同源)
 * - 四维筛选(模式/英雄/胜负/时间窗口)与空态
 * - 联动事件链 hover-champion / leave-champion / pool-change
 * - 趋势格点击:当前页定位高亮,不在页内翻页并就地展开详情
 * - 行卡点击就地展开/收起(多开)
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

vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({ query: { name: 'Tester#0001' } })
  }
})

function makeGame(
  overrides: Partial<Game> & { stats?: Partial<ParticipantStats>; championId?: number } = {}
): Game {
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
    subteamPlacement: 0,
    ...overrides.stats
  }
  const participant: Participant = {
    win: stats.win,
    participantId: 1,
    teamId: 0,
    championId: overrides.championId ?? 1,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
  return {
    mvp: '',
    gameDetail: { participants: [], participantIdentities: [], endOfGameResult: '' },
    gameId: Math.floor(Math.random() * 1e9),
    gameCreationDate: new Date(Date.now() - 3_600_000).toISOString(),
    gameDuration: 1800,
    gameMode: '',
    gameType: '',
    mapId: 0,
    queueId: 420,
    queueName: '',
    platformId: '',
    participantIdentities: [],
    participants: [participant],
    ...overrides
  }
}

/** 模块加载时锚定"当前时间",保证两次 make50Games() 输出逐字段一致且时间窗口语义真实 */
const NOW = Date.now()

/**
 * 50 场样本(时间降序 i=0 最新):
 * - i 0..29 排位 420:i<20 胜
 * - i 30..49 灵活 440:全负
 * - 偶数 i 英雄 103,奇数 i 英雄 157
 * 汇总:胜 20 / 负 30;420 有 30 场,440 有 20 场;103/157 各 25 场
 */
function make50Games(): Game[] {
  const games: Game[] = []
  for (let i = 0; i < 50; i++) {
    const ranked = i < 30
    const win = ranked ? i < 20 : false
    games.push(
      makeGame({
        gameId: 1000 + i,
        queueId: ranked ? 420 : 440,
        championId: i % 2 === 0 ? 103 : 157,
        gameCreationDate: new Date(NOW - ((i + 1) * 3_600_000 - 60_000)).toISOString(),
        stats: { win }
      })
    )
  }
  return games
}

const stubs = {
  RecordCard: true,
  RecordCardSkeleton: true,
  MatchDetailInline: true,
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
    template: '<button class="n-button-stub" @click="$emit(\'click\')"><slot /></button>'
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
  }
}

async function mountWithData() {
  const invoke = vi.mocked((await import('@tauri-apps/api/core')).invoke)
  invoke.mockReset()
  invoke.mockImplementation((cmd: string) => {
    if (cmd === 'get_match_history_by_name') {
      return Promise.resolve({ games: { games: make50Games() }, begIndex: 0, endIndex: 49 })
    }
    if (cmd === 'get_champion_options') {
      return Promise.resolve([
        { label: '阿狸', realName: 'Ahri', value: 103, nickname: '狐狸' },
        { label: '亚索', realName: 'Yasuo', value: 157, nickname: '哈撒给' }
      ])
    }
    return Promise.resolve(null)
  })
  const MatchHistory = (await import('../MatchHistory.vue')).default
  const wrapper = mount(MatchHistory, { global: { stubs }, attachTo: document.body })
  await flushPromises()
  return { wrapper, invoke }
}

/** 通过触发 NSelect stub 的 update:value 模拟 v-model 变更(0=模式 1=英雄 2=胜负 3=时间) */
function setFilter(wrapper: VueWrapper, index: number, value: unknown) {
  const select = wrapper.findAllComponents({ name: 'NSelect' })[index]
  select.vm.$emit('update:value', value)
  return flushPromises()
}

describe('MatchHistory 数据流(M1 B-测试)', () => {
  // 每次挂载都要渲染 50 场趋势条 + 10 行卡,全量并行时首跑较慢,放宽超时
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(() => {
    // 隔离筛选持久化：上一用例写入的筛选会经 restoreFilters 污染后续挂载
    localStorage.removeItem('record.matchFilters')
    sessionStorage.removeItem('record.focusGameId')
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: vi.fn(),
      writable: true,
      configurable: true
    })
  })

  it('50 场一次拉取,首页仅渲染 10 条', async () => {
    const { wrapper, invoke } = await mountWithData()
    expect(invoke).toHaveBeenCalledWith('get_match_history_by_name', {
      name: 'Tester#0001',
      begIndex: 0,
      endIndex: 49
    })
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    expect(wrapper.text()).toContain('1/5')
    wrapper.unmount()
  })

  it('翻页到末页后仍可稳定显示末页（原「收集更多」入口已并入分页）', async () => {
    const { wrapper } = await mountWithData()
    const btns = wrapper.findAll('.n-pagination-stub button')
    const next = btns.at(-1)!
    for (let i = 0; i < 4; i++) {
      await next.trigger('click')
      await flushPromises()
    }
    expect(wrapper.text()).toContain('5/5')
    await next.trigger('click')
    expect(wrapper.text()).toContain('5/5')
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    wrapper.unmount()
  })

  it('胜负筛选:胜 20 场 2 页,负 30 场 3 页', async () => {
    const { wrapper } = await mountWithData()
    await setFilter(wrapper, 2, 'win')
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    expect(wrapper.text()).toContain('1/2')
    await setFilter(wrapper, 2, 'loss')
    expect(wrapper.text()).toContain('1/3')
    wrapper.unmount()
  })

  it('模式筛选:排位 420 -> 30 场 3 页', async () => {
    const { wrapper } = await mountWithData()
    await setFilter(wrapper, 0, 420)
    expect(wrapper.text()).toContain('1/3')
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    wrapper.unmount()
  })

  it('英雄筛选:阿狸 103 -> 25 场 3 页', async () => {
    const { wrapper } = await mountWithData()
    await setFilter(wrapper, 1, 103)
    expect(wrapper.text()).toContain('1/3')
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    wrapper.unmount()
  })

  it('时间窗口:近3小时命中 3 场;叠加胜负后空态,清除筛选复位', async () => {
    const { wrapper } = await mountWithData()
    await setFilter(wrapper, 3, TIME_WINDOW_HOURS[1])
    expect(wrapper.findAll('.list-item')).toHaveLength(3)
    expect(wrapper.text()).toContain('1/1')
    await setFilter(wrapper, 2, 'loss')
    expect(wrapper.text()).toContain('没有匹配的对局')
    expect(wrapper.text()).toContain('清除筛选')
    const clear = wrapper.findAll('button').find(b => b.text().includes('清除筛选'))
    await clear!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    expect(wrapper.text()).toContain('1/5')
    wrapper.unmount()
  })

  it('复位按钮清除全部筛选与页码', async () => {
    const { wrapper } = await mountWithData()
    await setFilter(wrapper, 2, 'win')
    expect(wrapper.text()).toContain('1/2')
    await wrapper.find('.toolbar-reset').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.list-item')).toHaveLength(10)
    expect(wrapper.text()).toContain('1/5')
    wrapper.unmount()
  })

  it('趋势条与列表同源:trendFiltered 随筛选变化', async () => {
    const { wrapper } = await mountWithData()
    const TrendBar = (await import('../TrendBar.vue')).default
    const trend = wrapper.findComponent(TrendBar)
    expect(trend.props('games')).toHaveLength(50)
    await setFilter(wrapper, 2, 'win')
    expect(trend.props('games')).toHaveLength(20)
    wrapper.unmount()
  })

  it('英雄池从 50 场上抛 pool-change', async () => {
    const { wrapper } = await mountWithData()
    const pool = wrapper.emitted('pool-change')!.at(-1)![0] as ChampionPoolEntry[]
    expect(pool).toEqual(aggregateChampionPool(make50Games()))
    wrapper.unmount()
  })

  it('hover / leave 行卡事件上抛', async () => {
    const { wrapper } = await mountWithData()
    const card = wrapper.findAllComponents({ name: 'RecordCard' })[0]
    card.vm.$emit('hover-champion', 103)
    card.vm.$emit('leave-champion')
    expect(wrapper.emitted('hover-champion')!.at(-1)).toEqual([103])
    expect(wrapper.emitted('leave-champion')!.at(-1)).toEqual([])
    wrapper.unmount()
  })

  it('趋势格点击:当前页对局定位高亮并滚动', async () => {
    // 假定时器:防止 1600ms 的闪烁清除定时器在断言前触发
    vi.useFakeTimers()
    const { wrapper } = await mountWithData()
    const TrendBar = (await import('../TrendBar.vue')).default
    wrapper.findComponent(TrendBar).vm.$emit('select-game', 1000)
    await flushPromises()
    const card = wrapper.find('[data-game-id="1000"]').findComponent({ name: 'RecordCard' })
    expect(card.classes()).toContain('list-item-flash')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    vi.useRealTimers()
    wrapper.unmount()
  })

  it('趋势格点击:不在当前页的对局翻页并就地展开', async () => {
    const { wrapper } = await mountWithData()
    // 1049 = 第 50 场(索引 49),落在第 5 页,不在首页
    const MatchDetailInline = (await import('../MatchDetailInline.vue')).default
    const TrendBar = (await import('../TrendBar.vue')).default
    wrapper.findComponent(TrendBar).vm.$emit('select-game', 1049)
    await flushPromises()
    expect(wrapper.text()).toContain('5/5')
    const detail = wrapper.findComponent(MatchDetailInline)
    expect(detail.exists()).toBe(true)
    expect(detail.props('game')?.gameId).toBe(1049)
    wrapper.unmount()
  })

  it('行卡点击就地展开详情,再次点击收起', async () => {
    const { wrapper } = await mountWithData()
    const MatchDetailInline = (await import('../MatchDetailInline.vue')).default
    const card = wrapper.findAllComponents({ name: 'RecordCard' })[0]
    card.vm.$emit('open-detail')
    await flushPromises()
    expect(wrapper.findComponent(MatchDetailInline).exists()).toBe(true)
    card.vm.$emit('open-detail')
    await flushPromises()
    expect(wrapper.findComponent(MatchDetailInline).exists()).toBe(false)
    wrapper.unmount()
  })

  it('多开:展开两张后再各收起,互不影响', async () => {
    const { wrapper } = await mountWithData()
    const MatchDetailInline = (await import('../MatchDetailInline.vue')).default
    const cards = wrapper.findAllComponents({ name: 'RecordCard' })
    cards[0].vm.$emit('open-detail')
    cards[1].vm.$emit('open-detail')
    await flushPromises()
    const details = wrapper.findAllComponents(MatchDetailInline)
    expect(details).toHaveLength(2)
    cards[0].vm.$emit('open-detail')
    await flushPromises()
    const detailsAfter = wrapper.findAllComponents(MatchDetailInline)
    expect(detailsAfter).toHaveLength(1)
    expect(detailsAfter[0].props('game')?.gameId).toBe(cards[1].props('games')?.gameId)
    wrapper.unmount()
  })

  it('一键展开全部:当前页 10 张全部就地展开,再点收起全部', async () => {
    const { wrapper } = await mountWithData()
    const MatchDetailInline = (await import('../MatchDetailInline.vue')).default
    expect(wrapper.find('.toolbar-expand-all').text()).toContain('展开全部')
    await wrapper.find('.toolbar-expand-all').trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents(MatchDetailInline)).toHaveLength(10)
    expect(wrapper.find('.toolbar-expand-all').text()).toContain('收起全部')
    await wrapper.find('.toolbar-expand-all').trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents(MatchDetailInline)).toHaveLength(0)
    expect(wrapper.find('.toolbar-expand-all').text()).toContain('展开全部')
    wrapper.unmount()
  })

  it('聚焦对局(focusGameId):清除筛选、翻到所在页并就地展开目标对局', async () => {
    const { wrapper } = await mountWithData()
    const MatchDetailInline = (await import('../MatchDetailInline.vue')).default
    // 先设一个英雄筛选(103 只有 25 场,不含 1049),验证聚焦时会清掉
    await setFilter(wrapper, 1, 103)
    expect(wrapper.text()).toContain('1/3')
    await wrapper.setProps({ focusGameId: 1049 })
    await flushPromises()
    expect(wrapper.emitted('focus-handled')).toBeTruthy()
    expect(wrapper.text()).toContain('5/5')
    const detail = wrapper.findComponent(MatchDetailInline)
    expect(detail.exists()).toBe(true)
    expect(detail.props('game')?.gameId).toBe(1049)
    wrapper.unmount()
  })

  it('英雄池点击命令(championFilter):按英雄筛选;再点同一英雄取消并同步选中态', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.setProps({ championFilter: 103 })
    await flushPromises()
    expect(wrapper.emitted('champion-filter-handled')).toBeTruthy()
    expect(wrapper.text()).toContain('1/3')
    expect((wrapper.emitted('filter-change')!.at(-1)![0] as MatchFilterState).championId).toBe(103)
    // 父级收到回执后会先把命令位复位为 0，再点同一英雄才能触发「取消」切换
    await wrapper.setProps({ championFilter: 0 })
    await wrapper.setProps({ championFilter: 103 })
    await flushPromises()
    expect(wrapper.text()).toContain('1/5')
    expect((wrapper.emitted('filter-change')!.at(-1)![0] as MatchFilterState).championId).toBe(0)
    wrapper.unmount()
  })
})
