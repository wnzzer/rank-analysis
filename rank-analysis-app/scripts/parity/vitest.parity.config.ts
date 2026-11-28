/** Rust 对拍黄金生成专用 vitest 配置：只跑 scripts/parity 下的 *.eval.ts，node 环境（子项目 2 删除） */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['scripts/parity/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
    poolOptions: { threads: { singleThread: true } }
  },
  resolve: { alias: { '@renderer': resolve(__dirname, '../../src') } }
})
