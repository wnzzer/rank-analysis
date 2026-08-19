# 战场四 4b：透明置顶 Overlay 窗口方案评估

**日期**：2026-08-19
**里程碑**：M5c（P3）战场四 4b 阶段
**结论**：**GO** —— Tauri 2.0 + tao 0.36 具备所有核心能力，可行。

---

## 1. 评估目标

国服无 Overwolf SDK，需要自研透明置顶 overlay 窗口展示 NextAction 建议。
评估 Tauri 2.0（tao/wry）是否具备构建游戏 overlay 所需的全部能力。

## 2. 核心能力验证

| 需求 | tao API | Windows 支持 | 结论 |
|------|---------|-------------|------|
| 透明窗口 | `WindowAttributes.transparent` | 支持 | 通过 |
| 无边框 | `WindowAttributes.decorations` | 支持 | 通过 |
| 始终置顶 | `Window.set_always_on_top(true)` | 支持 | 通过 |
| 鼠标穿透 | `Window.set_ignore_cursor_events(true)` | 支持 | 通过 |
| 不抢焦点 | `WindowAttributes.focusable` | 支持 | 通过 |
| 多窗口 | Tauri 2.0 `WebviewWindowBuilder` | 支持 | 通过 |
| 窗口定位 | `Window.set_outer_position()` | 支持 | 通过 |
| 透明背景色 | `WindowAttributes.transparent` + CSS `background: transparent` | 支持（alpha 走 CSS，不走 `background_color`） | 通过 |

### 2.1 关键 API：`set_ignore_cursor_events`

```rust
// tao 0.36: Window::set_ignore_cursor_events
pub fn set_ignore_cursor_events(
    &self,
    ignore: bool,
) -> Result<(), ExternalError>
```

- `true`：鼠标事件穿透窗口，传递给窗口下方的游戏
- `false`：窗口正常捕获鼠标事件
- **Windows 平台完全支持**，无平台限制

这是 overlay 方案最关键的能力——确保 overlay 窗口不阻挡游戏操作。

### 2.2 Windows 平台注意事项

- `background_color` 的 alpha 通道在 Windows 上被忽略。需使用 `transparent: true` + 前端 CSS `background: transparent` 实现透明
- `visible_on_all_workspaces` 不在 Windows 上支持（不影响游戏 overlay 场景）
- `content_protection` 不在 Windows 上支持（防截屏，非核心需求）

## 3. 技术方案

### 3.1 架构

```
┌─────────────────────────────────────┐
│  游戏窗口（全屏/无边框）              │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ NextAction Overlay（右上角）   │   │
│  │ - transparent: true          │   │
│  │ - decorations: false         │   │
│  │ - always_on_top: true        │   │
│  │ - focusable: false           │   │
│  │ - ignore_cursor_events: true │   │
│  │ - 宽度: 320px, 自适应高度     │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 3.2 Rust 端创建 overlay 窗口

```rust
// 在 main.rs setup 或专用模块中
use tauri::WebviewWindowBuilder;

let overlay = WebviewWindowBuilder::new(
    app,
    "overlay",
    tauri::WebviewUrl::App("overlay.html".into()),
)
.title("")
.inner_size(320.0, 120.0)
.transparent(true)
.decorations(false)
.always_on_top(true)
.focusable(false)
.resizable(false)
.skip_taskbar(true)
.visible(false) // 对局中才显示
.build()?;
```

### 3.3 前端 overlay 页面

独立的轻量 Vue 页面（`overlay.html`），仅包含 NextActionCard 组件。
最小化 DOM 和样式，保证低开销。

### 3.4 数据流

```
Gaming.vue（主窗口）
  │ pollNextActions（2s 间隔）
  │
  ├─ invoke("get_next_actions") → Rust 引擎
  │
  └─ emit("overlay:update", actions) → overlay 窗口
       │
       └─ NextActionCard 渲染
```

通过 Tauri 事件系统（`app.emit()`) 在主窗口和 overlay 窗口间传递数据。

## 4. 风险与限制

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 反作弊系统误判 | 中 | overlay 窗口仅展示静态文本，不注入游戏进程；国内反作弊系统（腾讯 ACE）通常不拦截顶层透明窗口 |
| 游戏全屏模式兼容 | 低 | 测试无边框窗口 + 全屏模式下的置顶行为；备选方案：副屏/第二显示器展示 |
| WebView 渲染开销 | 低 | 轻量 overlay 页面（< 10KB），仅渲染 NextActionCard，无动画、无图片 |
| 鼠标穿透后无法交互 | 低 | 可设计为"悬停恢复交互"模式：鼠标悬停 overlay 区域短暂恢复捕获，展示详情后重新穿透 |
| `always_on_top` 在部分窗口管理器不稳定 | 低 | 仅 Windows 目标平台，Windows 的 `WS_EX_TOPMOST` 稳定可靠 |

## 5. 实施建议

### 5.1 分阶段实施

1. **POC 阶段**（1-2 天）：创建 overlay 窗口，验证透明、置顶、鼠标穿透在真实游戏场景下工作
2. **MVP 阶段**（1-2 天）：接入 NextAction 数据流，展示建议卡片
3. **优化阶段**（1 天）：调优定位、样式、性能

### 5.2 配置项

为 overlay 窗口提供用户可配置的选项：
- 显示位置：右上角 / 左上角 / 右下角 / 左下角
- 显示时机：始终显示 / 仅关键事件显示 / 关闭
- 透明度：slider 0.3-1.0

### 5.3 降级策略

- 无法创建 overlay 窗口时：降级为主窗口内 Tab 展示（当前 M5a/M5b 行为）
- 游戏窗口检测失败时：overlay 显示在屏幕固定位置

## 6. 结论

**GO** —— Tauri 2.0（tao 0.36）具备构建游戏 overlay 窗口的全部核心能力。
`set_ignore_cursor_events` 是方案的关键 enabler，解决了 overlay 不阻挡游戏操作的核心需求。
建议按 5.1 分阶段实施，POC 阶段优先验证真实游戏场景下的兼容性。