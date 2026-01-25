<template>
  <n-layout>
    <n-card class="about-card">
      <template #header>
        <div class="header-container">
          <div class="title">关于我们</div>
          <n-button text style="font-size: 24px" @click="openOfficialWebsite()">
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
            <p>一款为英雄联盟玩家而生的分析工具</p>
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
        </n-space>
      </div>
    </n-card>
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, ref, h } from 'vue'
import { useNotification, useDialog } from 'naive-ui'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

// Component state
const currentVersion = ref('')
onMounted(() => {
  fetchAppVersion()
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
            h('div', { style: 'margin-top: 12px; font-weight: bold;' }, '更新内容：'),
            h('div', {
              // 添加样式使 Markdown 内容更易读，并限制高度防止弹窗过长
              style:
                'max-height: 300px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 12px; border-radius: 4px; margin-top: 8px; line-height: 1.6;',
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
          const d = dialog.info({
            title: '正在更新',
            content: '正在下载并安装更新，请稍候...',
            closable: false,
            maskClosable: false,
            closeOnEsc: false
          })

          try {
            let downloaded = 0
            let contentLength = 0
            await update.downloadAndInstall(event => {
              switch (event.event) {
                case 'Started':
                  contentLength = event.data.contentLength || 0
                  console.log(`started downloading ${contentLength} bytes`)
                  break
                case 'Progress':
                  downloaded += event.data.chunkLength
                  console.log(`downloaded ${downloaded} from ${contentLength}`)
                  break
                case 'Finished':
                  console.log('download finished')
                  break
              }
            })
            d.content = '更新完成，正在重启...'
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
  margin: 20px auto;
}

.header-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 18px;
  font-weight: bold;
}

.content-container {
  padding: 10px 0;
}

.logo-section {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.logo {
  margin-right: 20px;
}

.app-info h2 {
  margin: 0 0 8px 0;
}

.app-info p {
  margin: 0 0 12px 0;
  color: #666;
}

.version-info {
  display: flex;
  align-items: center;
}

.version-tag {
  background-color: #e8f4fd;
  color: #1890ff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-right: 10px;
}

.update-check-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 15px 0;
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
  margin-right: 12px;
  display: flex;
  align-items: center;
  color: #666;
}

.spacer {
  flex: 1;
}
</style>

<style>
.update-log-content a {
  color: #4096ff !important;
  text-decoration: none;
  cursor: pointer;
}
.update-log-content a:hover {
  text-decoration: underline;
}
</style>
