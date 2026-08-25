<template>
  <n-layout>
    <n-card class="about-card">
      <template #header>
        <div class="header-container">
          <div class="title">关于我们</div>
          <n-button text style="font-size: var(--font-size-2xl)" @click="openOfficialWebsite()">
            <n-icon>
              <Github />
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
              <button type="button" class="version-tag" title="点击复制版本号" @click="copyVersion">
                {{ currentVersion }}
              </button>
              <n-button size="small" type="primary" @click="checkForUpdates('manual')">
                检查更新
              </n-button>
            </div>
          </div>
        </div>

        <div class="update-check-option">
          <span class="update-check-label">
            启动时自动检查更新
            <span class="update-check-hint">仅影响启动后的自动检测，手动「检查更新」不受影响</span>
          </span>
          <n-switch v-model:value="updateCheckEnabled" />
        </div>

        <n-divider />

        <n-space vertical size="large" class="nav-options">
          <div class="nav-item">
            <div class="nav-icon">
              <ClipboardList />
            </div>
            <span>更新日志</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openUpdateLog">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <Globe />
            </div>
            <span>官方网站</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openOfficialWebsite">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <MessageSquare />
            </div>
            <span>意见反馈</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openFeedback">反馈</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <ShieldCheck />
            </div>
            <span>许可证</span>
            <div class="spacer"></div>
            <n-button size="small" @click="openLicense">查看</n-button>
          </div>

          <div class="nav-item">
            <div class="nav-icon">
              <Mail />
            </div>
            <span>邮件联系</span>
            <div class="spacer"></div>
            <n-button size="small" @click="sendEmail">邮件</n-button>
          </div>

          <!-- 匿名设备 ID：报障时附上，可在 Sentry 按 user.id 精确定位该设备的事件/日志 -->
          <div class="nav-item">
            <div class="nav-icon">
              <Fingerprint />
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
import { onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import {
  Github,
  ClipboardList,
  Globe,
  MessageSquare,
  ShieldCheck,
  Mail,
  Fingerprint
} from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { useAppUpdate } from '@renderer/composables/useAppUpdate'

// Component state
const currentVersion = ref('')

/** 匿名设备 ID：用户报障时附上，可在 Sentry 按 user.id 精确定位其事件/日志 */
const deviceId = ref('')
const message = useMessage()

/** 「启动时自动检查更新」开关（默认开；换挡即落盘，Header 静默检查按此执行） */
const updateCheckEnabled = ref(true)

watch(updateCheckEnabled, v => {
  void putConfigByIpc(CONFIG_KEYS.updateCheckEnabled, v).catch(e =>
    console.error('保存更新检测开关失败:', e)
  )
})

const copyDeviceId = () => {
  navigator.clipboard
    .writeText(deviceId.value)
    .then(() => message.success('设备标识已复制'))
    .catch(() => message.error('复制失败'))
}

const copyVersion = () => {
  navigator.clipboard
    .writeText(currentVersion.value)
    .then(() => message.success('版本号已复制'))
    .catch(() => message.error('复制失败'))
}

onMounted(() => {
  fetchAppVersion()
  invoke<string>('get_device_id')
    .then(id => (deviceId.value = id))
    .catch(e => console.error('获取设备标识失败:', e))
  getConfigByIpc<boolean>(CONFIG_KEYS.updateCheckEnabled)
    .then(v => (updateCheckEnabled.value = v !== false))
    .catch(e => console.error('读取更新检测开关失败:', e))
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

/**
 * 更新检查与升级编排：抽到 useAppUpdate，供顶栏（启动静默检查 + 药丸）共用。
 * 这里只负责触发——检查更新/无更新提示/发现新版本确认框/下载进度/错误反馈
 * 全部行为与抽取前一致，见该 composable 的 JSDoc。
 */
const { checkForUpdates } = useAppUpdate()

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
  cursor: pointer;
  background-color: var(--brand-soft);
  color: var(--brand);
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-sm);
  transition: filter var(--dur-fast) var(--ease-expo);
  font-size: var(--font-size-sm);
  margin-right: var(--space-10);
}

.update-check-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: var(--space-16) 0;
}

.update-check-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.update-check-hint {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
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
.nav-icon svg {
  width: 20px;
  height: 20px;
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
