/**
 * Overlay 页面入口（4b overlay POC）
 *
 * 独立 Vue 应用，挂载到 overlay.html 的 #overlay-app。
 * 最小化依赖：无路由、无 pinia，仅监听 Tauri 事件渲染 NextAction 建议。
 */
import { createApp } from 'vue'
import OverlayView from './views/OverlayView.vue'

createApp(OverlayView).mount('#overlay-app')
