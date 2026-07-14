# 贡献指南 / Contributing Guide

感谢您对 Rank Analysis 项目的关注！我们欢迎所有形式的贡献。

## 🚀 快速开始

### 环境要求

- **Node.js**: v20 或更高版本（推荐使用 LTS 版本）
- **Rust**: 1.70+ 
- **操作系统**: Windows 10 1803+ (开发和测试)
- **其他工具**: 
  - Visual Studio C++ Build Tools (Windows)
  - Git

### 克隆项目

```bash
git clone https://github.com/wnzzer/rank-analysis.git
cd rank-analysis/lol-record-analysis-tauri
```

### 安装依赖

```bash
npm install
```

### 运行开发服务器

```bash
npm run tauri dev
```

## 📝 代码规范

### 前端代码 (Vue.js + TypeScript)

1. **ESLint**: 我们使用 ESLint 进行代码检查
   ```bash
   npm run lint
   ```

2. **Prettier**: 使用 Prettier 进行代码格式化
   ```bash
   npm run format
   ```

3. **TypeScript**: 启用了严格模式，确保类型安全
   ```bash
   npm run typecheck
   ```

4. **编码风格**:
   - 使用单引号
   - 不使用分号
   - 2 空格缩进
   - 最大行宽 100 字符
   - Vue 组件使用 Composition API

### 后端代码 (Rust)

1. **Rustfmt**: 使用 rustfmt 格式化代码
   ```bash
   cd src-tauri
   cargo fmt
   ```

2. **Clippy**: 使用 clippy 进行代码检查
   ```bash
   cd src-tauri
   cargo clippy -- -D warnings
   ```

3. **编码风格**:
   - 4 空格缩进
   - 遵循 Rust 官方风格指南
   - 使用有意义的变量名和函数名
   - 添加必要的注释（特别是复杂的业务逻辑）

## 🔍 提交前检查清单

在提交 Pull Request 之前，请确保：

- [ ] 代码通过 ESLint 检查 (`npm run lint`)
- [ ] 代码通过 Prettier 格式化 (`npm run format`)
- [ ] 代码通过 TypeScript 类型检查 (`npm run typecheck`)
- [ ] Rust 代码通过 rustfmt 格式化 (`cargo fmt`)
- [ ] Rust 代码通过 clippy 检查 (`cargo clippy`)
- [ ] 测试您的更改，确保功能正常
- [ ] 提交信息清晰明了

## 🎯 提交规范

我们推荐使用语义化的提交信息：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `style:` 代码格式调整（不影响代码功能）
- `refactor:` 代码重构
- `perf:` 性能优化
- `test:` 测试相关
- `chore:` 构建或辅助工具的变动

示例：
```
feat: 添加自动接受对局功能
fix: 修复战绩查询时的崩溃问题
docs: 更新 README 中的安装说明
```

## 🐛 报告问题

如果您发现了 bug 或有功能建议，请：

1. 搜索 [现有 Issues](https://github.com/wnzzer/rank-analysis/issues) 确认问题未被报告
2. 创建新的 Issue，提供：
   - 问题的详细描述
   - 复现步骤
   - 预期行为和实际行为
   - 您的系统环境（操作系统、Node.js 版本等）
   - 相关截图或日志

## 📤 提交 Pull Request

1. Fork 本项目
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### PR 指南

- PR 标题应该清晰描述更改内容
- 提供详细的 PR 描述，说明更改的原因和方式
- 确保 CI 检查通过
- 保持更改尽可能小和专注
- 响应审查意见

## 🚀 发版流程

版本号以 **git tag 为唯一真相源**，发一个版本只需推 tag：

```bash
git tag v1.8.8
git push origin v1.8.8
```

推送 `v*` tag 会触发 `Release Build` workflow，自动完成构建、签名、生成 changelog、创建 GitHub Release 与 `latest.json`，并同步到 GitCode 国内镜像。

约定：

- `src-tauri/tauri.conf.json` 里的 `version` 是**占位值（`0.0.0`），不要手动改**。CI 会在构建时从 tag 名反推版本号写入（仅构建用，不回写仓库）。
- tag 命名需匹配 `v*`，且符合 `.github/cliff.toml` 的 `tag_pattern = "v?[0-9].*"`（`beta`/`alpha` 会被 changelog 跳过）。
- 需要手动补发时，可在 Actions 页手动运行 `Release Build` 并在 `version` 输入框填入版本号（如 `v1.8.8`）。

## 🔒 安全问题

如果您发现安全漏洞，请不要公开报告。请直接联系项目维护者。

## 📜 许可证

通过向本项目贡献代码，您同意您的贡献将按照 [MIT License](../LICENSE) 许可。

## 💬 交流

如有任何问题，欢迎通过以下方式联系：

- GitHub Issues: https://github.com/wnzzer/rank-analysis/issues
- Discussions: https://github.com/wnzzer/rank-analysis/discussions

---

再次感谢您的贡献！🎉
