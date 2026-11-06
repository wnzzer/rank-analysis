/** 无客户端开发入口；仅在 matchup-demo.html 引入，不接入正式启动流程。 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import { mockIPC } from '@tauri-apps/api/mocks'
import { initAssetPrefix } from '@renderer/services/http'
import { DEMO_CHAMPIONS } from './champions'
import App from './App.vue'
import '@renderer/global.css'

mockIPC(command => {
  if (command === 'get_asset_prefix') return '/demo-assets'
  if (command === 'get_champion_options')
    return Object.entries(DEMO_CHAMPIONS).map(([value, item]) => ({
      value: Number(value),
      label: item.name
    }))
  if (command === 'get_lane_counters') return {}
  if (command === 'get_config') return null
  if (
    command === 'get_champion_meta' ||
    command === 'get_champion_patch_note' ||
    command === 'get_opgg_status'
  )
    return null
  // 演示不允许修改真实客户端或配置；mockIPC 不会把调用发往 Tauri。
  if (command.startsWith('plugin:event|')) return 1
  throw new Error(`演示不支持此操作：${command}`)
})

await initAssetPrefix()
createApp(App).use(createPinia()).use(naive).mount('#app')
