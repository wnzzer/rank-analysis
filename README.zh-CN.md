<div align="center">
  <img src="./lol-record-analysis-tauri/src-tauri/icons/256x256.png" width="128" height="128" alt="Logo" />
  <h1>Rank Analysis</h1>
  <p>AI 驱动的英雄联盟对局复盘 · 基于官方 LCU API</p>

  <!-- Badges -->
  <p>
    <a href="https://tauri.app/">
      <img src="https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=black" alt="Tauri" />
    </a>
    <a href="https://www.rust-lang.org/">
      <img src="https://img.shields.io/badge/Rust-1.70+-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
    </a>
    <a href="https://vuejs.org/">
      <img src="https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=flat-square&logo=vue.js&logoColor=white" alt="Vue" />
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    </a>
    <img src="https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
    <a href="./LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License" />
    </a>
    <a href="https://gitcode.com/faker1234546/rank-analysis">
      <img src="https://gitcode.com/faker1234546/rank-analysis/star/badge.svg" alt="AtomGitStars" />
    </a>
  </p>

  <!-- Stats -->
  <p>
    <a href="https://github.com/wnzzer/rank-analysis/releases">
      <img src="https://img.shields.io/github/v/release/wnzzer/rank-analysis?style=flat-square&color=blue" alt="Latest Release">
    </a>
    <a href="https://github.com/wnzzer/rank-analysis/releases">
      <img src="https://img.shields.io/github/downloads/wnzzer/rank-analysis/total?style=flat-square&color=success" alt="Downloads">
    </a>
    <a href="https://github.com/wnzzer/rank-analysis/stargazers">
      <img src="https://img.shields.io/github/stars/wnzzer/rank-analysis?style=flat-square&color=orange" alt="Stars">
    </a>
  </p>

  <p>
    <strong>中文</strong> | <a href="./README.md">English</a>
  </p>
</div>

---

> **给开发者的 TL;DR** —— 原生对接 LOL 客户端，**Tauri 2 + Rust + Vue 3 + TypeScript** 全栈。**安装包仅 ~5 MB**，单 Windows 二进制，零 Electron 开销。核心是一条**数据驱动的 AI 复盘流水线**：把每局对战量化（KDA、伤害/承伤占比、参团率、经济、阵容）后流式喂给大模型，直接告诉你谁 carry、谁犯罪、谁被队友拖累。通过 LCU WebSocket 监听实时对局状态，Rust 异步 HTTP 拉战绩。**不注入 DLL、不读游戏内存**，全程只调用 Riot 官方本地客户端 API。

## 📖 简介

**Rank Analysis** 是一个基于 Riot 官方 LCU API 的英雄联盟助手。它最大的亮点是**数据驱动的 AI 对局复盘**：不止给你堆数字，而是把每一局量化后让 AI 讲清楚你这把*为什么*赢/输——谁 carry、谁犯罪、谁被打爆、谁被队友拖累。围绕这个核心，它也覆盖了基础能力：带高低胜率高亮的战绩查询、开黑/队友风险识别，以及规则化的自动 BP。

本项目使用 **Tauri 2.0** 构建，结合 Rust 的高性能与 Web 前端的灵活性，做成一个 **~5 MB** 的单二进制应用——不注入 DLL、不读游戏内存，只调用官方本地客户端 API。

## ✨ 功能特点

### 🤖 AI 对局复盘 —— 核心能力
- **整局 AI 复盘**：在对局详情中一键生成整场胜负归因，定位谁最尽力、谁最犯罪、谁被打爆、谁属于被队友拖累。
- **单人 AI 复盘**：支持对任意参战玩家单独分析，判断其属于尽力、犯罪、被爆、被连累还是正常发挥。
- **房间级 AI 判断**：在组队/排队阶段根据最近战绩、常用英雄、位置分布和标签，快速给出队友与对手的风险判断。
- **数据证据驱动，不靠感觉**：每条结论都建立在真实数据上——KDA、伤害占比、承伤占比、经济、参团率、推塔、补刀，而非纯主观点评。
- **流式输出 + 缓存**：结果逐字流式返回，并在本地会话内按对局缓存，减少重复等待。

### 📊 战绩查询
- **高低胜率高亮**：直观展示队友近期表现。
- **MVP 显示**：快速识别大腿玩家。
- **玩家标签**：自动标记连胜、连败、非排位玩家。
- **关系显示**：识别宿敌与好友。

### 🔍 对局分析
- **预组队检测**：标记预先组队的玩家（开黑检测）。
- **历史遭遇**：标记曾经遇见过的玩家。
- **单场详情面板**：独立窗口展示 10 名玩家的 KDA、经济、补刀、承伤、推塔、装备、技能与符文/海克斯强化。
- **海克斯强化识别**：竞技场等特殊队列会自动切换为强化展示，并区分不同稀有度。

### 🤖 自动化辅助
- **自动匹配**：自动开始寻找对局。
- **自动接受**：匹配成功后自动接受。
- **规则化 BP**：可配置的规则引擎按「位置 × 队友/敌方英雄」条件自动选人/禁用（未命中时回退到固定预设列表）。

## 📸 软件预览

<div align="center">
  <img src="./public/1.png" alt="软件主界面预览" width="45%" />
  <img src="./public/1-2.png" alt="软件主界面预览" width="45%" />
</div>
<div align="center">
  <img src="./public/2.png" alt="分析功能演示" width="45%" />
  <img src="./public/3.png" alt="自动化功能演示" width="45%" />
</div>
<div align="center">
  <img src="./public/4.png" alt="标签管理" width="45%" />
</div>
<div align="center">
  <img src="./public/5.png" alt="AI 分析" width="45%" />
</div>

## 🚀 使用方法

1. **下载**：
   - **GitHub Releases**（主下载源）：前往 [Release 页面](https://github.com/wnzzer/rank-analysis/releases) 下载最新的构建版本压缩包。
   - **GitCode 镜像**（国内访问更快）：前往 [GitCode Releases](https://gitcode.com/faker1234546/rank-analysis/releases) 下载。

   > **系统要求**: Windows 10 1803 及以上版本（需支持 WebView2）。

2. **运行**：解压后直接运行可执行文件，无需管理员权限。

3. **连接**：软件运行时会自动检测游戏客户端。
   > **注意**:
   > - 当前仅支持腾讯服务器。
   > - 支持在游戏启动后中途打开软件，会自动连接。
   > - AI 分析功能需要联网调用模型服务，网络不可用时仅影响 AI 相关能力，不影响基础战绩查询。

## 🛠️ 开发与构建

如果你想自己编译本项目，请按照以下步骤操作：

### 环境准备
- [Node.js](https://nodejs.org/) (推荐 LTS 版本)
- [Rust](https://www.rust-lang.org/)
- C++ 构建环境 (Visual Studio C++ Build Tools)

### 构建步骤

1. 克隆项目并进入 Tauri 目录：
   ```bash
   cd lol-record-analysis-tauri
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 运行开发模式：
   ```bash
   npm run tauri dev
   ```

4. 编译生产版本：
   ```bash
   npm run tauri build
   ```
   构建完成后，可执行文件位于 `src-tauri/target/release/bundle` 目录下。

## 📊 代码质量

本项目采用现代化的开发工具链，确保代码质量和一致性：

### 质量工具
- **ESLint**: 静态代码分析
- **Prettier**: 代码格式化
- **TypeScript**: 严格类型检查
- **Clippy**: Rust 代码 Lint
- **Rustfmt**: Rust 代码格式化
- **GitHub Actions**: 自动化 CI/CD

### 质量检查命令

```bash
cd lol-record-analysis-tauri

# 一键 gate —— 提交前跑这个就够了（和 CI 完全对齐）
npm run check         # format + lint + typecheck + cargo fmt --check + clippy --all-targets --all-features -Dwarnings
npm run test          # vitest

# 按步骤单独跑（需要时）
npm run lint          # ESLint
npm run format        # Prettier
npm run typecheck     # vue-tsc
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -Dwarnings
```

> `npm run check` 是提交前的权威闸门，参数和 `.github/workflows/quality-checks.yml` 完全一致 —— 本地过了，CI 就不会再红。

详细的代码质量标准和贡献指南，请参阅：
- [代码质量标准](./CODE_QUALITY.md)
- [贡献指南](./CONTRIBUTING.md)

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

- **反馈问题**: 通过 [GitHub Issues](https://github.com/wnzzer/rank-analysis/issues) 提交。
- **提交代码**: 欢迎改进代码或增加新功能。

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

> 使用 AI 辅助实验维护（Claude / LLM 工具）

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=wnzzer/rank-analysis&type=Date)](https://star-history.com/#wnzzer/rank-analysis&Date)
