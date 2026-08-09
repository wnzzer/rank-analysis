/**
 * 应用更新检查与升级编排
 *
 * 从 About.vue 抽出，供「关于页手动检查」与「顶栏启动静默检查 + 药丸点击直接升级」共用，
 * 避免对话框编排 / 下载进度 / 错误处理这套逻辑存在两份副本——关于页修了 bug 顶栏还留着，
 * 或者反过来，迟早漂移。
 *
 * 两种触发模式在"无更新"与"失败"上的用户反馈是刻意不同的：
 * - manual：用户主动点的"检查更新"，没反馈会以为卡住了，必须弹通知告知结果
 * - silent：应用启动时的背景探测，用户没有发起请求，弹错误框/"没有更新"提示是打扰，
 *   一律安静处理（仅 console.error 留痕，不触达 UI）
 *
 * 下载/安装阶段（startUpgrade）不受 mode 影响：无论是从"发现新版本"对话框的
 * "立即更新"触发，还是从顶栏药丸直接触发，用户都已经明确点了"更新"这个动作，
 * 失败必须让用户看到，不能安静吞掉。
 *
 * @module composables/useAppUpdate
 */
import { ref, shallowRef, h, computed, type Ref } from 'vue'
import { useDialog, useNotification, NProgress } from 'naive-ui'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

/** 更新检测的触发模式，见文件头说明 */
export type UpdateCheckMode = 'manual' | 'silent'

export interface UseAppUpdateReturn {
  /** 是否正在查询更新（可用于按钮 loading / 防重复点击） */
  checking: Ref<boolean>
  /** 已探测到的可用更新；未查询过或确认没有新版本时为 null */
  availableUpdate: Ref<Update | null>
  /**
   * 查询是否有新版本
   *
   * @param mode - 'manual' 用户主动点击（无更新/查询失败均弹通知反馈）；
   *               'silent' 启动时静默探测（无更新/查询失败均不打扰 UI，仅 console）
   * @returns 查到的更新对象；没有更新或查询失败均返回 null
   */
  checkForUpdates: (mode?: UpdateCheckMode) => Promise<Update | null>
  /**
   * 展示"发现新版本"确认对话框（含 Markdown 渲染的更新日志），确认后走升级下载流程。
   *
   * 顶栏药丸点击复用同一入口：药丸本身就是"已发现更新"的信号，点击直接弹这个确认框，
   * 不需要重新联网查询一遍。
   */
  showUpdateDialog: (update: Update) => void
}

// ─── module-level singleton state ─────────────────────────────────────────
// About.vue（关于页手动检查）与 Header.vue（启动静默检查 + 顶栏药丸）都会调用
// useAppUpdate()。若 checking/availableUpdate 声明在函数体内，每次调用都是
// 独立的 ref：关于页手动查到新版本、用户点「稍后」后，顶栏药丸感知不到这次
// 探测结果（没有共享状态可看），必须再等下一次静默检查才会出现，体验上等于
// 白查了一次。参照 useGameState.ts 的写法把「是否有可用更新」这份状态提到
// 模块级共享；dialog/notification 仍按调用方各自 resolve——它们基于 Vue
// inject，必须在调用方组件的 setup() 里取，不能提到模块级。
//
// availableUpdate 必须用 shallowRef 而非 ref：Update 继承自 Tauri 的
// Resource，用私有字段（#rid，编译为 WeakMap 存取）保存资源句柄。deep ref
// 会把赋进去的 Update 实例整个包一层 reactive Proxy，之后凡是经 `.value`
// 读出来再调用其方法（如顶栏药丸点击 → showUpdateDialog(availableUpdate.value)
// → startUpgrade → update.downloadAndInstall()），方法内部的 `this` 绑定的
// 是 Proxy 而不是原始实例，WeakMap 用 this 做 key 查不到，会直接抛
// `Cannot read private member #rid from an object whose class did not
// declare it`（已用一段最小复现脚本验证）。shallowRef 只让 .value 本身可
// 追踪，不深度代理其内容，`.value` 拿到的还是原始 Update 实例，方法可正常调用。
const checking = ref(false)
const availableUpdate = shallowRef<Update | null>(null)

/**
 * 应用更新检查 + 升级编排 composable
 *
 * @returns 见 {@link UseAppUpdateReturn}
 * @example
 * ```ts
 * const { checkForUpdates, availableUpdate } = useAppUpdate()
 * // 关于页：用户点击按钮
 * await checkForUpdates('manual')
 * // 顶栏：启动后静默探测一次
 * await checkForUpdates('silent')
 * ```
 */
export function useAppUpdate(): UseAppUpdateReturn {
  const notification = useNotification()
  const dialog = useDialog()

  /**
   * 下载 + 安装 + 重启编排
   *
   * 展示"正在更新"进度弹窗（连接中 → 下载中 → 安装中三阶段），下载完成后自动 relaunch；
   * 任一环节失败都销毁进度弹窗并弹错误通知——这一步用户已经明确点了"更新"，失败必须可见。
   */
  async function startUpgrade(update: Update): Promise<void> {
    // 下载进度状态：每次升级独立计数，不与其它调用共享
    const downloaded = ref(0)
    const contentLength = ref(0)
    const phase = ref<'preparing' | 'downloading' | 'installing'>('preparing')
    const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(2)
    const pct = computed(() =>
      contentLength.value > 0
        ? Math.min(100, Math.floor((downloaded.value / contentLength.value) * 100))
        : 0
    )

    const d = dialog.info({
      title: '正在更新',
      closable: false,
      maskClosable: false,
      closeOnEsc: false,
      // 渲染函数 + ref → 下载事件触发的 ref 变更会自动重渲染
      content: () => {
        if (phase.value === 'preparing') {
          return h('p', '正在连接服务器...')
        }
        if (phase.value === 'downloading') {
          const hasTotal = contentLength.value > 0
          return h('div', [
            // 没拿到 Content-Length 时不画进度条（数字会一直停在 0% 反而让人以为卡了），
            // 退化成只显示已下载字节，靠数字自增告诉用户在动
            hasTotal &&
              h(NProgress, {
                type: 'line',
                percentage: pct.value,
                indicatorPlacement: 'inside',
                processing: true
              }),
            h(
              'p',
              {
                style: `margin-top: ${hasTotal ? 'var(--space-12)' : '0'}; color: var(--text-secondary); font-size: var(--font-size-sm);`
              },
              hasTotal
                ? `已下载 ${fmtMB(downloaded.value)} MB / ${fmtMB(contentLength.value)} MB`
                : `已下载 ${fmtMB(downloaded.value)} MB`
            )
          ])
        }
        return h('p', '下载完成，正在安装并准备重启...')
      }
    })

    try {
      await update.downloadAndInstall(event => {
        switch (event.event) {
          case 'Started':
            contentLength.value = event.data.contentLength || 0
            downloaded.value = 0
            phase.value = 'downloading'
            break
          case 'Progress':
            downloaded.value += event.data.chunkLength
            break
          case 'Finished':
            phase.value = 'installing'
            break
        }
      })
      await relaunch()
    } catch (e) {
      d.destroy()
      notification.error({ title: '更新失败', content: String(e) })
    }
  }

  function showUpdateDialog(update: Update): void {
    dialog.info({
      title: '发现新版本',
      // 使用渲染函数来支持 Markdown
      content: () =>
        h('div', [
          h('p', `检测到新版本 ${update.version}，是否立即更新？`),
          h('div', { style: 'margin-top: var(--space-12); font-weight: bold;' }, '更新内容：'),
          h('div', {
            class: 'update-log-content',
            innerHTML: md.render(update.body || '暂无更新日志'),
            onClick: (e: MouseEvent) => {
              const target = e.target as HTMLElement
              if (target.tagName === 'A') {
                e.preventDefault()
                const href = target.getAttribute('href')
                if (href) {
                  openUrl(href)
                }
              }
            }
          })
        ]),
      positiveText: '立即更新',
      negativeText: '稍后',
      onPositiveClick: () => startUpgrade(update)
    })
  }

  async function checkForUpdates(mode: UpdateCheckMode = 'manual'): Promise<Update | null> {
    checking.value = true
    try {
      const update = await check({
        timeout: 10000, // 10秒超时
        headers: {
          'X-AccessKey': 'lOXOaX9CLhNEop-SsrONLQ'
        }
      })
      if (update) {
        availableUpdate.value = update
        if (mode === 'manual') {
          showUpdateDialog(update)
        }
        return update
      }
      availableUpdate.value = null
      if (mode === 'manual') {
        notification.info({
          title: '没有更新',
          content: '您使用的是最新版本。',
          duration: 3000
        })
      }
      return null
    } catch (error) {
      if (mode === 'manual') {
        notification.error({
          title: '更新检查失败',
          content: '检查更新时出错: ' + error,
          duration: 5000
        })
      } else {
        // 静默模式：用户没有发起请求，弹错误框是打扰——留痕即可，下次启动自会重试
        console.error('静默检查更新失败:', error)
      }
      return null
    } finally {
      checking.value = false
    }
  }

  return { checking, availableUpdate, checkForUpdates, showUpdateDialog }
}
