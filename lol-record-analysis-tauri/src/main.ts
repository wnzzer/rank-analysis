import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { useSettingsStore } from './pinia/setting'
import { usePlayerNotesStore } from './pinia/playerNotes'
import './global.css'
import './styles/ai-report.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(naive)

// 显式初始化主题，避免 store 定义时的隐式副作用
useSettingsStore().initTheme()
// 载入本地玩家备注（issue #67）
usePlayerNotesStore().init()

app.mount('#app')
