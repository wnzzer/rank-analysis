/**
 * MatchDetailModal 复盘标签接线：复盘标签首次打开前不挂载（不拉时间线、不创建 AI 点评，避免没看
 * 复盘也计费）；头部「复盘」按钮切到复盘标签；行内 ✨ 切到复盘后（nextTick 拿到实例）调用
 * focusPlayer(pid, true)。
 * 真实 ReviewTab + 真实 useReviewModel；时间线拉取、英雄名、AI 点评与 Tauri invoke 用替身。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { gameB } from '../review/__tests__/fixtureModels'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetchTimeline: vi.fn(),
  useAi: vi.fn(),
  requestPlayer: vi.fn(),
  ensureOverview: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@renderer/services/ai/shared/timeline/fetch', () => ({
  supportsTimeline: (g: { mapId: number }) => g.mapId === 11 || g.mapId === 12,
  fetchMatchTimeline: h.fetchTimeline
}))
vi.mock('@renderer/services/ai/champion-names', async importOriginal => ({
  ...(await importOriginal<typeof import('@renderer/services/ai/champion-names')>()),
  loadChampionNames: () => Promise.resolve()
}))
vi.mock('@renderer/composables/useMatchAIAnalysis', () => ({ useMatchAIAnalysis: h.useAi }))
// 回放按钮与复制依赖 n-message-provider，与接线无关
vi.mock('@renderer/composables/useMatchReplay', async () => {
  const { ref } = await import('vue')
  return {
    useMatchReplay: () => ({
      canPlay: ref(false),
      busy: ref(false),
      buttonLabel: ref('回放'),
      disabledReason: ref(''),
      play: () => {}
    })
  }
})
vi.mock('@renderer/composables/useCopy', () => ({ useCopy: () => ({ copy: () => {} }) }))

import MatchDetailModal from '../MatchDetailModal.vue'

/** 重型/依赖存储的子组件：与接线无关，替身占位 */
const stubs = { PlayerNoteBadge: true, LazyImg: true, AssetTooltipContent: true }

function makeAi() {
  return {
    aiMode: ref<'overview' | 'player'>('overview'),
    aiTargetParticipantId: ref<number | null>(null),
    aiLoading: ref(false),
    aiStateLabel: ref(''),
    renderedAiResult: ref(''),
    ensureOverview: h.ensureOverview,
    requestPlayer: h.requestPlayer,
    runCurrentAiAnalysis: vi.fn(),
    resetOnGameChange: vi.fn()
  }
}

// 回归 fixture 已匿名去掉开局时间：补一个，头部日期格式化需要
const GAME = gameB({ gameCreationDate: '2026-10-01T12:00:00.000Z' })

async function mountModal() {
  const w = mount(MatchDetailModal, { props: { game: GAME }, global: { stubs } })
  await flushPromises()
  return w
}

/** 是否发生过时间线相关调用（门面替身或底层 invoke） */
const timelineCalls = () =>
  h.fetchTimeline.mock.calls.length +
  h.invoke.mock.calls.filter(([cmd]) => cmd === 'get_match_timeline').length

beforeEach(() => {
  setActivePinia(createPinia())
  for (const fn of Object.values(h)) fn.mockReset()
  h.invoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd === 'get_asset_details' ? [] : null)
  )
  h.fetchTimeline.mockResolvedValue({ timeline: null, status: 'unavailable' })
  h.useAi.mockImplementation(makeAi)
})

describe('MatchDetailModal 记分板红蓝方标注', () => {
  it('每个队伍区块头部显示蓝方/红方药丸，并带对应阵营色类', async () => {
    const w = await mountModal()
    const sections = w.findAll('.match-detail-team-section')
    expect(sections).toHaveLength(2)
    const sides = sections.map(sec => sec.attributes('data-side')).sort()
    expect(sides).toEqual(['blue', 'red'])
    for (const sec of sections) {
      const pill = sec.find('[data-test="side-pill"]')
      const side = sec.attributes('data-side')
      expect(pill.text()).toBe(side === 'blue' ? '蓝方' : '红方')
      expect(pill.classes()).toContain(`match-detail-side-pill--${side}`)
      expect(sec.classes()).toContain(`match-detail-team-section--${side}`)
      // 胜负标题仍保留
      expect(sec.find('.match-detail-team-title').text()).toMatch(/^[胜败]方$/)
    }
  })
})

describe('MatchDetailModal 复盘标签接线', () => {
  it('打开复盘标签前：不挂载复盘、不创建 AI 点评、不拉时间线', async () => {
    const w = await mountModal()
    expect(w.find('.match-detail-row').exists()).toBe(true)
    expect(w.find('[data-test="review-tab"]').exists()).toBe(false)
    expect(h.useAi).not.toHaveBeenCalled()
    expect(h.ensureOverview).not.toHaveBeenCalled()
    expect(timelineCalls()).toBe(0)
  })

  it('头部「复盘」按钮切到复盘标签，此时才拉时间线并生成整局点评', async () => {
    const w = await mountModal()
    await w.find('.match-detail-ai-button').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="review-tab"]').exists()).toBe(true)
    expect(w.find('.match-detail-body--board').attributes('style')).toContain('display: none')
    expect(h.useAi).toHaveBeenCalledTimes(1)
    expect(h.ensureOverview).toHaveBeenCalledTimes(1)
    expect(h.fetchTimeline).toHaveBeenCalledTimes(1)
    expect(h.requestPlayer).not.toHaveBeenCalled()
  })

  it('行内 ✨：切到复盘并对该玩家 focusPlayer(pid, true)（生成单人点评）', async () => {
    const w = await mountModal()
    // 选一个非本人的行（本人是 ReviewTab 默认选中，断言选中才有意义）
    const target = w.findAll('.match-detail-row').find(r => !r.classes('match-detail-row-me'))!
    // 行 → participantId：经头像替身的英雄 id 反查（同局英雄不重复）
    const championId = Number(
      target.find('.match-detail-player-avatar').attributes('src')!.split('/champion/')[1]
    )
    // 记分板十人取自 gameDetail（顶层 participants 只有本人）
    const expectedPid = GAME.gameDetail.participants.find(
      p => p.championId === championId
    )!.participantId
    await target.find('.match-detail-player-ai-trigger').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="review-tab"]').exists()).toBe(true)
    expect(h.requestPlayer).toHaveBeenCalledTimes(1)
    expect(h.requestPlayer).toHaveBeenCalledWith(expectedPid)
    // ReviewTab 同时选中该玩家（对位总览高亮）
    const selected = w.find('[data-test="matchup-player"].is-selected')
    expect(selected.exists()).toBe(true)
    expect(selected.attributes('data-pid')).toBe(String(expectedPid))
  })
})
