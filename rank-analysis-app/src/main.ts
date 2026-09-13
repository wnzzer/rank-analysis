import { createApp, nextTick } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { usePlayerNotesStore } from './pinia/playerNotes'
import { useCloudSyncStore } from './pinia/cloudSync'
import { prepareBoot, revealMainWindow } from './boot'
import { isMatchDetailWindow } from './components/record/detailWindow'
import './global.css'
import './styles/ai-report.css'

async function bootstrap() {
  const pinia = createPinia()
  // mount 前就位：平台三项 + 主题 + 主窗口缩放（见 boot.ts）
  await prepareBoot(pinia)

  const app = createApp(App)
  app.use(pinia)
  app.use(router)
  app.use(naive)

  // 载入本地玩家备注（issue #67）
  usePlayerNotesStore().init()
  // 云同步：开关已开启时后台自动同步一次（issue 云同步）
  useCloudSyncStore().init()

  app.mount('#app')

  // 详情窗由 views/MatchDetail.vue 在内容就绪后自行亮出（见 detailWindow.ts）
  if (!isMatchDetailWindow()) {
    await nextTick()
    await revealMainWindow()
  }
}

bootstrap()
