/** 基准构建/检查专用 vitest 配置：只跑 scripts/baseline 下的 *.eval.ts，node 环境、长超时 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['scripts/baseline/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 60 * 60 * 1000,
    poolOptions: { threads: { singleThread: true } }
  },
  resolve: { alias: { '@renderer': resolve(__dirname, '../../src') } }
})
