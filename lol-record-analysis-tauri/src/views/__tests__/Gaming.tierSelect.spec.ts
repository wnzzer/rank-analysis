/**
 * Gaming.vue 选人期横幅段位下拉「v-model + @update:value 双写同一 ref」缺陷回归测试。
 *
 * 背景（Critical 缺陷，Task 4 设置页栽过一次）：
 * 段位下拉若同时写 `v-model:value="opggTier"` 与 `@update:value="onTierChange"`，
 * Vue 3 会把两者编译进同一个 onUpdate:value 处理器数组，按下标顺序同步派发：
 * 下标 0 是 v-model 的自动赋值函数，下标 1 才是 onTierChange。`opggTier` 是从
 * useOpggTier() 解构出来的 tier ref（同一个 Ref 对象），所以等 onTierChange(next)
 * 被调用时，tier.value 已经被 v-model 写成了 next。而 useOpggTier.switchTier 开头有一句
 * no-op 守卫 `if (next === tier.value) return true`——每次真实切换都会命中，于是
 * switchTier 直接返回 true，跳过写配置、跳过 invoke('update_opgg_data')、跳过
 * bumpOpggRevision，失败反馈分支也永远走不到。用户看到下拉跳到了新段位（v-model 直接
 * 写的），实际什么都没发生——是「伪装成功」的缺陷。
 *
 * 修复：`Gaming.vue` 的段位 <n-select> 用单向绑定 `:value="opggTier"`，保留
 * `@update:value="onTierChange"` 作为唯一写入路径，`switchTier` 内部是 `tier` 唯一写者。
 *
 * 为什么直接挂载真实 Gaming.vue（而不是手写复现组件）：
 * 上一个任务（设置页）第一次就是写了手写 fixture 复制品，真实文件毫无回归保护，
 * 测试却全绿，被评审打回重做。这里把接线缺陷直接长在生产文件上：如果有人把
 * Gaming.vue 的接线改回 v-model:value，本文件不用同步改任何 fixture，测试会直接
 * 对生产文件转红（本文件末尾的 revert 实验已实测验证，见 task-5-report.md）。
 *
 * 关键陷阱——不能只断言 `invoke` 被 'update_opgg_data' 调用过：
 * Gaming.vue 自己的 onMounted 里有一句兜底刷新
 * `Promise.all([ensureOpggData('ranked'), ensureOpggData('aram')])`，mount 阶段就会
 * 各调用一次 `invoke('update_opgg_data', { mode: 'ranked' | 'aram' })`。若测试不清空
 * mock 调用记录，即使 switchTier 因 v-model 而完全空转，
 * `expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })`
 * 也会因为 mount 阶段的调用而假阳性通过——这就失去了回归保护的意义。所以在触发
 * 段位切换前必须 mockClear，只认切换后新增的调用。
 *
 * 挂载策略：
 * - 真实 naive-ui plugin 全量注册（Gaming.vue 全篇用 `<n-xxx>` 全局组件写法，无本地
 *   导入），只用 global.stubs 把运行时组件名 'Select'（naive-ui 内部注册名不带 N 前缀）
 *   换成受控的原生 <select>，与 Automation.tierSelect.spec.ts / BpSuggestModal.spec.ts
 *   同一约定。Gaming.vue 全篇只有这一个 <n-select>，无需像 Automation 那样按选项内容
 *   定位。
 * - session-basic-info 载荷的 subteams 留空数组：orderedSubteams 因此为空，
 *   SubteamCard 一次都不会挂载；bp.decision 初始为 null 且 get_bp_decision mock 返回
 *   null，BpDecisionBar 内部 `v-if="decision"` 不成立、不渲染任何内容。两个真正"重"的
 *   子组件天然不进入渲染路径，不需要额外 stub，也就不必在 stub 列表里维护它们。
 * - useGameState 用到的 `@tauri-apps/api/window`（getCurrentWindow）与 useSessionSync /
 *   useBpDecision 用到的 `@tauri-apps/api/event`（listen）都需要 mock；listen 的 mock
 *   按事件名收集回调（同一事件名 useSessionSync/useGameState 各注册一份），供测试手动
 *   派发 session-basic-info 事件把 phase 推进到 ChampSelect。
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
  // ai/stream.ts 静态引入了 Channel（仅在真正发起 AI 分析时才 new），
  // 本测试不触发 AI 分析，占位即可，避免命名导出缺失。
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

// Gaming.vue 通过 useGamingAIAnalysis 静态引入 @renderer/services/ai；本测试不点击
// AI 分析按钮，用轻量 stub 换掉真实实现，避免拖入 prompts/matchDetail 整条分析链路。
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
// jsdom 下没有 n-message-provider，替换 useMessage 为共享 mock（其余 naive-ui 导出保持原样），
// 与 Automation.tierSelect.spec.ts / UnifiedTagRow.spec.ts 同一约定。
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

function opggStatus(mode: string) {
  return { mode, patch: '16.12', fetchedAt: Date.now(), stale: false, championCount: 10 }
}

// 与 Automation.tierSelect.spec.ts / BpSuggestModal.spec.ts 同一约定：真实 <select>
// 承接 <n-select>，value 受控回显 + change 时 emit update:value，便于用 DOM setValue 驱动。
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

/** 派发一次 session-basic-info，把 sessionData 推进到选人期（ChampSelect）。 */
function emitChampSelect() {
  const payload: SessionData = {
    phase: 'ChampSelect',
    type: 'RANKED_SOLO_5x5',
    typeCn: '排位赛',
    queueId: 420, // != 450，映射为 opggMode 'ranked'
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 100,
    subteams: []
  }
  for (const cb of eventListeners['session-basic-info'] ?? []) cb({ payload })
}

/** 让 onMounted 里的一串 await（listen 多次 / requestSessionData / getConfigByIpc 等）落定。 */
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
  mockPut.mockResolvedValue(undefined)
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_opgg_status') return opggStatus('ranked')
    if (cmd === 'update_opgg_data') return opggStatus('ranked')
    if (cmd === 'get_bp_decision') return null
    if (cmd === 'get_champion_options') return []
    return undefined
  })
})

// Gaming.vue 自身调用 useRouter()（仅在存规则后跳转设置页时才 .push，本测试不触发），
// 但 useRouter() 的注入要求组件树装了 router 插件，否则控制台会刷 Vue 警告；装一个
// 内存路由消掉噪音，不代表本测试关心路由跳转本身。
const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }]
})

describe('Gaming.vue 选人期横幅段位下拉接线（挂载真实组件）', () => {
  it('切换段位：真的写配置、强制重拉 OP.GG ranked 快照', async () => {
    const w = mount(Gaming, {
      global: { plugins: [naive, testRouter], stubs }
    })

    await flush(w)
    emitChampSelect()
    await flush(w)

    const select = w.find('select')
    expect(select.exists()).toBe(true)
    // 初始值来自 useOpggTier().loadTier() 读到的 'emerald_plus'。
    expect((select.element as HTMLSelectElement).value).toBe('emerald_plus')

    // mount 阶段的兜底刷新已经各调用过一次 update_opgg_data(ranked/aram) 和若干
    // getConfigByIpc；清空后只认这次切换新增的调用，避免 v-model 双写导致 switchTier
    // 空转时，mount 阶段的旧调用把断言假阳性地撑住。
    mockPut.mockClear()
    mockInvoke.mockClear()

    await select.setValue('master_plus')
    await flush(w)

    expect(mockPut).toHaveBeenCalledWith('settings.opgg.tier', 'master_plus')
    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    expect((select.element as HTMLSelectElement).value).toBe('master_plus')

    w.unmount()
  })
})
