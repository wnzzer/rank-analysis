/**
 * LOL 开机自启清理提示
 *
 * 腾讯登录客户端（`Launcher\Client.exe`）被拉起后会往 HKLM 的 Run 键注册
 * `startup_runner.exe`，导致每次开机自动弹出 LOL 登录窗。后端在启动 / 客户端
 * 连上 / 断开时都会尝试清理，但删 HKLM 需要管理员权限，而多数用户以普通权限
 * 运行本工具——此时后端只能上报「无权限残留」（`lol-autostart-blocked` 事件 /
 * `get_lol_autostart_blocked` 查询），由这里弹一条非模态通知，让用户一键提权清理。
 *
 * 每次运行至多提示一次：用户关掉或取消 UAC 即视为本次不想处理，不反复打扰。
 *
 * @module composables/useLolAutostartGuard
 */
import { h, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NButton, useMessage, useNotification, type NotificationReactive } from 'naive-ui'
import { getLolAutostartBlockedByIpc, purgeLolAutostartElevatedByIpc } from '@renderer/services/ipc'
import { isWindows } from '@renderer/services/platform'

/** 后端推送「无权限残留」状态变化的事件名（与 Rust `AUTOSTART_BLOCKED_EVENT` 对应） */
export const AUTOSTART_BLOCKED_EVENT = 'lol-autostart-blocked'

/**
 * 在主窗口挂载 LOL 开机自启清理提示。
 *
 * @example
 * ```ts
 * // Framework.vue（仅主窗口）
 * useLolAutostartGuard()
 * ```
 */
export function useLolAutostartGuard(): void {
  const notification = useNotification()
  const message = useMessage()

  /** 本次运行是否已提示过 */
  let prompted = false
  let current: NotificationReactive | null = null
  let unlisten: UnlistenFn | null = null
  let purging = false

  async function purge(): Promise<void> {
    if (purging) return
    purging = true
    try {
      await purgeLolAutostartElevatedByIpc()
      current?.destroy()
      message.success('已关闭 LOL 开机自启')
    } catch (e) {
      const text = typeof e === 'string' ? e : '清理失败，请稍后重试'
      // 主动取消 UAC 不算错误，静默即可，通知保留供用户改主意
      if (!text.startsWith('已取消')) message.error(text)
    } finally {
      purging = false
    }
  }

  function onBlockedChange(blocked: boolean): void {
    if (!blocked) {
      // 已被清理（例如之后以管理员身份运行时后端自行删掉了），收起提示
      current?.destroy()
      return
    }
    if (prompted) return
    prompted = true
    current = notification.warning({
      title: 'LOL 已被设为开机自启',
      content: '腾讯登录客户端把自己加进了开机启动，每次开机都会弹出登录窗。清理需要管理员授权。',
      action: () =>
        h(NButton, { type: 'primary', size: 'small', onClick: purge }, () => '一键关闭'),
      onClose: () => {
        current = null
      }
    })
  }

  onMounted(async () => {
    if (!isWindows()) return
    unlisten = await listen<boolean>(AUTOSTART_BLOCKED_EVENT, e => onBlockedChange(e.payload))
    // 后端启动时的那次清理可能早于这里的监听，补查一次
    onBlockedChange(await getLolAutostartBlockedByIpc().catch(() => false))
  })

  onUnmounted(() => {
    unlisten?.()
  })
}
