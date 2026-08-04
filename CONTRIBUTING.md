# 贡献指南 / Contributing Guide

感谢您对 Rank Analysis 项目的关注！我们欢迎所有形式的贡献。

## 🚀 快速开始

### 环境要求

- **Node.js**: v20 或更高版本（推荐使用 LTS 版本）
- **Rust**: 1.70+ 
- **操作系统**: Windows 10 1803+ 或 macOS 10.15+（Apple Silicon）均可开发和编译
  - Rust 侧质量检查在 CI 按 `windows-latest` + `macos-latest` 矩阵跑，两边都必须绿
  - 本地只在单平台跑 `cargo clippy` 时，`#[cfg(target_os)]` 的另一半分支根本不编译，告警会漏检
  - 仅 Windows 独有的功能（免 WeGame 一键启动、以管理员身份重启）只能在 Windows 上实机验证
- **其他工具**: 
  - Visual Studio C++ Build Tools (Windows) / Xcode Command Line Tools (macOS)
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

## 🎯 这个项目在做什么

一句话：**帮玩家看懂客户端没告诉他的事**。战绩、玩家画像、选人期决策——重点始终是"多出来的那部分信息"。

所以最受欢迎的贡献，是让已有信息更准、更早、更好懂：更靠谱的标签判定、选人期更快的数据、AI 复盘更到位的提示词、更清楚的展示。

有几个方向这个项目暂时不打算走，写在这里不是设门槛，是希望你别把时间花在最后没法合并的东西上：

- **客户端点几下就能看到、我们做了也不产生新信息的功能**。判断的重点在后半句：战绩和对局记录客户端其实也有，这里还做，是因为补上了 AI 复盘、跨对局统计和对手画像。而像英雄藏品、皮肤炫彩浏览这类，客户端已经完整呈现了，再画一遍就只是重复。「一键符文出装」当初也是这个原因没做。
- **换肤、改包、注入、修改游戏文件**。这类实现会给使用者带来实打实的封号风险，所以这个项目对 LCU 始终只做只读访问（`GET`）。
- **在本地长期堆战绩数据**（比如内置一个 SQLite 战绩库）。这是刻意的取舍，缓存之外不做本地持久化。

**改动比较大的话，欢迎先开个 Issue 聊两句**——说说你想解决什么问题就行，不用先写代码。方向对上了再动手，省得辛苦写完才发现不合适。拿不准算不算"大"，或者不确定某个想法在不在范围内，随时来问，问了不会有人嫌烦。

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

- 改动较大时，建议先看下[这个项目在做什么](#-这个项目在做什么)，或开个 Issue 聊聊方向
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
