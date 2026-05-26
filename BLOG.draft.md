# 从 Electron+Go 迁到 Tauri 2+Rust：8 个月渐进重写，安装包从几十 MB 砍到 5MB

> 📌 本文是 [Rank Analysis](https://github.com/wnzzer/rank-analysis) 项目 2025 年初做的一次较大的技术栈重写复盘。如果你正在做类似的桌面端工具，或者在 Electron / Tauri 之间纠结，这篇可能对你有用。

## TL;DR

**关键数字：**

- 安装包：**~60MB → 5MB**（缩小 90%）
- 主二进制：**~70MB → 7MB**（缩小 90%）
- 运行时内存：**~400MB → ~200MB**（其中 WebView2 ~200MB 是系统共享，本进程实际占用远小于此）
- 冷启动时间：**~1.5s → ~500ms**（缩短到原来的 1/3）
- 删掉的旧代码：**-4274 行 Go / 34 个文件**（最后那次清扫 commit）
- 迁移周期：**8 个月**（2025-03 → 2025-12），渐进迁移，不停服

**技术栈对比：**

| 维度 | 旧 | 新 |
|---|---|---|
| 桌面壳 | Electron 31 | **Tauri 2** |
| 后端语言 | Go (HTTP server) | **Rust**（嵌入 Tauri 进程内） |
| 前端 | Vue 3 + TS + electron-vite + TDesign | Vue 3 + TS + **Vite + Naive UI** |
| 进程数 | 2（Electron + Go server） | **1** |
| IPC | localhost HTTP + JSON | **Tauri command** 直接调 Rust |

仓库：[github.com/wnzzer/rank-analysis](https://github.com/wnzzer/rank-analysis)

---

## 项目背景：这是个什么东西

[Rank Analysis](https://github.com/wnzzer/rank-analysis) 是一个英雄联盟（LOL）腾讯服的战绩查询助手。核心功能是开局自动拉取队友/对手的近期战绩，识别"混子队友"，按胜率、连胜连败、英雄熟练度等维度自动打标，再用 LLM 做一段每场的 AI 复盘。

它通过 [LCU API](https://hextechdocs.dev/getting-started-with-the-lcu-api/)（Riot 官方提供的本地客户端 HTTP 接口）跟正在运行的 LOL 客户端通信。**不注入 DLL、不读游戏内存**，所以不会被 Riot 反作弊误判。

项目 2024 年 12 月起步，最早的几篇介绍文章（基于旧 Electron+Go 版本）：

- [Rank-Analysis——LOL 排位战绩查询分析器（2025-01）](https://blog.csdn.net/faker1234546/article/details/145118496)
- [Rank-analysis-1.2 大四学生独立开发（2025-02）](https://blog.csdn.net/faker1234546/article/details/145412900)
- [战绩查询筛选分页（2025-02）](https://blog.csdn.net/faker1234546/article/details/145536380)

---

## 老架构：双进程 + HTTP 自循环

```
┌─────────────────────────────────┐
│  Electron 31 主进程              │
│  ┌───────────────────────────┐  │
│  │ Vue 3 + TDesign UI        │  │  ← 用户界面
│  └───────────┬───────────────┘  │
│              │ fetch / axios     │
└──────────────┼──────────────────┘
               │ localhost HTTP
               ▼
┌─────────────────────────────────┐
│  Go HTTP Server (localhost:xxx) │  ← 独立子进程
│  - LCU API client               │
│  - 自动化逻辑                    │
│  - 战绩聚合 / 标签计算            │
└──────────────┬──────────────────┘
               │ HTTPS (LCU 自签证书)
               ▼
┌─────────────────────────────────┐
│  LeagueClientUx (LOL 客户端)     │
└─────────────────────────────────┘
```

这套架构能跑，但有三个绕不开的痛点。

### 痛点 1：体积劝退

Electron 自带 Chromium runtime，光是这一层就 60~80MB。再加上 Go binary（业务逻辑 + LCU 客户端 + HTTP server）大概 30MB+。打包后安装包**接近 100MB 起步**。

对于一个 "战绩查询工具" 而言，这个体积太重了。用户从下载链接到打开应用要等好几分钟，不少人在这一步就劝退。

### 痛点 2：两进程，启动慢、监控难

启动时序大概是这样的：
1. Electron 启动
2. Electron 通过 child process 拉起 Go server
3. Go server 监听 localhost 端口
4. Electron 前端轮询 Go server 是否就绪
5. 一切就绪后才能调 LCU

任何一环出问题用户都看到"加载中"。打日志要打两份（Electron 一份、Go 一份），调试得在两个进程间来回跳。

### 痛点 3：本地 HTTP IPC 的隐性税

前端每次调后端：
```
JS 对象 → JSON 序列化 → HTTP body → loopback 网络 → Go 反序列化 → 业务逻辑 → 同样回程
```

虽然是 loopback，但 HTTP 头解析、TCP 握手（即便有 keep-alive 也得管理）、JSON 双向序列化的开销都是真的。在战绩查询这种"一次调用拉 10 个召唤师 + 各自最近 20 场对局"的场景下，本地 IPC 延迟肉眼可见。

---

## 为什么是 Tauri 2 + Rust

### 为什么不是 Tauri 1

- **Webview 选型**：Tauri 1 在 Windows 用的还是 Edge HTML 兜底，2 全面切 WebView2，CSS/JS 兼容性和稳定性都明显提升
- **Plugin v2**：插件系统重做，autostart / single-instance / sql / fs / shell 这些常用插件都有了一等公民支持
- **Capability + Permission 模型**：新的权限粒度模型，对 LCU 这种涉及本地敏感 API 的场景，能更清楚地声明 webview 能调什么、不能调什么

### 为什么 Rust 替掉 Go

- **Tauri 一等公民**：所有 `#[tauri::command]`、`State`、`AppHandle`、事件总线都是 Rust API。继续用 Go 等于绕一层 cgo/HTTP，迁移意义就丧失大半
- **嵌入式部署**：Rust 直接编译进 Tauri 主进程，不再需要单独的子进程，进程数从 2 → 1
- **静态链接**：单二进制分发，少一层运行时依赖

### 顺手换掉 TDesign

迁移过程中前端 UI 库也从 TDesign 换成了 [Naive UI](https://www.naiveui.com/)。原因：Naive UI 的暗色主题、表格、模态、表单组件用起来更顺，定制门槛低。这一步是顺带的，跟 Tauri 迁移没有强绑定。

---

## 迁移路径：不是周末重写，是 8 个月渐进

很多技术博客喜欢写"我用一个周末把 X 重写成了 Y"。我没那么牛 —— 这个迁移**真实耗时 8 个月**：

- **2025-03-31**：commit `619ac2f` "添加tauri2版本"，新建 `lol-record-analysis-tauri/` 目录，跟旧 `lol-record-analysis-app/`（Electron）+ `lol-record-client-golang/`（Go）并存
- **2025-04 ~ 2025-12**：一个 endpoint 一个 endpoint 往 Rust 搬。期间还在持续加新功能（不是冻结需求做迁移）
- **2025-12-13**：commit `a9e00b3`，**-4274 行 Go 代码 / 34 个文件**，旧 Go 服务彻底删除

### 为什么不一刀切

简单粗暴：**用户在线**。

项目有持续的 release 节奏（每 1-2 周一版），停下来做半年大重写不现实。所以选了渐进策略：

1. 旧 Electron+Go 项目保留，继续接受 bug fix
2. 新功能在 Tauri+Rust 项目里写
3. 旧功能按"高频用 → 低频用"的顺序往 Rust 搬，一搬完一个就在前端切流量
4. 全部搬完后再删旧代码

并存期间项目目录长这样：
```
.
├── lol-record-analysis-app/         # 旧 Electron 前端
├── lol-record-client-golang/        # 旧 Go 后端
└── lol-record-analysis-tauri/       # 新 Tauri + Rust + Vue
```

确实丑，但能持续发版。

---

## 三个真实陷阱

写给可能也要做类似迁移的朋友。

### 陷阱 1：LCU 的自签证书，reqwest 接受方式跟 Go 完全不同

LCU API 是 HTTPS，但用的是**每次客户端启动时动态生成的自签证书**。Go 里关掉 TLS 校验大致是：

```go
tr := &http.Transport{
    TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
}
client := &http.Client{Transport: tr}
```

到了 Rust 的 `reqwest`，得这么写：

```rust
let client = reqwest::Client::builder()
    .danger_accept_invalid_certs(true)
    .build()?;
```

**API 名字直接把 "danger" 写脸上**，第一次看到会有点慌。但 LCU 场景里这是唯一可行的方式（Riot 不可能给你 CA-signed cert）。

<!-- TODO: 这里你可以加几句你当时具体踩到的细节，比如：
- 找 LCU 端口和 token 的方式（lockfile vs WMIC）
- 是否遇到 reqwest connection pool 在长连接下的奇怪行为
- 在 Tauri command 里怎么共享 client 实例
-->

### 陷阱 2：Tauri 2 的 capability/permission 模型，第一次配会懵

Electron 的安全模型基本是"开 nodeIntegration / 关 nodeIntegration"二选一。Tauri 2 是**白名单粒度**：

```json
{
  "permissions": [
    "core:default",
    "shell:allow-open",
    "http:default",
    "fs:allow-read-text-file",
    ...
  ]
}
```

每个 webview 能调什么 Tauri command、能访问什么文件路径、能开什么 URL，都得显式声明。

**第一次写很容易陷入"我代码写对了为啥跑不通"的死循环**，因为权限不足时报错不一定指向 capability 配置文件。后来摸熟了套路，每加一个新 Tauri command 就同步检查一下 `capabilities/default.json`。

<!-- TODO: 你可以补一两个具体被卡住的 capability，比如 fs / shell / http 的哪个权限你折腾了挺久 -->

### 陷阱 3：前端 fetch → invoke，要不要建抽象层

旧前端到处是：

```ts
const data = await fetch('/api/match-history?puuid=xxx').then(r => r.json())
```

新前端调 Rust command 是：

```ts
import { invoke } from '@tauri-apps/api/core'
const data = await invoke('get_match_history', { puuid: 'xxx' })
```

要不要建一层 `services/` 抽象，让两套调用方式可切换？我**最后决定不建**，理由：

- 抽象层意味着维护两份接口签名（HTTP 版 + invoke 版），并存期间双倍工作
- 真正想抽象的不是"HTTP vs IPC"，而是**类型签名**。我直接在前端写 TS types，跟 Rust serde struct 手动对齐，CI 跑 typecheck，错了能立刻发现
- 一旦旧 HTTP 路径彻底废弃，抽象层就是死代码

如果你的项目并存期超过半年，可能确实需要抽象层。我这个 case 没用是因为前端代码量没那么大，直接 sed 改完事。

<!-- TODO: 这里你可以补：你具体怎么管理 Rust types 和 TS types 同步的；是否用了 ts-rs / specta 之类自动生成 -->

---

## 效果对比

| 维度 | Electron + Go | **Tauri 2 + Rust** | 变化 |
|---|---|---|---|
| 安装包 | ~60MB+ | **5MB** | -90% |
| 主二进制 | Electron ~60MB + Go binary ~10MB | **7MB** | -90% |
| 运行时内存 | ~400MB | **~200MB**¹ | -50% |
| 冷启动时间 | ~1.5s | **~500ms** | -67% |
| 进程数 | 2 | **1** | -1 |
| IPC 方式 | localhost HTTP + JSON 序列化 | Tauri command 直接调用 | 减少一次完整 HTTP 往返 |
| 启动时序 | Electron → 拉 Go server → 等就绪 | **单进程直起** | 显著缩短 |
| 调试日志 | Electron + Go 各一套 | **统一一份** | 简化 |

> ¹ 其中 WebView2 占 ~200MB 是系统共享组件，应用本进程实际占用远小于此数字。

---

## 给想做类似迁移的人

3 个不那么显然的建议：

1. **别一刀切**：留旧项目并存。Tauri 项目作为一个独立目录建出来，旧 Electron + Go 继续吃存量。这样你随时能 ship 新版本，不会陷在半成品里。

2. **从最高频功能开始迁**：战绩查询是这个工具的核心。先把它迁到 Rust，让大部分用户用上 Tauri 版本之后，再处理边角功能。不要按 "代码量小的先迁" 的逻辑，要按 "用户感知最强的先迁"。

3. **不要顺带做太多重构**：迁移本身已经够复杂，UI 改版、需求重设计这些事情最好分开做。我自己唯一妥协的是顺手换了 UI 库（TDesign → Naive UI），但这一步也独立做了一周专项工作，没掺在迁移 commit 里。

---

## 结语

这次迁移是我个人项目的一次**实测**：Tauri 在桌面工具类应用上对 Electron 的体积/性能优势是真的，而且 Tauri 2 已经成熟到可以承担生产任务。

如果你有兴趣看代码：
- 仓库：[github.com/wnzzer/rank-analysis](https://github.com/wnzzer/rank-analysis)
- 当前最新版安装包：[releases/latest](https://github.com/wnzzer/rank-analysis/releases/latest)
- 历史版本（旧 Electron+Go）介绍文章：[① 项目介绍](https://blog.csdn.net/faker1234546/article/details/145118496) | [② 1.2 版本](https://blog.csdn.net/faker1234546/article/details/145412900) | [③ 分页设计](https://blog.csdn.net/faker1234546/article/details/145536380)

欢迎 issue 交流。

<!-- TODO: 发布前自查清单
1. 三个 TODO 占位补上具体细节
2. 决定要不要加几张截图（Tauri devtools / 安装包对比 / 内存对比）
3. 标题可以再润色一版，候选：
   - "Electron+Go → Tauri 2+Rust：我把桌面工具体积砍掉 90%"
   - "从 Electron 迁到 Tauri 2：一个 LOL 战绩工具的真实记录"
   - "我用 8 个月把 Electron+Go 重写成 Tauri 2+Rust，分享 3 个坑"
4. CSDN / dev.to 双投，dev.to 版本翻译时把 "LOL 腾讯服" 改成 "LOL (League of Legends)"
-->
