/** 独立开发演示配置；正式 vite.config.ts 不包含此入口或资源重定向。 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { demoIcon } from './src/demo/matchup/champions'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'matchup-demo-assets',
      configureServer(server) {
        server.middlewares.use('/demo-assets', (request, response) => {
          const match = request.url?.match(/^\/champion\/(\d+)$/)
          const url = match ? demoIcon(Number(match[1])) : ''
          if (!url) {
            response.statusCode = 404
            response.end()
            return
          }
          response.writeHead(302, { Location: url })
          response.end()
        })
      }
    }
  ],
  resolve: { alias: { '@renderer': resolve(__dirname, './src') } },
  server: { host: '127.0.0.1', port: 1425, strictPort: true, open: false },
  build: {
    outDir: 'dist-matchup-demo',
    rollupOptions: { input: resolve(__dirname, 'matchup-demo.html') }
  }
})
