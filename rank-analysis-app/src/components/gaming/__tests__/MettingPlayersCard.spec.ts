/**
 * MettingPlayersCard 组件测试：
 * - 默认模式：点击对局弹模态框（invoke get_game_by_id + n-modal）
 * - jumpToRecord 模式：点击对局只上抛 select-game，不再弹模态框/不再 invoke
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OneGamePlayer } from '../../record/type'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const stubs = {
  LazyImg: true,
  MatchDetailInline: true,
  NGrid: {
    name: 'NGrid',
    template: '<div class="n-grid-stub"><slot /></div>'
  },
  NGridItem: {
    name: 'NGridItem',
    template: '<div class="n-grid-item-stub"><slot /></div>'
  },
  NModal: {
    name: 'NModal',
    props: ['show'],
    template: '<div class="n-modal-stub" v-if="show"><slot /></div>'
  }
}

function makeMeetGame(overrides: Partial<OneGamePlayer> = {}): OneGamePlayer {
  return {
    gameCreatedAt: '2024-01-01T00:00:00Z',
    index: 0,
    gameId: 1000,
    puuid: 'puuid-1',
    gameName: 'Rival',
    tagLine: '0001',
    championId: 103,
    win: true,
    kills: 3,
    deaths: 2,
    assists: 5,
    isMyTeam: false,
    queueIdCn: '排位赛',
    ...overrides
  }
}

async function mountCard(props: Record<string, unknown> = {}) {
  const MettingPlayersCard = (await import('../MettingPlayersCard.vue')).default
  const wrapper = mount(MettingPlayersCard, {
    props: { meetGames: [makeMeetGame(), makeMeetGame({ gameId: 1001, win: false })], ...props },
    global: { stubs }
  })
  return wrapper
}

describe('MettingPlayersCard', () => {
  // 首跑需 transform naive-ui，放宽超时（与 MatchHistory.data.spec 一致）
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockReset()
  })

  it('渲染每场对局的英雄/胜负/友方标记', async () => {
    const wrapper = await mountCard()
    expect(wrapper.findAll('.game-card')).toHaveLength(2)
    expect(wrapper.find('.result-text').text()).toContain('胜利')
    expect(wrapper.find('.relation-badge').text()).toContain('敌方')
    wrapper.unmount()
  })

  it('默认模式:点击对局 invoke get_game_by_id 并打开模态框', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({ gameId: 1000 })
    const wrapper = await mountCard()
    await wrapper.findAll('.game-card')[0].trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith('get_game_by_id', { gameId: 1000 })
    expect(wrapper.findComponent({ name: 'NModal' }).props('show')).toBe(true)
    wrapper.unmount()
  })

  it('jumpToRecord 模式:点击对局只上抛 select-game,不 invoke 也不弹模态框', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const wrapper = await mountCard({ jumpToRecord: true })
    await wrapper.findAll('.game-card')[1].trigger('click')
    await flushPromises()
    expect(wrapper.emitted('select-game')!.at(-1)).toEqual([1001])
    expect(invoke).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'NModal' }).props('show')).toBe(false)
    wrapper.unmount()
  })
})
