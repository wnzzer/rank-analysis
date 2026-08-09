# 应用改名 Rank Analysis + 老用户数据迁移

**日期**: 2026-08-09
**状态**: 待批准
**范围**: 应用身份（productName / Cargo / npm 包名）、仓库目录名、CI、新增启动期迁移模块
**交付**: 单个 PR，与功能改动隔离

## 背景与问题

仓库早已叫 `rank-analysis`，顶栏也早就显示 `Rank Analysis`，但应用的内部身份还停留在旧名：

| 位置 | 当前值 |
|---|---|
| `tauri.conf.json` productName | `lol-record-analysis-app` |
| `tauri.conf.json` 窗口标题 | `lol-record-analysis-app` |
| `Cargo.toml` package / lib | `lol-record-analysis-app` / `lol_record_analysis_app_lib` |
| `package.json` name | `lol-record-analysis-app` |
| Sentry release 前缀 | `lol-record-analysis-app@` |
| 仓库目录 | `lol-record-analysis-tauri/` |

受版本控制的文件里引用旧名的共 19 个。

## 核心约束：配置文件是相对路径

`config.rs:91` 的 `CONFIG_PATH = "config.yaml"` 是**相对路径**，落在进程工作目录，也就是安装目录。同样落在那里的还有 `observability.rs:43` 的 `device_id`。

实测（本机 `%LOCALAPPDATA%\lol-record-analysis-app\`）：

```
config.yaml              4087 B   Aug  9 10:03
device_id                  36 B   Jul 11 18:51
opgg_cache_ranked.json           Aug  9 09:44
opgg_cache_aram.json             Aug  9 09:44
cn_patch_notes_cache.json        Aug  8 22:25
lol-record-analysis-app.exe      Aug  2 18:17
uninstall.exe                    Aug  2 18:29
```

`device_id` 是 7-11 的，exe 是 8-02 的——中间经历了多次版本升级，这两个非安装产物都活了下来。说明 NSIS 的升级流程不会清空安装目录里它没装过的文件。

`config.yaml` 里装着用户的全部本地状态：`playerNotes`（标记过的人）、`theme`、`gameInstallPath`、`cloudSyncSession`、各项自动化开关与英雄池。

**NSIS `installMode` 是 `currentUser`，安装目录 = `%LOCALAPPDATA%\{productName}\`。改 productName 就是换目录，老用户这份数据会被留在旧目录里成为孤儿。**

## 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| productName | `lol-record-analysis-app` → `Rank Analysis` | 与顶栏、仓库名一致 |
| identifier | **保持 `com.lol-record-analysis-tauri.app` 不变** | 见下 |
| Cargo / npm 包名 | → `rank-analysis` / lib `rank_analysis_lib` | |
| 仓库目录 | `lol-record-analysis-tauri/` → `rank-analysis-app/` | |
| 老用户数据 | 启动期从旧目录迁移 `config.yaml` + `device_id` | |
| 缓存类文件 | 不迁移 | 会自动重建，搬运只是把陈旧数据带进新版本 |

### 为什么 identifier 不改

identifier 是 NSIS 卸载注册表键（`Uninstall\{BUNDLEID}`）与 WebView2 数据目录的键。两种走法的差别：

- **保持不变**：新安装包能通过注册表认出旧安装 → 静默卸载它 → 装进新目录。旧目录只剩 `config.yaml` 和 `device_id` 两个孤儿，正好被迁移模块捡走。最终「程序和功能」一条、开始菜单一个快捷方式。
- **改成 `com.wnzzer.rank-analysis`**：认不出旧安装 → 不卸载 → 每个老用户多出一条卸不掉的旧条目、一个重复快捷方式、约 12 MB 残留 exe，要手动清理。

identifier 用户永远看不到，改它只买到命名规范上的整洁，代价却落在每一个老用户头上。WebView2 数据目录跟着 identifier 走这一点在这里不构成约束——前端只用 `sessionStorage`（会话级）和 `detailWindow.ts:17` 一处传参用的临时 `localStorage`，都不承载需要保留的状态。

### 为什么 Cargo 包名要跟着改

`release.yml:305` 的绿色版打包读 `target/release/$appName.exe`，这个文件名来自 Cargo 包名。Cargo 包名定成 `rank-analysis` 后：

- 产物是 `rank-analysis.exe`
- `release.yml` 里 `$appName = "rank-analysis"`，它在 build 之后把安装包重命名为 `rank-analysis-{version}-setup.exe`

于是 productName 里的空格**不会漏进产物文件名，也就不会漏进 `latest.json` 的 URL**——不需要处理 URL 编码，updater 链路零改动。这是 productName 用带空格的显示名、Cargo 名用连字符形式的分工理由。

## 一、改名清单

### 应用身份

| 文件 | 改动 |
|---|---|
| `tauri.conf.json` | `productName` → `Rank Analysis`；`app.windows[0].title` → `Rank Analysis`；`identifier` **不动** |
| `Cargo.toml` | `[package] name` → `rank-analysis`；`[lib] name` → `rank_analysis_lib` |
| `package.json` | `name` → `rank-analysis`；`description` → `rank analysis app` |

### 代码引用

| 文件 | 改动 |
|---|---|
| `src-tauri/src/main.rs` | 8 处 `lol_record_analysis_app_lib::` → `rank_analysis_lib::` |
| `src-tauri/examples/probe_arena.rs` | `use` 与文档注释里的包名 |
| `src-tauri/src/observability.rs:96` | Sentry release → `rank-analysis@{version}` |
| `src-tauri/src/lcu/api/asset.rs:476` | temp 文件名 → `rank-analysis-cdragon-augments.json` |

### CI

| 文件 | 改动 |
|---|---|
| `.github/workflows/release.yml` | `$appName` → `rank-analysis`；`:121` 的 DMG 名同改；所有 `lol-record-analysis-tauri/` 路径 → `rank-analysis-app/` |
| `.github/workflows/quality-checks.yml` | 5 处 `working-directory` / cache path |
| `.github/workflows/patch-notes-data.yml`、`sync-gitcode.yml` | 路径引用（若有） |

### 目录与文档

- `lol-record-analysis-tauri/` → `rank-analysis-app/`（用 `git mv` 保留历史）
- README.md、README.zh-CN.md、CLAUDE.md、CODE_QUALITY.md、CONTRIBUTING.md
- `.claude/skills/shipping-changes/SKILL.md`、`.claude/skills/sentry/SKILL.md`、`.claude-agents`、`.claude/settings.local.json`

## 二、迁移模块

新增 `src-tauri/src/migrate.rs`，由 `main.rs` 在 `config::init_config()` **之前**调用。顺序是硬要求：`init_config` 一旦跑过就会在新目录建出 `config.yaml`，之后再迁移就会撞上「目标已存在」的幂等分支，静默丢掉老数据。

### 接口

```rust
/// 需要从旧安装目录搬运的文件。缓存类不在内：会自动重建。
const MIGRATED_FILES: [&str; 2] = ["config.yaml", "device_id"];

/// 从 legacy 目录搬运用户数据到 target。
///
/// 幂等：target 下已有 config.yaml 时直接返回（视为已迁移或全新安装后已产生数据）。
/// 单个文件搬运失败只记录，不影响其余文件，也不返回 Err——迁移失败绝不阻断启动。
///
/// 返回实际搬运成功的文件名，供日志与测试断言。
fn migrate_from(legacy: &Path, target: &Path) -> Vec<String>;

/// 解析真实路径并执行迁移。无 legacy 目录时 no-op。
pub fn migrate_legacy_data();
```

`migrate_legacy_data` 是薄包装：解析 `%LOCALAPPDATA%\lol-record-analysis-app\` 与当前工作目录，转交 `migrate_from`。路径解析和搬运逻辑分开，后者才能用 tempdir 测。

### 行为细则

- **不覆盖**：逐个文件检查目标是否存在，存在则跳过。整体的短路条件是 `target/config.yaml` 存在。
- **不删源**：旧目录的文件保留。就算迁移逻辑本身有 bug，用户的数据也还在原地，可以手工恢复。旧目录里剩下的东西由 NSIS 卸载旧版时处理。
- **失败不阻断**：任何 IO 错误只 `log::warn!`。宁可用户回到默认配置，也不能因为迁移失败而打不开应用。
- **日志**：搬运成功时 `log::info!` 打出文件名列表，这是线上排查「老用户配置丢了吗」的唯一证据源。

### 便携版

绿色版（portable .7z）从解压目录运行，不存在 `%LOCALAPPDATA%\lol-record-analysis-app\` 时 `migrate_from` no-op，行为等同全新安装。便携版用户本来就是自己管目录，不做额外处理。

## 三、测试

`migrate.rs` 的单测（tempdir，不碰真实路径）：

| 用例 | 断言 |
|---|---|
| 正常迁移 | legacy 有两个文件、target 空 → 两个都搬过去，内容一致 |
| 目标已存在则跳过 | target 已有 `config.yaml` → 返回空，target 内容不被改写 |
| 源目录不存在 | → 返回空，不 panic |
| 源目录只有部分文件 | legacy 只有 `config.yaml` → 搬这一个，缺 `device_id` 不报错 |

## 四、发版前必须真机验证的两条

这两条决定改名能不能发，`npm run check` 和单测都覆盖不到：

1. **升级路径不吃数据**：本地构建改名后的安装包，直接覆盖安装到当前这台已装旧版的机器上。检查
   （a）`%LOCALAPPDATA%\lol-record-analysis-app\config.yaml` 在旧版被卸载后**仍然存在**；
   （b）新版首启后 `%LOCALAPPDATA%\Rank Analysis\config.yaml` 出现，且 `playerNotes` 等内容与旧文件一致；
   （c）「程序和功能」里只有一条 Rank Analysis。

   本设计对「NSIS 卸载旧版时不会递归删掉安装目录」这一点的依据是上面 `device_id` 存活 20 余天的实测，但那是**同目录**升级。**跨目录（productName 变更）的卸载行为没有实测过**，必须在这一步验证。若实测发现旧目录被递归清空，本方案的迁移路线不成立，需要退回到「identifier 也一起改、让旧安装留着不卸」的方案。

2. **updater 链路**：确认 release 产物名仍是 `rank-analysis-{version}-setup.exe`（无空格），`latest.json` 里的 URL 无需编码即可下载。

## 五、已知代价

- Sentry 的 release 前缀从 `lol-record-analysis-app@` 变成 `rank-analysis@`，现有 saved query / alert 过滤器要跟着改一次。改名版本发布后新旧两个 release 名会并存于图表上。
- 目录改名会让所有未合入的分支在合并时撞上路径冲突。
