import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { useSettingsStore } from './pinia/setting'
import { usePlayerNotesStore } from './pinia/playerNotes'
import { useCloudSyncStore } from './pinia/cloudSync'
import { initAssetPrefix } from './services/http'
import './global.css'
import './styles/ai-report.css'

async function bootstrap() {
  // 先确定 asset 协议 URL 前缀（平台相关），保证 mount 后所有图片 src 正确
  await initAssetPrefix()

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
