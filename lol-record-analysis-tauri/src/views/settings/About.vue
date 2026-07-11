<template>
  <n-layout>
    <n-card class="about-card">
      <template #header>
        <div class="header-container">
          <div class="title">关于我们</div>
          <n-button text style="font-size: var(--font-size-2xl)" @click="openOfficialWebsite()">
            <n-icon>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
            </n-icon>
          </n-button>
        </div>
      </template>

      <div class="content-container">
        <div class="logo-section">
          <div class="logo">
            <img src="../../assets/logo.png" alt="Logo" width="80" height="80" />
          </div>
          <div class="app-info">
            <h2>Rank Analysis</h2>
            <p>AI 驱动的英雄联盟对局复盘助手</p>
            <div class="version-info">
              <span class="version-tag">{{ currentVersion }}</span>
              <n-button size="small" type="primary" @click="checkForUpdates"> 检查更新 </n-button>
            </div>
          </div>
        </div>

        <!-- <div class="update-check-option">
            <span>关闭更新检测</span>
            <n-switch v-model:value="updateCheckEnabled" />
          </div> -->

        <n-divider />

        <n-space vertical size="large" class="nav-options">
          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
                />
              </svg>
            </div>
            <span>更新日志</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openUpdateLog">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
                />
              </svg>
            </div>
            <span>官方网站</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openOfficialWebsite">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"
                />
              </svg>
            </div>
            <span>意见反馈</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openFeedback">反馈</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"
                />
              </svg>
            </div>
            <span>许可证</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openLicense">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
                />
              </svg>
            </div>
            <span>邮件联系</span>
            <div class="spacer"></div>
            <n-button size="small" @click="sendEmail">邮件</n-button>
          </div>

          <!-- 匿名设备 ID：报障时附上，可在 Sentry 按 user.id 精确定位该设备的事件/日志 -->
          <div class="nav-item">
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path
                  d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12z"
                />
              </svg>
            </div>
            <span>设备标识</span>
            <div class="spacer"></div>
            <span class="device-id-text font-number">{{ deviceId || '加载中…' }}</span>
            <n-button size="small" :disabled="!deviceId" @click="copyDeviceId">复制</n-button>
          </div>
        </n-space>
      </div>
    </n-card>
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, h } from 'vue'
import { useNotification, useDialog, useMessage, NProgress } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

// Component state
const currentVersion = ref('')

/** 匿名设备 ID：用户报障时附上，可在 Sentry 按 user.id 精确定位其事件/日志 */
const deviceId = ref('')
const message = useMessage()

const copyDeviceId = () => {
  navigator.clipboard
    .writeText(deviceId.value)
    .then(() => message.success('设备标识已复制'))
    .catch(() => message.error('复制失败'))
}

onMounted(() => {
  fetchAppVersion()
  invoke<string>('get_device_id')
    .then(id => (deviceId.value = id))
    .catch(e => console.error('获取设备标识失败:', e))
})
async function fetchAppVersion() {
  try {
    const version = await getVersion()
    currentVersion.value = version
  } catch (error) {
    console.error('获取应用版本失败:', error)
    currentVersion.value = '未知版本'
  }
}
const latestVersion = ref('')

// Notification
const notification = useNotification()
const dialog = useDialog()

// 自定义check

// Methods
const checkForUpdates = async () => {
  console.log('Checking for updates...')
  try {
    const update = await check({
      timeout: 10000, // 10秒超时
      headers: {
        'X-AccessKey': 'lOXOaX9CLhNEop-SsrONLQ'
      }
    })
    if (update) {
      console.log(`found update ${update.version} from ${update.date} with notes ${update.body}`)
      latestVersion.value = update.version

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
        onPositiveClick: async () => {
          // 下载进度状态：放在 onPositiveClick 内部，每次更新独立计数。
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
            // 渲染函数 + ref → 下载事件触发的 ref 变更会自动重渲染。
            content: () => {
              if (phase.value === 'preparing') {
                return h('p', '正在连接服务器...')
              }
              if (phase.value === 'downloading') {
                const hasTotal = contentLength.value > 0
                return h('div', [
                  // 没拿到 Content-Length 时不画进度条（数字会一直停在 0% 反而让人以为卡了），
                  // 退化成只显示已下载字节，靠数字自增告诉用户在动。
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
      })
    } else {
      notification.info({
        title: '没有更新',
        content: '您使用的是最新版本。',
        duration: 3000
      })
    }
  } catch (error) {
    console.error('Error checking for updates:', error)
    notification.error({
      title: '更新检查失败',
      content: '检查更新时出错: ' + error,
      duration: 5000
    })
  }
}

const openUpdateLog = async () => {
  await openUrl('https://github.com/wnzzer/rank-analysis/releases')
}

const openOfficialWebsite = async () => {
  await openUrl('https://github.com/wnzzer/rank-analysis')
}

const openFeedback = async () => {
  await openUrl('https://github.com/wnzzer/rank-analysis/issues')
}

const openLicense = async () => {
  await openUrl('https://github.com/wnzzer/rank-analysis/blob/main/LICENSE')
}

const sendEmail = () => {
  window.location.href = 'mailto:wnzzer@outlook.com'
}
</script>

<style scoped>
.about-card {
  max-width: 600px;
  margin: var(--space-24) auto;
}

.header-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.content-container {
  padding: var(--space-12) 0;
}

.logo-section {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-20);
}

.logo {
  margin-right: var(--space-20);
}

.app-info h2 {
  margin: 0 0 var(--space-8) 0;
}

.app-info p {
  margin: 0 0 var(--space-12) 0;
  color: var(--text-secondary);
}

.version-info {
  display: flex;
  align-items: center;
}

.version-tag {
  background-color: color-mix(in srgb, var(--accent-blue) 14%, transparent);
  color: var(--accent-blue);
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-right: var(--space-10);
}

.update-check-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: var(--space-16) 0;
}

.nav-options {
  width: 100%;
}

.nav-item {
  display: flex;
  align-items: center;
  height: 40px;
}

.nav-icon {
  margin-right: var(--space-12);
  display: flex;
  align-items: center;
  color: var(--text-secondary);
}

.spacer {
  flex: 1;
}

.device-id-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-right: var(--space-10);
  user-select: text;
}
</style>

<style>
.update-log-content {
  max-height: 300px;
  overflow-y: auto;
  background: var(--glass-bg-mid);
  padding: var(--space-12);
  border-radius: var(--radius-sm);
  margin-top: var(--space-8);
  line-height: 1.6;
}
.update-log-content a {
  color: var(--accent-blue) !important;
  text-decoration: none;
  cursor: pointer;
}
.update-log-content a:hover {
  text-decoration: underline;
}
</style>
