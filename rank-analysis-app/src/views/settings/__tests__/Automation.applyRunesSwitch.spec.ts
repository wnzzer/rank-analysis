/**
 * Automation.vue「自动应用推荐符文」开关：读写 settings.auto.applyRunesSwitch（挂载真实组件）。
 *
 * 该键名同时是 Rust `automation.rs` 里 apply_runes 任务的启停开关（config 变更回调按键名
 * 精确匹配），前端写错一个字母，开关就只是个摆设——所以断言落在写入的键名与值上。
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
// jsdom 下没有 n-message-provider，与 Automation.noTargetHint.spec.ts 同一约定
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import Automation from '../Automation.vue'

const mockGetConfig = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)

async function settle(w: { vm: { $nextTick: () => Promise<void> } }): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
}

/** 「自动应用推荐符文」这一行里的 n-switch */
function runesSwitch(w: ReturnType<typeof mount>) {
  const row = w.findAll('.setting-item').find(r => r.text().includes('自动应用推荐符文'))
  expect(row, '基本设置里应有「自动应用推荐符文」一行').toBeDefined()
  return row!.find('[role="switch"]')
}

let stored = false

beforeEach(() => {
  vi.clearAllMocks()
  stored = false
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === 'get_champion_options' ? [] : undefined
  )
  mockGetConfig.mockImplementation(async (key: string) =>
    key === 'settings.auto.applyRunesSwitch' ? stored : undefined
  )
})

describe('Automation.vue 自动应用推荐符文开关', () => {
  it('挂载时回显已存的开关值', async () => {
    stored = true
    const w = mount(Automation, { global: { plugins: [naive] } })
    await settle(w)

    expect(runesSwitch(w).attributes('aria-checked')).toBe('true')
    w.unmount()
  })

  it('切换时写入 settings.auto.applyRunesSwitch', async () => {
    const w = mount(Automation, { global: { plugins: [naive] } })
    await settle(w)
    expect(runesSwitch(w).attributes('aria-checked')).toBe('false')

    await runesSwitch(w).trigger('click')
    await settle(w)

    expect(mockPut).toHaveBeenCalledWith('settings.auto.applyRunesSwitch', true)
    w.unmount()
  })
})
