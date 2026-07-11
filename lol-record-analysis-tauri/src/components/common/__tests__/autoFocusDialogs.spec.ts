/**
 * 自动弹出类弹窗的焦点行为回归测试
 *
 * 背景：全局 `:focus-visible` 是 JB 风格 2px 实心绿焦点环（global.css），本意是
 * 键盘导航时才出现。但 n-modal 默认 `auto-focus` 会在弹窗打开时把焦点程序化地
 * 移到第一个按钮上；应用启动后无任何指针交互时，Chromium 会让这种程序化聚焦
 * 命中 `:focus-visible`，导致弹窗一打开按钮就带一圈绿色外边框（用户报障）。
 *
 * 因此约定：**启动时自动弹出的告知/确认弹窗必须显式关闭 auto-focus**。
 */
import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { NModal } from 'naive-ui'
import CloudSyncNoticeDialog from '../CloudSyncNoticeDialog.vue'
import CloudConfigPullDialog from '../CloudConfigPullDialog.vue'
import ErrorReportingConsentDialog from '../ErrorReportingConsentDialog.vue'

describe('auto-popup dialogs disable modal auto-focus', () => {
  it.each([
    ['CloudSyncNoticeDialog', CloudSyncNoticeDialog, { show: true }],
    ['CloudConfigPullDialog', CloudConfigPullDialog, { show: true, updatedAt: 0 }],
    ['ErrorReportingConsentDialog', ErrorReportingConsentDialog, { show: true }]
  ] as const)('%s passes auto-focus=false to n-modal', (_name, component, props) => {
    const wrapper = shallowMount(component, { props })
    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('autoFocus')).toBe(false)
  })
})
