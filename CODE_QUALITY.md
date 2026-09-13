# 代码质量标准 / Code Quality Standards

本文档定义了 Rank Analysis 项目的代码质量标准和最佳实践。

## 📊 项目质量概览

### 技术栈质量评估

作为一个 Tauri 项目，本应用采用现代化的技术栈：

- ✅ **Tauri 2.0**: 最新的 Tauri 框架，提供更好的性能和安全性
- ✅ **Vue 3 + TypeScript**: 类型安全的前端框架，使用 Composition API
- ✅ **Rust**: 后端使用 Rust 保证性能和内存安全
- ✅ **Vite**: 快速的构建工具
- ✅ **Naive UI**: 完善的 UI 组件库

### 代码质量工具

#### 前端
- **ESLint**: 静态代码分析，捕获潜在错误
- **Prettier**: 自动代码格式化，保持一致的代码风格
- **TypeScript**: 严格的类型检查，减少运行时错误
- **Vue TSC**: Vue 组件的类型检查

#### 后端
- **Clippy**: Rust 代码的 lint 工具
- **Rustfmt**: Rust 代码格式化
- **Cargo**: 依赖管理和构建工具

## 🎯 代码质量标准

### 1. TypeScript 配置

项目启用了 TypeScript 严格模式：

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true
}
```

**要求**:
- 所有函数都应该有明确的类型定义
- 避免使用 `any` 类型
- 使用接口或类型别名定义复杂的数据结构
- Props 和 emits 应该有完整的类型定义

### 2. Vue 组件规范

**组件结构**:
```vue
<script setup lang="ts">
// 1. imports
// 2. props/emits 定义
// 3. 响应式状态
// 4. computed 属性
// 5. methods
// 6. 生命周期钩子
</script>

<template>
  <!-- 保持简洁，复杂逻辑抽取到 composables -->
</template>

<style scoped>
  /* 使用 scoped 样式避免污染全局 */
</style>
```

**要求**:
- 使用 Composition API
- v-for 必须包含 :key 属性
- 避免在模板中使用复杂表达式
- 组件名使用 PascalCase
- Props 应该验证类型

### 3. Rust 代码规范

**要求**:
- 遵循 Rust API 指南
- 使用 `Result` 类型进行错误处理
- 为公共 API 添加文档注释
- 避免 `unwrap()`，使用 `?` 操作符或适当的错误处理
- 使用 `clippy` 建议的最佳实践

### 4. 命名规范

**TypeScript/JavaScript**:
- 变量和函数: `camelCase`
- 类和接口: `PascalCase`
- 常量: `UPPER_SNAKE_CASE`
- 私有属性: 以 `_` 开头

**Rust**:
- 变量和函数: `snake_case`
- 类型和 Trait: `PascalCase`
- 常量: `UPPER_SNAKE_CASE`

### 5. 注释规范

**需要注释的场景**:
- 复杂的业务逻辑
- 非显而易见的算法实现
- Workarounds 或临时解决方案
- 公共 API 和重要函数

**不需要注释的场景**:
- 显而易见的代码
- 自解释的函数名

### 6. 主题材质规则（亮 / 暗）

亮暗差异**只能经 `src/global.css` 的 token 表达**，组件 `<style>` 里不写 `.theme-light` 补丁（`src/theme/styleRules.spec.ts` 守门）。

- **材质语义 token**：卡面 `--surface-card`、凹面 `--surface-sunken`（+ `--sunken-border` / `--sunken-shadow`）、自绘控件 `--surface-control`、分组容器 `--surface-group`、外壳 `--surface-shell` / `--surface-sidebar`、轨道 `--track-bg` / `--progress-rail`；个别组件专用的放 `--detail-*` / `--result-row-bg` 这类具名 token。暗色值 = 迁移前实际值，亮色为「浅灰画布 → 白卡 → 淡灰凹面」三级实心面。新增 token 必须两主题成对定义（`src/theme/tokens.spec.ts` 守门）。
- **效果强度开关**：`--fx-glow`（外发光）/ `--fx-wash`（色块渐变、径向光晕）/ `--fx-ambient`（氛围底图），暗色 1、亮色 0。写法 `color-mix(in srgb, X calc(16% * var(--fx-glow)), transparent)`、`rgba(r, g, b, calc(0.35 * var(--fx-glow)))`、`opacity: calc(0.3 * var(--fx-ambient))`。
- **不得裸写** `rgba(255, 255, 255, …)`；带颜色的静态外发光必须乘 `--fx-glow`。
- **`/* theme-fixed */` 豁免**：只用于与主题无关的固定色（徽章自身内高光、图片蒙层）和一闪而过的状态反馈动画（选人呼吸 / 锁定闪光）。
- **naive 覆盖**（`src/theme/overrides.ts`）从 `<html>` 读 token；被读取的 token 必须是字面色值（hex / rgba），`color-mix()` / `var()` 会让 naive 颜色运算报错（`src/theme/tokens.spec.ts` 守门）。
- `theme-light` 类挂在 `<html>`（`useTheme.syncThemeClass`），teleport 出去的浮层也能取到亮色 token；naive 亮色主题的 tooltip 是深底气泡，气泡内沿用暗色 token（`global.css` 的 `.theme-light .n-tooltip`）。

## ✅ 质量检查清单

### 提交前检查

```bash
# 前端检查
cd rank-analysis-app
npm run lint          # ESLint 检查
npm run format        # Prettier 格式化
npm run typecheck     # TypeScript 类型检查

# 后端检查 (Windows / macOS 均可编译；CI 按两平台矩阵跑，本地单平台会漏检另一半 cfg 分支)
cd src-tauri
cargo fmt             # 格式化
cargo clippy          # Lint 检查
cargo test            # 运行测试
```

### CI/CD 检查

项目配置了 GitHub Actions 自动化检查：
- ✅ ESLint 代码质量检查
- ✅ Prettier 代码格式检查
- ✅ TypeScript 类型检查
- ✅ Rust Clippy 检查
- ✅ Rust Fmt 格式检查
- ✅ 安全漏洞扫描 (npm audit & cargo audit)

## 📈 持续改进

### 当前已实现

- [x] ESLint 配置
- [x] Prettier 配置
- [x] TypeScript 严格模式
- [x] EditorConfig 统一编码风格
- [x] Rustfmt 配置
- [x] GitHub Actions CI/CD
- [x] 贡献指南

### 未来改进计划

- [ ] 添加单元测试
- [ ] 添加 E2E 测试
- [ ] 代码覆盖率报告
- [ ] 性能监控
- [ ] 自动化发布流程

### 已知问题

**开发依赖安全漏洞**:
- `esbuild` <=0.24.2 存在中等安全漏洞 (GHSA-67mh-4wv8-2f99)
  - 影响范围: 仅在开发服务器中
  - 风险: 低 (桌面应用不暴露开发服务器)
  - 状态: 监控中，等待 vite 更新兼容的 esbuild 版本

## 🔧 IDE 配置建议

### VS Code

推荐安装以下扩展：

```json
{
  "recommendations": [
    "vue.volar",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "rust-lang.rust-analyzer",
    "tauri-apps.tauri-vscode",
    "editorconfig.editorconfig"
  ]
}
```

### 设置

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "vue"
  ]
}
```

## 📚 参考资源

- [Vue.js 风格指南](https://vuejs.org/style-guide/)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Rust API 指南](https://rust-lang.github.io/api-guidelines/)
- [Tauri 最佳实践](https://tauri.app/v2/guides/)

---

遵循这些标准可以帮助我们维护高质量的代码库，提升开发效率和用户体验。
