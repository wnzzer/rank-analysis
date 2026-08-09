/**
 * Automation.vue 空池提示（pickHasNoTarget/banHasNoTarget）首屏假阳性闪现回归测试（修复 C）。
 *
 * 背景：`onMounted` 里的配置读取是串行 await——`autoPick.value` 在第 4 行就置位，
 * 而 `reloadPickRules()` 排在最后，中间隔着 5 次 IPC。对「只配了规则、没配兜底池」
 * 这种完全合法的配置，`pickHasNoTarget` 在修复前会从 `autoPick` 置位那一刻起，一直到
 * `reloadPickRules()` 落定前，被误判为「没有可执行目标」，在设置页首屏闪一条说错了的
 * 橙色警告。
 *
 * 修复：加一个 `configLoaded` ref 门禁两个 computed，onMounted 全部 await 落定后才置位，
 * 此前一律不提示（见 Automation.vue 中 `pickHasNoTarget`/`banHasNoTarget` 的定义）。
 *
 * 验证手段：用可手动逐个 resolve 的 deferred promise 顶替 getConfigByIpc，按
 * Automation.vue onMounted 里的真实调用顺序逐步放行，每步之后检查 DOM 里的提示文案
 * 是否出现——尤其是 pickChampionSwitch（autoPick=true）已放行、pickChampionSlice
 * （兜底池）已确认为空、但 pickRules 仍未加载完成的中间态，这正是修复前会误报的窗口。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
// jsdom 下没有 n-message-provider，替换 useMessage 为共享 mock，与
// Automation.tierSelect.spec.ts / UnifiedTagRow.spec.ts 同一约定。
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { getConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import Automation from '../Automation.vue'

const mockGetConfig = vi.mocked(getConfigByIpc)
const mockInvoke = vi.mocked(invoke)

/** 可手动放行的 deferred promise：用于按调用顺序精确控制 onMounted 里各 await 的落定时机。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** 让某一步 resolve 后触发的响应式更新与渲染完全落定（同其余 tierSelect 用例的 flush 约定）。 */
async function settle(w: { vm: { $nextTick: () => Promise<void> } }): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
}

/** 提示文案是否可见（pick/ban 任一条命中即算，本用例只关心 pick 侧）。 */
function hintVisible(w: { text: () => string }): boolean {
  return w.text().includes('没有可执行目标')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_champion_options') return []
    return undefined
  })
})

describe('Automation.vue 空池提示首屏假阳性闪现（挂载真实组件，修复 C）', () => {
  it('有规则、无兜底池、开关开：加载过程中提示行从未出现过', async () => {
    // 按 onMounted 里的真实调用顺序建 deferred gate，逐个手动 resolve 来控制加载节奏。
    const gates = {
      accept: deferred<boolean>(),
      pickSwitch: deferred<boolean>(),
      banSwitch: deferred<boolean>(),
      pickSlice: deferred<number[]>(),
      banSlice: deferred<number[]>(),
      start: deferred<boolean>(),
      tier: deferred<string>(),
      pickRules: deferred<unknown[]>(),
      banRules: deferred<unknown[]>()
    }
    mockGetConfig.mockImplementation((key: string) => {
      switch (key) {
        case 'settings.auto.acceptMatchSwitch':
          return gates.accept.promise as Promise<unknown>
        case 'settings.auto.pickChampionSwitch':
          return gates.pickSwitch.promise as Promise<unknown>
        case 'settings.auto.banChampionSwitch':
          return gates.banSwitch.promise as Promise<unknown>
        case 'settings.auto.pickChampionSlice':
          return gates.pickSlice.promise as Promise<unknown>
        case 'settings.auto.banChampionSlice':
          return gates.banSlice.promise as Promise<unknown>
        case 'settings.auto.startMatchSwitch':
          return gates.start.promise as Promise<unknown>
        case 'settings.opgg.tier':
          return gates.tier.promise as Promise<unknown>
        case 'settings.auto.pickRules':
          return gates.pickRules.promise as Promise<unknown>
        case 'settings.auto.banRules':
          return gates.banRules.promise as Promise<unknown>
        default:
          return Promise.resolve(undefined)
      }
    })

    const w = mount(Automation, { global: { plugins: [naive] } })
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.accept.resolve(false)
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    // 开关刚刚打开的瞬间——修复前的误报窗口从这里开始（rules/pool 都还是初始空值）
    gates.pickSwitch.resolve(true)
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.banSwitch.resolve(false)
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    // 兜底池加载确认为空——修复前误报窗口最典型的中间态：
    // 开关已开、池已确认为空、规则却还没加载到，old 逻辑此刻会判定为「无可执行目标」
    gates.pickSlice.resolve([])
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.banSlice.resolve([])
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.start.resolve(false)
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.tier.resolve('emerald_plus')
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    // 规则终于到位：有一条启用中的规则，本就是合理配置，不该提示
    gates.pickRules.resolve([
      { id: 'r1', name: '规则1', enabled: true, conditions: [], action: { champion_id: 1 } }
    ])
    await settle(w)
    expect(hintVisible(w)).toBe(false)

    gates.banRules.resolve([])
    await settle(w)
    await settle(w)

    // 加载全部落定（configLoaded=true）后：有规则、无兜底池仍是合理配置，依然不该提示
    expect(hintVisible(w)).toBe(false)

    w.unmount()
  })
})
