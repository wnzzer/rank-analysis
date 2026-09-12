import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { useSettingsStore } from './pinia/setting'
import { usePlayerNotesStore } from './pinia/playerNotes'
import { useCloudSyncStore } from './pinia/cloudSync'
import { initAssetPrefix } from './services/http'
import { initPlatform, initInstallForm } from './services/platform'
import './global.css'
import './styles/ai-report.css'

async function bootstrap() {
  // mount 前先拿到平台相关的三项：asset 协议前缀（决定图片 src 是否正确）、平台标识
  // （决定 Windows 专属入口是否渲染）与安装形态（决定更新走官方 updater 还是便携版
  // 自更新）。三者互不依赖，并发取，不叠加启动延迟。
  await Promise.all([initAssetPrefix(), initPlatform(), initInstallForm()])

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)
  app.use(naive)

  // 显式初始化主题，避免 store 定义时的隐式副作用
  useSettingsStore().initTheme()
  // 载入本地玩家备注（issue #67）
  usePlayerNotesStore().init()
  // 云同步：开关已开启时后台自动同步一次（issue 云同步）
  useCloudSyncStore().init()

  app.mount('#app')
}

bootstrap()
