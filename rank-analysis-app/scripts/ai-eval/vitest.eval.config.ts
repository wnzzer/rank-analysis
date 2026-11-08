/** A/B 评测专用 vitest 配置：只跑 *.eval.ts，单线程、超长超时，不参与 npm run test */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['scripts/ai-eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 4 * 60 * 60 * 1000,
    poolOptions: { threads: { singleThread: true } }
  },
  resolve: { alias: { '@renderer': resolve(__dirname, '../../src') } }
})
