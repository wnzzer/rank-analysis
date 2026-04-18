import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { useSettingsStore } from './pinia/setting'
import './global.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(naive)

// 显式初始化主题，避免 store 定义时的隐式副作用
useSettingsStore().initTheme()

app.mount('#app')
