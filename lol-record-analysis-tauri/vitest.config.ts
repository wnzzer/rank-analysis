import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src-tauri/',
        '**/*.d.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/assets/**',
        '**/dist/**'
      ],
      // 当前实际覆盖率：lines 16.47% / functions 46.7% / branches 74.83% / statements 16.47%
      // threshold 锁定在 floor 附近做"无回归基线"——禁止 PR 让覆盖率倒退，
      // 而非达成 80%。CLAUDE.md 中 80% 仍为长期目标，靠后续 PR 增加测试逐步抬升。
      thresholds: {
        lines: 15,
        functions: 45,
        branches: 73,
        statements: 15
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, './src')
    }
  }
})
