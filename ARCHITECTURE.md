# 项目架构与规模分析 / Architecture & Scale Analysis

本文档全面描述 **Rank Analysis** 项目的规模、架构设计与工程实践水平，供开发者快速理解项目全貌。

---

## 📐 项目规模概览

### 代码量统计

| 维度 | 数量 |
|------|------|
| 前端文件（`.ts` / `.vue`） | 50 个 |
| 后端文件（`.rs`） | 39 个 |
| 前端代码行数 | ~12,192 行 |
| 后端代码行数 | ~8,314 行 |
| **总计** | **~20,506 行** |

### 模块规模

| 层次 | 数量 |
|------|------|
| Vue 视图（Views） | 5 个主视图 + 4 个设置子视图 |
| Vue 组件（Components） | 14 个 |
| 组合式函数（Composables） | 5 个 |
| 服务层（Services） | 3 个 |
| Pinia Store | 1 个 |
| Tauri Command 模块 | 10 个 |
| LCU API 封装模块 | 9 个 |
| Rust 核心模块 | 7 个 |

---

## 🏗️ 整体架构

### 技术栈

```
┌─────────────────────────────────────────────────┐
│                  前端 (WebView2)                  │
│  Vue 3.4 + TypeScript 5.3 + Naive UI 2.37        │
│  Pinia 2.3 + Vue Router 4.2 + Vite 5.0          │
├─────────────────────────────────────────────────┤
│              Tauri 2.0 IPC 桥接层                 │
│         invoke() / listen() / 自定义协议          │
├─────────────────────────────────────────────────┤
│                 后端 (Rust)                       │
│  Tauri Command + Tokio + reqwest + moka cache    │
│  WebSocket (tokio-tungstenite) + Lua (mlua)      │
├─────────────────────────────────────────────────┤
│              外部依赖 / 系统层                     │
│  League Client (LCU API) + AI 服务 + Windows API │
└─────────────────────────────────────────────────┘
```

### 数据流架构

```
用户操作 (Vue 组件)
      │
      ▼
服务层 (ipc.ts / ai.ts)
      │  Tauri invoke()
      ▼
Tauri Command Handler (Rust)
      │
      ├──► LCU HTTP API ──► League Client
      │
      ├──► LCU WebSocket ──► 实时游戏事件
      │
      ├──► 外部 AI 服务 ──► 对局分析
      │
      └──► Moka 缓存层 (TTL: 2h)
```

---

## 🖥️ 前端架构

### 目录结构

```
src/
├── main.ts                  # 应用入口，注册 Pinia / Router / NaiveUI
├── App.vue                  # 根组件，负责主题初始化
├── router/index.ts          # 路由配置（Hash 模式，懒加载）
├── pinia/setting.ts         # 全局设置状态（主题持久化）
├── views/                   # 页面视图层
│   ├── Loading.vue          # 启动加载屏
│   ├── Record.vue           # 战绩查询页
│   ├── MatchDetail.vue      # 对局详情弹窗
│   ├── Gaming.vue           # 实时对局分析页（核心，~780 行）
│   └── settings/            # 设置子页面
│       ├── General.vue      # 通用设置（主题切换）
│       ├── Automation.vue   # 自动化配置
│       ├── Tags.vue         # 玩家标签管理
│       ├── TagConditionNode.vue  # 条件构建器（~350 行）
│       └── About.vue        # 关于页面
├── components/              # 可复用组件
│   ├── Framework.vue        # 主布局容器
│   ├── Header.vue           # 标题栏（含自定义窗口控件）
│   ├── SideNavigation.vue   # 侧边导航栏
│   ├── LoadingComponent.vue # 通用加载占位
│   ├── gaming/              # 对局分析专用组件
│   │   ├── PlayerCard.vue   # 玩家信息卡片
│   │   └── MettingPlayersCard.vue  # 历史遭遇展示
│   └── record/              # 战绩模块组件
│       ├── RecordCard.vue   # 单条战绩卡片
│       ├── MatchHistory.vue # 战绩列表
│       ├── MatchDetailModal.vue  # 对局详情模态框
│       ├── UserRecord.vue   # 用户战绩面板
│       ├── AssetTooltipContent.vue  # 装备/符文提示
│       └── StatDots.vue     # 统计点图
├── composables/             # 组合式函数（可复用逻辑）
│   ├── useGameState.ts      # 游戏会话状态管理
│   ├── useAssetUrl.ts       # 游戏资源 URL 生成
│   ├── useDateFormat.ts     # 日期时间格式化
│   ├── useTheme.ts          # 主题管理
│   └── useWindowControls.ts # 窗口控制
├── services/                # 外部通信服务层
│   ├── ipc.ts               # Tauri Command 封装
│   ├── http.ts              # HTTP 请求客户端
│   └── ai.ts                # AI 分析服务（含 Markdown 解析）
└── types/                   # 全局类型定义
```

### 路由设计（Hash 模式，全部懒加载）

```
/               → 重定向到 /Loading
/Loading        → 启动加载（等待游戏客户端连接）
/Record         → 战绩查询视图
/MatchDetail    → 对局详情（弹窗形式）
/Gaming         → 实时游戏分析视图
/Settings                → 设置容器
  /Settings/General      → 通用设置
  /Settings/Automation   → 自动化设置
  /Settings/Tags         → 标签管理
  /Settings/About        → 关于
```

---

## ⚙️ 后端架构（Rust）

### 目录结构

```
src-tauri/src/
├── main.rs                  # 入口：注册命令、插件、状态、URI 协议
├── state.rs                 # AppState（OnceLock HTTP 端口、Moka 缓存）
├── config.rs                # YAML 配置读写
├── constant.rs              # 游戏常量与 API 路径
├── automation.rs            # Lua 脚本驱动的自动化功能
├── game_state_monitor.rs    # WebSocket 实时游戏阶段监控
├── fandom.rs                # Fandom Wiki 英雄强化数据爬取
├── command/                 # Tauri Command 处理器（10 个模块）
│   ├── session.rs           # 当前游戏会话与玩家检测
│   ├── match_history.rs     # 排位战绩查询
│   ├── rank.rs              # 段位/分段信息
│   ├── ai.rs                # AI 分析请求转发
│   ├── user_tag.rs          # 用户标签应用
│   ├── user_tag_config.rs   # 标签配置 CRUD
│   ├── config.rs            # 应用配置管理
│   ├── asset.rs             # 游戏资源（Base64 图片）
│   ├── fandom.rs            # 英雄平衡数据
│   └── info.rs              # 应用信息
└── lcu/                     # LCU API 封装层
    ├── api/                 # 各端点模块
    │   ├── session.rs       # 游戏流状态（/lol-gameflow-v2/...）
    │   ├── lobby.rs         # 大厅信息（/lol-lobby-v2/...）
    │   ├── champion_select.rs  # 选择阶段（/lol-champ-select/...）
    │   ├── match_history.rs # 对局历史（/lol-match-history-v1/...）
    │   ├── rank.rs          # 段位数据（/lol-ranked/v1/...）
    │   ├── game_detail.rs   # 对局详情（/lol-endofgame-v1/...）
    │   ├── summoner.rs      # 召唤师信息（/lol-summoner/v1/...）
    │   ├── asset.rs         # 图像资源（缓存与转换）
    │   ├── phase.rs         # 游戏阶段枚举解析
    │   └── model.rs         # API 响应数据类型
    └── util/
        ├── http.rs          # 带 LCU 认证的 HTTP 客户端
        └── token.rs         # 从进程中提取 LCU 端口与令牌
```

---

## 🎨 核心设计模式

### 1. Tauri Command 模式（前后端通信）

```typescript
// 前端：services/ipc.ts
export const getMatchHistory = (puuid: string) =>
  invoke<MatchHistory[]>('get_match_history', { puuid })
```

```rust
// 后端：command/match_history.rs
#[tauri::command]
pub async fn get_match_history(
    puuid: String,
    state: State<'_, AppState>,
) -> Result<Vec<MatchHistory>, String> { ... }
```

### 2. 服务层抽象

前端通过 `services/ipc.ts`、`services/http.ts`、`services/ai.ts` 统一封装所有外部通信，组件层不直接调用底层 API。

### 3. 组合式函数（Composable）模式

业务逻辑从组件中抽离，封装为可复用的 `useXxx()` 函数，保持组件简洁：

```typescript
// composables/useAssetUrl.ts
export function useAssetUrl() {
  const getChampionIconUrl = (championId: number) => `asset://localhost/champion/${championId}`
  return { getChampionIconUrl }
}
```

### 4. 响应式状态管理（Pinia）

```typescript
// pinia/setting.ts
export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<'dark' | 'light'>('dark')
  // 持久化到 Tauri 配置
  return { theme }
})
```

### 5. Rust 懒初始化（OnceLock）

```rust
// state.rs
pub struct AppState {
    pub http_port: OnceLock<u16>,        // 一次性初始化 LCU 端口
    pub fandom_cache: Arc<Cache<...>>,   // Moka TTL 缓存（2 小时过期）
}
```

### 6. 自定义 URI 协议

通过注册 `asset://` 协议直接从 Rust 后端提供游戏资源图片，避免将图片嵌入 JS Bundle，并支持独立缓存控制：

```rust
// main.rs
.register_uri_scheme_protocol("asset", |_app, request| {
    // 从 LCU 读取图片并以 HTTP 响应形式返回
})
```

### 7. Lua 脚本驱动的自动化

自动化功能（自动接受、自动 BP）通过 `mlua` 运行 Lua 脚本，支持用户自定义脚本逻辑，无需重新编译应用。

---

## ⚡ 性能优化策略

### 前端

| 策略 | 描述 |
|------|------|
| 路由懒加载 | 所有视图按需加载，减少首屏体积 |
| 代码分割 | Vite 手动分块（vendor、ui-lib），复用缓存 |
| Terser 压缩 | 生产构建移除 console/debugger，极致压缩 |
| 小资源内联 | < 4KB 资源直接 Base64 内联 |

### 后端

| 策略 | 描述 |
|------|------|
| Release 优化 | `opt-level = "z"` 尺寸优先，LTO 链接时优化，符号裁剪 |
| Moka 缓存 | API 响应 TTL 缓存，减少重复网络请求 |
| 异步并发 | Tokio runtime，所有 I/O 操作全异步 |
| OnceLock | LCU 端口一次初始化，避免重复进程扫描 |
| 单代码生成单元 | `codegen-units = 1`，最大化编译优化 |

---

## 🔒 工程质量保障

### 代码质量工具链

| 工具 | 用途 |
|------|------|
| ESLint 8.56 | 前端静态分析，捕获潜在错误 |
| Prettier 3.2 | 前端代码格式化 |
| TypeScript 严格模式 | `strict`、`noUnusedLocals`、`noUnusedParameters` |
| Clippy | Rust 代码 lint，识别常见错误模式 |
| Rustfmt | Rust 代码格式化 |
| Vitest 1.2 | 前端单元测试（组件、Composable、Service） |
| GitHub Actions | CI/CD，自动化检查 |

### 前端测试覆盖

```
tests/
├── composables/useAssetUrl.spec.ts    # 资源 URL 生成逻辑
├── composables/useDateFormat.spec.ts  # 日期格式化逻辑
├── composables/useTheme.spec.ts       # 主题管理逻辑
├── services/ipc.spec.ts               # IPC 通信封装
└── components/record/composition.spec.ts  # 战绩模块组合逻辑
```

### TypeScript 配置（严格）

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true
}
```

---

## 📦 构建与发布

### 构建流程

```
前端构建                         后端构建
   │                                │
vue-tsc (类型检查)          cargo build --release
   │                                │
vite build (打包)           opt-level=z / LTO / strip
   │                                │
手动代码分割                  tauri bundle
   │                                │
Terser 压缩                  ─────────────
   └──────────────────────────────▶ MSI/EXE (Windows)
```

### 系统要求

- **平台**: Windows 10 1803+
- **依赖**: WebView2 Runtime
- **游戏**: League of Legends（需要运行中的客户端）

---

## 🧩 外部集成

| 集成 | 协议 | 用途 |
|------|------|------|
| LCU HTTP API | HTTPS + Basic Auth | 查询战绩、段位、召唤师信息 |
| LCU WebSocket | WSS | 实时游戏状态推送（游戏阶段变化） |
| AI 分析服务 | HTTPS | 对局智能分析与点评 |
| Fandom Wiki | HTTPS | 英雄强化数据爬取 |
| Windows API | winapi | 进程扫描，获取 LCU 端口与令牌 |

---

## 📊 设计水平评估

| 维度 | 评估 | 说明 |
|------|------|------|
| **架构清晰度** | ⭐⭐⭐⭐⭐ | 前后端分层明确，IPC 边界清晰，服务层统一封装 |
| **技术选型** | ⭐⭐⭐⭐⭐ | Tauri 2.0 + Vue 3 + Rust，现代化且高效 |
| **代码规范** | ⭐⭐⭐⭐⭐ | TypeScript 严格模式、ESLint、Prettier、Clippy 全覆盖 |
| **可维护性** | ⭐⭐⭐⭐ | 模块化设计，Composable 模式，职责分离清晰 |
| **性能优化** | ⭐⭐⭐⭐⭐ | 前端懒加载+代码分割，后端缓存+异步+编译优化全部到位 |
| **工程实践** | ⭐⭐⭐⭐ | CI/CD、单元测试、语义化提交、贡献指南齐全 |
| **规模** | 中型 | ~20.5K 行，89 个源文件，功能完整的生产级桌面应用 |

**总结**：这是一个**生产级中型桌面应用**，采用了业界主流的现代技术栈，架构设计清晰合理，工程规范完善，代码质量达到专业水准。对于一个基于 Tauri 构建的游戏工具类应用而言，其整体设计和实现水平较高。
