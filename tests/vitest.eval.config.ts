// AI 功能评测专用 vitest 配置（不进 npm run test）：借 vi.mock 隔离 OP.GG / patch notes 的 IPC 依赖。
// 运行（在 rank-analysis-app 目录下）：
//   DASHSCOPE_API_KEY=sk-xxx npx vitest run --config ../tests/vitest.eval.config.ts
import { resolve } from 'node:path'

export default {
  root: resolve(__dirname, '..'),
  resolve: {
    alias: { '@renderer': resolve(__dirname, '../rank-analysis-app/src') }
  },
  test: {
    include: ['tests/**/*.eval.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 3 * 60 * 60 * 1000,
    hookTimeout: 60_000
  }
}
