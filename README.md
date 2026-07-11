<div align="center">
  <img src="./lol-record-analysis-tauri/src-tauri/icons/256x256.png" width="128" height="128" alt="Logo" />
  <h1>Rank Analysis</h1>
  <p>🎮 AI-powered match review for League of Legends — built on the official LCU API</p>

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
    <a href="https://gitcode.com/wnzzer/rank-analysis">
      <img src="https://gitcode.com/wnzzer/rank-analysis/star/badge.svg" alt="AtomGitStars" />
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
    <a href="./README.zh-CN.md">中文</a> | <strong>English</strong>
  </p>
</div>

---

> **TL;DR for developers** — A native LoL client tool built with **Tauri 2 + Rust + Vue 3 + TypeScript**. **~5 MB installer**, single Windows binary, zero Electron overhead. Its core is a **data-driven AI match-review pipeline**: every game is quantified (KDA, damage/tank share, kill participation, gold, team comp) and streamed to an LLM that tells you who carried, who fed, and who got dragged down. Talks to the LCU WebSocket for live in-game state, async Rust HTTP for match history. No DLL injection, no game memory access — uses only Riot's official local client API.

## 📖 Introduction

**Rank Analysis** is a League of Legends companion built on Riot's official LCU API. Its standout feature is **data-driven AI match review**: instead of just throwing numbers at you, it quantifies each game and has an AI explain *why* you won or lost — who carried, who fed, who got stomped, and who was dragged down by teammates. Around that core it also covers the essentials: match-history lookup with win-rate highlighting, premade & teammate-risk detection, and rule-based auto pick/ban.

Built with **Tauri 2.0**, it pairs Rust's performance with a web frontend in a **~5 MB**, single-binary app — no DLL injection, no memory reads, only the official local client API.

## ✨ Features

### 🤖 AI Match Review — the core
- **Full Match Review**: One click in the match details turns the game into a verdict — who performed best, who fed, who got stomped, and who was dragged down by teammates
- **Single Player Review**: Analyze any participant individually (carried / fed / stomped / dragged down / normal)
- **Lobby-level Risk Assessment**: During lobby/queue, assess teammate and opponent risk from recent history, favorite champions, role distribution, and tags
- **Evidence-Driven, not vibes**: Every verdict is grounded in real data — KDA, damage share, tank share, gold, kill participation, towers, CS — not subjective commentary
- **Streaming + Cached**: Results stream in token-by-token and are cached per match within the session to avoid repeated waits

### 📊 Match History Query
- **Win Rate Highlighting**: Intuitively displays teammates' recent performance
- **MVP Display**: Quickly identify carry players
- **Player Tags**: Auto-tags win streaks, loss streaks, and non-ranked players
- **Relationship Display**: Identifies nemeses and friends

### 🔍 Match Analysis
- **Premade Detection**: Marks pre-grouped players (duo/squad detection)
- **Match History**: Marks previously encountered players
- **Match Details Panel**: Independent window showing 10 players' KDA, economy, CS, damage taken, towers destroyed, items, skills, and runes/augments
- **Augment Recognition**: Special queues like Arena automatically switch to augment display with rarity differentiation

### 🤖 Automation Assistant
- **Auto Matchmaking**: Automatically starts searching for matches
- **Auto Accept**: Automatically accepts matches when found
- **Rule-based Pick/Ban**: A configurable rule engine picks/bans by role × ally/enemy champion conditions (falls back to a fixed preset list)

### 🗂️ Notes, Tags & Data Sync
- **Player Notes**: Leave a note + color label (friendly / normal / careful / blacklist) on players you meet — surfaced automatically next time you run into them
- **Tag Management**: A dozen toggleable behavior tags (win streak, loss streak, smurf suspect, hot streak, slump...), with AI-suggested personalized tags based on your recent history
- **Cloud Sync & Backup**: Player notes and full config sync across devices (last-write-wins merge), plus one-click JSON export/import

## 📸 Screenshots

**AI Full-Match Review** — a one-line verdict plus who carried / who fed / who got stomped, every call backed by real numbers

<div align="center">
  <img src="./public/9.png" alt="AI Full-Match Review" width="80%" />
</div>

**Match History** — look up any summoner, dark / light theme

<div align="center">
  <img src="./public/1.png" alt="Match History (dark)" width="49%" />
  <img src="./public/1-2.png" alt="Match History (light)" width="49%" />
</div>

**Live Match Analysis** — recent records, rank, tags and premade detection for all 10 players, automatically on game start

<div align="center">
  <img src="./public/2.png" alt="Live Match Analysis" width="80%" />
</div>

**Match Details** — a dedicated window with per-player KDA / gold / damage, plus one-click AI review

<div align="center">
  <img src="./public/5.png" alt="Match Details with AI review entry" width="80%" />
</div>

**Player Notes & Tag Management**

<div align="center">
  <img src="./public/6.png" alt="Player Notes" width="49%" />
  <img src="./public/4.png" alt="Tag Management" width="49%" />
</div>

**Automation & General Settings**

<div align="center">
  <img src="./public/3.png" alt="Automation Settings" width="49%" />
  <img src="./public/8.png" alt="General Settings" width="49%" />
</div>

**Backup & Cloud Sync**

<div align="center">
  <img src="./public/7.png" alt="Data & Sync" width="80%" />
</div>

## 🚀 Usage

1. **Download**:
   - **GitHub Releases** (primary): grab the latest build from the [Release Page](https://github.com/wnzzer/rank-analysis/releases)
   - **GitCode mirror** (faster in mainland China): download from [GitCode Releases](https://gitcode.com/wnzzer/rank-analysis/releases)

   > **System Requirements**: Windows 10 1803 or higher (WebView2 support required)

2. **Run**: Extract and run the executable directly - no admin privileges required

3. **Connect**: The software automatically detects the game client when running
   > **Notes**:
   > - Currently only supports Tencent servers (China)
   > - Can be opened mid-game and will auto-connect
   > - AI analysis requires internet access to call model services; network unavailability only affects AI features, not basic match history queries

## 🛠️ Development & Build

If you want to compile this project yourself, follow these steps:

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS version recommended)
- [Rust](https://www.rust-lang.org/)
- C++ Build Environment (Visual Studio C++ Build Tools)

### Build Steps

1. Clone and enter the Tauri directory:
   ```bash
   cd lol-record-analysis-tauri
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

4. Build production version:
   ```bash
   npm run tauri build
   ```
   The executable will be located in `src-tauri/target/release/bundle`

## 📊 Code Quality

This project uses modern development toolchain to ensure code quality and consistency:

### Quality Tools
- **ESLint**: Static code analysis
- **Prettier**: Code formatting
- **TypeScript**: Strict type checking
- **Clippy**: Rust code linting
- **Rustfmt**: Rust code formatting
- **GitHub Actions**: Automated CI/CD

### Quality Check Commands

```bash
cd lol-record-analysis-tauri

# One-shot gate — runs before every commit (mirrors CI exactly)
npm run check         # format + lint + typecheck + cargo fmt --check + clippy --all-targets --all-features -Dwarnings
npm run test          # vitest

# Individual steps (if you want to run them piecemeal)
npm run lint          # ESLint
npm run format        # Prettier
npm run typecheck     # vue-tsc
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -Dwarnings
```

> `npm run check` is the canonical pre-commit gate. It matches the flags used by `.github/workflows/quality-checks.yml` — if it passes locally, CI will pass.

For detailed code quality standards and contribution guidelines, please refer to:
- [Code Quality Standards](./CODE_QUALITY.md)
- [Contributing Guide](./CONTRIBUTING.md)

## 🤝 Contributing

Issues and Pull Requests are welcome!

- **Bug Reports**: Submit via [GitHub Issues](https://github.com/wnzzer/rank-analysis/issues)
- **Code Contributions**: Improvements and new features are welcome

## 📄 License

This project is open-sourced under the [MIT License](./LICENSE).

> Maintained with AI assistance experiments (Claude / LLM tooling)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wnzzer/rank-analysis&type=Date)](https://star-history.com/#wnzzer/rank-analysis&Date)
