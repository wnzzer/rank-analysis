/**
 * Gaming.vue 情报横幅「ban 条 / 阶段 stepper 常驻」回归测试。
 *
 * 背景：`gaming-intel-banner` 上个 commit 改成常驻（不再限定选人期），但阶段 stepper
 * （`v-if="champSelectStage"`）与双方 ban 条（`v-if="hasBans"`）仍只在选人期可见——
 * 因为它们读的 `sessionData.champSelect`，后端只在 ChampSelect 期间下发该字段
 * （`skip_serializing_if`），一旦离开选人期，下一个事件包里这个字段直接缺席，
 * `useSessionSync.applyMeta` 用 `data.champSelect` 覆盖旧值，undefined 把内容冲掉。
 *
 * 修复：Gaming.vue 自己留一份「最后一次选人期快照」`lastChampSelect`，
 * `displayChampSelect = sessionData.champSelect ?? lastChampSelect`，stepper/ban 条
 * 的数据源从 `sessionData.champSelect` 切到 `displayChampSelect`，离开选人期后继续
 * 展示最后一次快照供回看。
 *
 * 关键清除时机：新一局进入 ChampSelect、而新的 champSelect 数据还没到达的窗口里，
 * 若不清掉快照会显示上一局的 ban——比不显示更糟（用户会以为那是本局的）。
 * 所以监听 `sessionData.phase` 从非 ChampSelect 变为 ChampSelect 时立即清空快照，
 * 具体验证见本文件第三个用例。
 *
 * 挂载策略与 mock 约定完全照抄同目录 Gaming.tierSelect.spec.ts（见其文件头注释），
 * 这里不重复解释：真实 naive-ui 全量注册 + stub 内部组件名 'Select'、mock tauri
 * invoke/listen/getCurrentWindow、ipc、@renderer/services/ai，session 数据经
 * session-basic-info 事件驱动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {}
}))

const eventListeners: Record<string, Array<(event: { payload: unknown }) => void>> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    ;(eventListeners[name] ??= []).push(cb)
    return () => {
      eventListeners[name] = (eventListeners[name] ?? []).filter(f => f !== cb)
    }
  })
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' })
}))

vi.mock('@renderer/services/ai', () => ({
  analyzeChampSelectWithAIStream: vi.fn(),
  analyzeGameWithAIStream: vi.fn()
}))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import Gaming from '../Gaming.vue'
import type { SessionData } from '@renderer/types/domain/gaming'

const mockGetConfig = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

function opggStatus(mode: string, tier: string) {
  return { mode, patch: '16.12', fetchedAt: Date.now(), stale: false, championCount: 10, tier }
}

const stubs = {
  Select: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template:
      '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
      '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
      '</select>'
  }
}

/**
 * 派发一次 session-basic-info。champSelect 缺省不传（模拟非选人期后端不下发该字段），
 * 传入时会带上结构化选人视图（stage + 双方 ban 列表）。
 */
function emitPhase(
  phase: SessionData['phase'],
  champSelect?: { stage: string; myBans: number[]; theirBans: number[] }
) {
  const payload: SessionData = {
    phase,
    type: 'RANKED_SOLO_5x5',
    typeCn: '排位赛',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 100,
    subteams: [],
    champSelect
  }
  for (const cb of eventListeners['session-basic-info'] ?? []) cb({ payload })
}

async function flush(w: { vm: { $nextTick: () => Promise<void> } }) {
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(eventListeners)) delete eventListeners[key]

  mockGetConfig.mockImplementation(async (key: string) => {
    if (key === 'settings.opgg.tier') return 'emerald_plus'
    if (key === 'matchHistoryCount') return 4
    return undefined
  })
  mockPut.mockImplementation(async () => undefined)
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_opgg_status') return opggStatus('ranked', 'emerald_plus')
    if (cmd === 'update_opgg_data') return opggStatus('ranked', 'emerald_plus')
    if (cmd === 'get_bp_decision') return null
    if (cmd === 'get_champion_options') return []
    return undefined
  })
})

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }]
})

describe('Gaming.vue ban 条 / 阶段 stepper 常驻（挂载真实组件）', () => {
  it('选人期有 ban 数据 → ban 条渲染', async () => {
    const w = mount(Gaming, {
      global: { plugins: [naive, testRouter], stubs }
    })

    await flush(w)
    emitPhase('ChampSelect', { stage: 'banning', myBans: [1, 2], theirBans: [3] })
    await flush(w)

    expect(w.find('.ban-bar').exists()).toBe(true)
    expect(w.findAll('.ban-icon')).toHaveLength(3)

    w.unmount()
  })

  /**
   * 核心回归点：离开选人期后端不再下发 champSelect（payload 里该字段整体缺席），
   * 但 ban 条应继续展示「最后一次选人期快照」，内容与选人期结束时一致——
   * 不是清空、也不是显示别的数据。
   */
  it('phase 变为 EndOfGame、后端不再下发 champSelect → ban 条仍渲染且内容不变', async () => {
    const w = mount(Gaming, {
      global: { plugins: [naive, testRouter], stubs }
    })

    await flush(w)
    emitPhase('ChampSelect', { stage: 'finalization', myBans: [10, 11], theirBans: [20] })
    await flush(w)
    expect(w.find('.ban-bar').exists()).toBe(true)

    // EndOfGame payload 不带 champSelect 字段，模拟后端 skip_serializing_if 的真实行为。
    emitPhase('EndOfGame')
    await flush(w)

    expect(w.find('.ban-bar').exists()).toBe(true)
    const bans = w.findAll('.ban-icon').map(el => el.attributes('alt'))
    expect(bans).toEqual(['ban-10', 'ban-11', 'ban-20'])

    w.unmount()
  })

  /**
   * 防脏数据核心断言：新一局进入 ChampSelect、champSelect 数据尚未到达（payload 里
   * 该字段仍缺席，只有 phase 先行更新），此时不应继续显示上一局遗留的快照 ban。
   */
  it('新一局进入 ChampSelect、champSelect 数据尚未到达 → 不再显示上一局的 ban', async () => {
    const w = mount(Gaming, {
      global: { plugins: [naive, testRouter], stubs }
    })

    await flush(w)
    emitPhase('ChampSelect', { stage: 'finalization', myBans: [10, 11], theirBans: [20] })
    await flush(w)
    emitPhase('EndOfGame')
    await flush(w)
    expect(w.find('.ban-bar').exists()).toBe(true) // 快照仍在，回看上一局

    // 新一局：phase 先行推进到 ChampSelect，champSelect 字段尚未到达（缺席）。
    emitPhase('ChampSelect')
    await flush(w)

    expect(w.find('.ban-bar').exists()).toBe(false)

    w.unmount()
  })
})
