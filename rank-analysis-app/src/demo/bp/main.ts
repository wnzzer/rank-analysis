/** BP 操作台无客户端开发入口；仅在 bp-demo.html 引入，不接入正式启动流程。 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import { mockIPC } from '@tauri-apps/api/mocks'
import App from './App.vue'
import '@renderer/global.css'

mockIPC(command => {
  if (command === 'get_config') return null
  // 演示不允许修改真实客户端或配置；mockIPC 不会把调用发往 Tauri。
  if (command.startsWith('plugin:event|')) return 1
  throw new Error(`演示不支持此操作：${command}`)
})

createApp(App).use(createPinia()).use(naive).mount('#app')
