/**
 * 开发用：战报视觉演示页入口（share-demo.html）。
 * 只挂纯展示组件，不走 main.ts 的启动流程（那需要 Tauri 运行时）。
 */
import { createApp } from 'vue'
import '../global.css'
import ShareDemo from './ShareDemo.vue'

createApp(ShareDemo).mount('#app')
