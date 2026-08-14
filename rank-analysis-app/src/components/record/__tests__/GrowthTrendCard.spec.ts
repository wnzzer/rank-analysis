/**
 * GrowthTrendCard 组件单元测试
 *
 * 验证：
 * - 有样本时渲染 6 项趋势指标（胜率/KDA/参团率/补刀/视野/平均经济）
 * - 无样本时渲染空态提示、按钮禁用
 * - 点击「生成报告」调用 composable.generate，结果渲染进 AI 内容区
 * - 有结果后按钮文案变为「重新生成」
 *
 * 说明：AI 状态来自 useGrowthReport composable（其自身在 composable spec 里覆盖），
 * 这里 mock 掉它，把组件交互收敛到 UI 层。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { RecentData } from '@renderer/types/domain/analysis'

const generate = vi.fn()
const loading = ref(false)
const result = ref('')
vi.mock('@renderer/composables/useGrowthReport', () => ({
  useGrowthReport: () => ({ loading, result, renderedResult: result, generate })
}))

/** 分时曲线 mock：状态可由测试注入 */
const curveState = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue')
  return {
    curve: ref<import('@renderer/components/record/minuteCurve').AggregatedMinuteCurve | null>(
      null
    ),
    curveLoading: ref(false),
    curveError: ref(false),
    load: vi.fn()
  }
})
vi.mock('@renderer/composables/useMinuteCurve', () => ({
  MINUTE_CURVE_LIMIT: 10,
  useMinuteCurve: () => ({
    curve: curveState.curve,
    loading: curveState.curveLoading,
    error: curveState.curveError,
    load: curveState.load,
    reset: vi.fn()
  })
}))

import GrowthTrendCard from '../GrowthTrendCard.vue'
import type { Game } from '@renderer/types/domain/match'

const stubs = {
  Card: { template: '<div><slot /></div>' },
  Button: {
    emits: ['click'],
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  Flex: { template: '<div :style="$attrs.style"><slot /></div>' },
  Text: { template: '<span><slot /></span>' },
  Spin: { template: '<span class="n-spin-stub" />' }
}

function recentData(overrides: Partial<RecentData> = {}): RecentData {
  return {
    kda: 3.2,
    kills: 6.5,
    deaths: 4.1,
    assists: 7.8,
    wins: 0,
    losses: 0,
    selectMode: 420,
    selectModeCn: '单双排',
    selectWins: 6,
    selectLosses: 4,
    flexWins: 0,
    flexLosses: 0,
    groupRate: 55,
    averageGold: 13200,
    goldRate: 21,
    averageDamageDealtToChampions: 20480,
    damageDealtToChampionsRate: 24,
    samples: 10,
    averageCsPerMin: 6.8,
    averageVisionScore: 27.4,
    oneGamePlayers: {},
    friendAndDispute: {
      friendsRate: 0,
      disputeRate: 0,
      friendsSummoner: [],
      disputeSummoner: []
    },
    ...overrides
  }
}

describe('GrowthTrendCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loading.value = false
    result.value = ''
  })

  function mountCard(recent: RecentData) {
    return mount(GrowthTrendCard, {
      props: { recentData: recent, mode: '全部', isDark: true },
      global: { stubs }
    })
  }

  it('有样本时渲染 6 项趋势指标', () => {
    const wrapper = mountCard(recentData())
    const text = wrapper.text()
    expect(text).toContain('近 20 场趋势')
    expect(text).toContain('60%') // 6 胜 4 负
    expect(text).toContain('KDA')
    expect(text).toContain('55%')
    expect(text).toContain('6.8')
    expect(text).toContain('27.4')
    expect(text).toContain('13k')
  })

  it('无样本时渲染空态且按钮禁用', () => {
    const wrapper = mountCard(recentData({ samples: 0, selectWins: 0, selectLosses: 0 }))
    expect(wrapper.text()).toContain('暂无有效样本')
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('点击「生成报告」调用 generate 并渲染流式结果', async () => {
    const wrapper = mountCard(recentData())
    await wrapper.find('button').trigger('click')
    expect(generate).toHaveBeenCalledTimes(1)

    result.value = '- 状态：**补刀**稳定'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ai-growth-content').text()).toContain('- 状态：')
  })

  it('有结果后按钮文案变为「重新生成」', async () => {
    result.value = '旧报告'
    const wrapper = mountCard(recentData())
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button').text()).toBe('重新生成')
  })
})

describe('GrowthTrendCard 分时曲线（D-P3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    curveState.curve.value = null
    curveState.curveLoading.value = false
    curveState.curveError.value = false
  })

  function gameOf(id: number): Game {
    return {
      mvp: '1',
      gameDetail: null as unknown as Game['gameDetail'],
      gameId: id,
      gameCreationDate: '',
      gameDuration: 0,
      gameMode: 'CLASSIC',
      gameType: '',
      mapId: 11,
      queueId: 420,
      queueName: '单双排',
      platformId: 'TJ100',
      participantIdentities: [],
      participants: []
    }
  }

  function mountWithGames(games: Game[] = [], myPuuid = 'puuid-me') {
    return mount(GrowthTrendCard, {
      props: { recentData: recentData(), mode: '全部', isDark: true, games, myPuuid },
      global: { stubs }
    })
  }

  it('无游戏列表时「查看」按钮禁用（无数据源）', () => {
    const wrapper = mountWithGames([], '')
    const buttons = wrapper.findAll('button')
    const curveBtn = buttons[buttons.length - 1]
    expect(curveBtn.text()).toBe('查看')
    expect(curveBtn.attributes('disabled')).toBeDefined()
  })

  it('点击「查看」展开曲线：调用 load 并渲染三条折线', async () => {
    const wrapper = mountWithGames([gameOf(1), gameOf(2)], 'puuid-me')
    const buttons = wrapper.findAll('button')
    // 展开瞬间 curve 尚空 → 触发 load
    await buttons[buttons.length - 1].trigger('click')
    expect(curveState.load).toHaveBeenCalledTimes(1)
    // 数据异步就绪后渲染三条折线（模拟 load 结果写入）
    curveState.curve.value = {
      minutes: [0, 1, 2],
      cs: [0, 4, 9],
      deaths: [0, 1, 1],
      fights: [0, 0.5, 0.5],
      sourceCount: 2
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('svg')).toHaveLength(3)
    expect(wrapper.text()).toContain('补刀（累计）')
    expect(wrapper.text()).toContain('死亡（累计）')
    expect(wrapper.text()).toContain('参团击杀/分钟')
    expect(wrapper.text()).toContain('近 2 场平均')
  })

  it('curve 为空时仍渲染面板框架（数据由 load 异步填充）', async () => {
    const wrapper = mountWithGames([gameOf(1)], 'puuid-me')
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1].trigger('click')
    expect(curveState.load).toHaveBeenCalledTimes(1)
  })

  it('再次点击「收起」清空面板', async () => {
    const wrapper = mountWithGames([gameOf(1)], 'puuid-me')
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1].trigger('click')
    await buttons[buttons.length - 1].trigger('click')
    expect(wrapper.find('.curve-panel').exists()).toBe(false)
  })
})
