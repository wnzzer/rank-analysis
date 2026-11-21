/** BP 操作台独立演示配置；正式 vite.config.ts 不包含此入口。 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@renderer': resolve(__dirname, './src') } },
  server: {
    host: '127.0.0.1',
    port: 1426,
    strictPort: true,
    open: false,
    // 不监听 src-tauri：cargo 编译时 target 下的文件被占用，监听会让演示服务以 EBUSY 崩溃
    watch: { ignored: ['**/src-tauri/**'] }
  },
  build: {
    outDir: 'dist-bp-demo',
    rollupOptions: { input: resolve(__dirname, 'bp-demo.html') }
  }
})
