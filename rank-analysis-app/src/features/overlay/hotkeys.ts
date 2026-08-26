/**
 * 全局热键（B1）：Alt+A 开关对局浮窗。
 *
 * 通过 tauri-plugin-global-shortcut 注册系统级快捷键——游戏窗口持有焦点时
 * 依然可触发。注册失败（权限/冲突）不静默吞掉：由调用方决定是否提示。
 */
import { register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { invoke } from '@tauri-apps/api/core'

export const OVERLAY_HOTKEY = 'Alt+A'

let registered = false

/** 幂等应用热键配置；重复调用先解绑再按需绑定。 */
export async function applyOverlayHotkey(enabled: boolean): Promise<void> {
  if (registered) {
    await unregister(OVERLAY_HOTKEY)
    registered = false
  }
  if (!enabled) return
  // toggle 的可见性判定在 Rust 侧（窗口 is_visible），前端无需跟踪状态
  await register(OVERLAY_HOTKEY, () => {
    void invoke('overlay_toggle').catch(err => console.warn('overlay_toggle failed:', err))
  })
  registered = true
}
