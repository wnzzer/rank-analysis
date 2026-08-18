/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-typescript',
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  ignorePatterns: ['src-tauri', 'dist'],
  plugins: ['import'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ],
    // feature 私有化（P1-4 前端）：共享层（services/pinia 顶层）不得 import
    // features/** 的私有实现。跨 feature 复用请通过共享层或 feature 公开入口；
    // services/ai/** 是 AI 链路合法消费者，显式放行。
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          {
            target: ['./src/services/**', './src/pinia/**'],
            from: ['./src/features/**/services/**', './src/features/**/stores/**'],
            except: ['./src/services/ai/**'],
            message:
              '共享层不得引用 feature 私有实现（services/stores）；AI 链路除外，跨 feature 复用请走公开入口'
          }
        ]
      }
    ],
    // CODE_QUALITY.md 明确禁止 any。先以 warn 暴露存量，未来切 error
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off'
  }
}
