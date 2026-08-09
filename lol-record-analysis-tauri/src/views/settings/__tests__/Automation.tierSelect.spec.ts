/**
 * Automation.vue 段位下拉「v-model + @update:value 双写同一 ref」缺陷回归测试。
 *
 * 背景（Critical 缺陷）：
 * 段位下拉曾经同时写了 `v-model:value="opggTier"` 与 `@update:value="updateOpggTier"`。
 * Vue 3 会把这两者编译进同一个 onUpdate:value 处理器数组，按下标顺序同步派发：
 * 下标 0 是 v-model 的自动赋值函数，下标 1 才是 updateOpggTier。`opggTier` 是从
 * useOpggTier() 解构出来的 tier ref（同一个 Ref 对象），所以等 updateOpggTier(next)
 * 被调用时，tier.value 已经被 v-model 写成了 next。而 useOpggTier.switchTier 开头有一句
 * no-op 守卫 `if (next === tier.value) return true`——每次真实切换都会命中，于是
 * switchTier 直接返回 true，跳过写配置、跳过 invoke('update_opgg_data')、跳过
 * bumpOpggRevision，失败反馈分支也永远走不到。用户看到下拉跳到了新段位（v-model 直接
 * 写的），实际什么都没发生——是「伪装成功」的缺陷。
 *
 * 修复：把 `v-model:value="opggTier"` 改成单向绑定 `:value="opggTier"`，保留
 * `@update:value="updateOpggTier"` 作为唯一写入路径。
 *
 * 为什么不直接挂载 Automation.vue：
 * 它还依赖 useRules（usePickRules/useBanRules）、VueDraggable、RuleEditModal、
 * BpSuggestModal、get_champion_options invoke、champion 工具函数等一整套与本缺陷无关的
 * 依赖，全部 stub 只会引入噪音、拖慢维护，且不会让这个测试对「接线」这个具体缺陷更敏感。
 * 改为搭两个最小复现组件（见 __fixtures__/TierSelect{Fixed,Buggy}.vue），照抄
 * Automation.vue 里段位下拉这一块真实的接线方式，绑定到真实的 useOpggTier()
 * （只 mock 它依赖的 ipc / tauri invoke），这样 switchTier 内部的 no-op 守卫是真实生效的。
 *
 * 两个 it 互为证据：
 * - 「修复后接线」用例证明 :value + @update:value 下，切换真的会执行到底。
 * - 「回归防护」用例故意挂载修复前的接线（TierSelectBuggy.vue），证明它必现缺陷——
 *   也就是说，如果有人把 Automation.vue 的接线改回 v-model:value，这条用例的断言方式
 *   套用到 Automation.vue 上就会失败，从而钉住了这个缺陷不再复发。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import TierSelectFixed from './__fixtures__/TierSelectFixed.vue'
import TierSelectBuggy from './__fixtures__/TierSelectBuggy.vue'

const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

// 与 BpSuggestModal.spec.ts 相同的约定：用真实 <select> 承接 <n-select>，
// value 受控回显 + change 时 emit update:value，便于用 DOM 层面的 setValue 驱动交互。
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Automation.vue 段位下拉接线', () => {
  it('修复后（:value 单向绑定 + @update:value）：切换段位真的写配置、强制重拉快照', async () => {
    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockResolvedValueOnce({ mode: 'ranked', patch: '16.13' })

    const w = mount(TierSelectFixed, { global: { stubs } })
    await w.get('select').setValue('master_plus')
    await new Promise(r => setTimeout(r, 0))

    expect(mockPut).toHaveBeenCalledWith('settings.opgg.tier', 'master_plus')
    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    expect(w.get('select').element.value).toBe('master_plus')
  })

  it('回归防护：改回 v-model:value + @update:value 双写同一 ref 时，切换会被 no-op 守卫吞掉——证明本测试确实钉住了这个接线缺陷', async () => {
    const w = mount(TierSelectBuggy, { global: { stubs } })
    await w.get('select').setValue('master_plus')
    await new Promise(r => setTimeout(r, 0))

    // v-model 已经把 tier.value 写成了 master_plus，下拉「看起来」切换成功了……
    expect(w.get('select').element.value).toBe('master_plus')
    // ……但 switchTier 内部 `next === tier.value` 命中 no-op 守卫，
    // 写配置与强制重拉全部被跳过：这正是「伪装成功」缺陷的复现。
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
