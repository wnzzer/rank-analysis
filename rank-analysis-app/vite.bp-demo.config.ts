/** BP 操作台独立演示配置；正式 vite.config.ts 不包含此入口。 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@renderer': resolve(__dirname, './src') } },
  server: { host: '127.0.0.1', port: 1426, strictPort: true, open: false },
  build: {
    outDir: 'dist-bp-demo',
    rollupOptions: { input: resolve(__dirname, 'bp-demo.html') }
  }
})
