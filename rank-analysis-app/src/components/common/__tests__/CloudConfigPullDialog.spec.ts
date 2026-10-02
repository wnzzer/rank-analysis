/**
 * CloudConfigPullDialog 更新时间展示回归测试
 *
 * 背景：resolveCloudConfig 一开始就把 pendingCloudConfig 置 null，父组件传入的
 * updatedAt 随之回落成 0；而弹窗要等拉取/推送的网络往返结束才关。期间文案曾显示
 * "更新于 1970/1/1 08:00:00"（用户报障）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CloudConfigPullDialog from '../CloudConfigPullDialog.vue'

/** 取弹窗内渲染出的完整文本（n-modal teleport 到 body） */
function dialogText(): string {
  return document.body.textContent ?? ''
}

describe('CloudConfigPullDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('should keep last valid time when updatedAt falls back to 0 while still open', async () => {
    const ts = new Date(2026, 9, 1, 12, 30).getTime()
    const wrapper = mount(CloudConfigPullDialog, {
      props: { show: true, updatedAt: ts },
      attachTo: document.body
    })
    expect(dialogText()).toContain(new Date(ts).toLocaleString())

    await wrapper.setProps({ updatedAt: 0 })

    expect(dialogText()).not.toContain('1970')
    expect(dialogText()).toContain(new Date(ts).toLocaleString())
    wrapper.unmount()
  })

  it('should not render epoch when no valid time ever arrived', () => {
    const wrapper = mount(CloudConfigPullDialog, {
      props: { show: true, updatedAt: 0 },
      attachTo: document.body
    })
    expect(dialogText()).not.toContain('1970')
    wrapper.unmount()
  })
})
