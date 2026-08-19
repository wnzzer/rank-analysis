# 战场四 4c：游戏事件流 POC 评估

**日期**：2026-08-19
**里程碑**：M5d（P3）战场四 4c 阶段
**时间盒**：1 周
**结论**：**NO-GO** —— 当前无需替换轮询方案；日志文件轻量增强推荐作为低风险推进项。

---

## 1. 评估目标

4a 当前用 `liveclientdata` 轮询（2s HTTP）获取 in-game 快照 + 事件流。
4c 目标是探索**真事件流（push-based）**替代轮询，降低延迟并减少无谓 HTTP 请求。

## 2. 方案矩阵

| # | 方案 | 事件源 | 延迟 | 风险 | 国服可用 | 结论 |
|---|------|--------|------|------|---------|------|
| A | LCU WebSocket 扩展 | LCU (wss://127.0.0.1:{port}) | 实时 | 低 | 已验证 | **已有事件有限（gameflow/champ-select/lobby/session），无 in-game 事件** |
| B | liveclientdata 高频轮询 | liveclientdata (HTTP 2999) | 500ms-1s | 极低 | 已验证 | **当前方案调参即可，无需架构变更** |
| C | 游戏日志文件 tail | 游戏进程 Logs 目录 | 近实时 | 低 | 是 | **可行，推荐作为低风险增强** |
| D | 游戏进程内存读取 | LoL 进程内存 | 零延迟 | 极高（ACE） | 是 | **绝不可行——触碰 ACE 反作弊** |
| E | WeGame API/SDK | WeGame 平台 | 未知 | 高 | 是 | **无公开 API，不可行** |
| F | Windows ETW | 内核事件追踪 | 实时 | 高 | 是 | **过度工程，收益低** |

---

## 3. 方案详细分析

### 3.1 方案 A：LCU WebSocket 扩展

**现状**：`lcu/listener.rs` 已通过 `wss://127.0.0.1:{port}` 订阅 `OnJsonApiEvent`，监听以下 URI：
- `/lol-gameflow/v1/gameflow-phase`（游戏阶段变化）
- `/lol-champ-select/v1/session`（选人阶段）
- `/lol-lobby/v2/lobby`（大厅）
- `/lol-gameflow/v1/session`（Session）

**分析**：
- LCU WebSocket 的 `OnJsonApiEvent` 是 LCU REST API 的镜像——任何 REST 端点的变更都会触发事件
- LCU REST API 的范围是**客户端级**（大厅/选人/结算/收藏），**不含 in-game 细节**
- 对局中 LCU 可用的端点有限：`/lol-gameflow/v1/session`（含 gameId）、`/lol-summoner/v1/current-summoner`、`/lol-chat/v1/conversations` 等
- `liveclientdata` 是**独立服务**（端口 2999），有自己的数据源，**不在 LCU WebSocket 覆盖范围内**

**结论**：LCU WebSocket 无法提供 in-game 实时事件（击杀/资源/塔）。已覆盖的 gameflow 事件已足够判断对局开始/结束。

### 3.2 方案 B：liveclientdata 高频轮询

**现状**：`lcu/api/live_game.rs` 通过 `http://127.0.0.1:2999/liveclientdata/allgamedata` 每次返回完整快照（players + events + game_data），前端 2s 轮询。

**分析**：
- liveclientdata 是本地 HTTP 服务（无网络延迟），当前 `LIVE_CLIENT_TIMEOUT = 3s`
- 每次请求返回**全量数据**（所有玩家 + 所有事件），而非增量
- 事件列表 `events` 是累积的（从 GameStart 到当前），已有事件 ID 去重基础
- 2s 轮询对 NextAction 建议（回城/出装/资源）已足够——这些动作窗口是秒级，非毫秒级

**优化方向**：
- 降低轮询间隔到 1s 或 500ms（liveclientdata 是本地服务，开销极小）
- 前端 diff 去重：只处理新增事件（按 EventID 过滤）
- 可考虑后端轮询 + 事件推送，避免前端多轮 invoke

**结论**：当前方案已满足需求。2s → 1s 调参即可获得更灵敏的体验，无需架构变更。

### 3.3 方案 C：游戏日志文件 tail

**原理**：League 客户端在运行期间向 `{GameRoot}/Logs/Game - R3d Logs/` 写入日志，包含游戏事件。

**日志位置**（国服）：
- 通过 `discover_game_root()` 获取安装根目录
- 日志目录：`{root}/Game/Logs/` 或 `{root}/Logs/Game - R3d Logs/`
- 文件命名格式：`{timestamp}_r3dlog.txt`

**日志内容示例**（推测）：
- 击杀事件：`Champion {killer} killed {victim}`
- 资源事件：`Dragon {type} killed by {team}`
- 塔事件：`Turret {lane} destroyed by {team}`
- 游戏状态：`GameStart`, `GameEnd`, `MinionSpawn`

**技术方案**：
```rust
// 伪代码：日志文件监控模块
use notify::{Watcher, RecursiveMode, watcher};
use std::sync::mpsc::channel;

fn watch_game_logs(game_root: &Path) {
    let log_dir = game_root.join("Game").join("Logs");
    let (tx, rx) = channel();
    let mut watcher = watcher(tx, Duration::from_secs(1)).unwrap();
    watcher.watch(&log_dir, RecursiveMode::NonRecursive).unwrap();

    // 新日志文件出现 = 新对局开始
    // 文件内容追加 = 实时事件
}
```

**风险**：
- 日志格式无官方文档，可能随版本变化
- 需要正则/关键词匹配解析，不够结构化
- 日志可能有缓冲延迟（写入不是实时的）

**优势**：
- 完全安全——只读文件，不触碰游戏进程
- 可获取 liveclientdata 不提供的事件（如 MinionSpawn、具体技能使用）
- 对局结束也可以事后解析

**结论**：**推荐作为低风险增强项**。可实现为可选模块，优先级低于 liveclientdata。

### 3.4 方案 D：游戏进程内存读取

**风险**：**不可行**。国服使用腾讯 ACE 反作弊，任何进程内存读取（`ReadProcessMemory`、DLL 注入、hook）都会被检测并导致封号。这是用户最不能接受的风险。

**结论**：绝不可行。

### 3.5 方案 E：WeGame API/SDK

**分析**：WeGame 是腾讯游戏平台，可能提供游戏事件接口。但：
- 无公开 API 文档
- 无 SDK
- 不确定是否提供 in-game 事件
- 即使有，也是私有协议，随时可能变化

**结论**：不可行。无公开 API，无法可靠接入。

### 3.6 方案 F：Windows ETW

**分析**：Event Tracing for Windows 是内核级事件追踪，可监控进程行为。但：
- 需要管理员权限
- 事件粒度太细（系统调用级），需要大量过滤
- 游戏进程反作弊可能检测 ETW 消费
- 工程复杂度极高，收益极低

**结论**：过度工程，不可行。

---

## 4. 推荐方案

### 4.1 短期（NOW）：liveclientdata 高频轮询

**结论**：**NO-GO**（无需替换轮询方案）

当前 liveclientdata 2s 轮询已满足 4a 需求。如果需要更灵敏的体验：
- 将轮询间隔从 2s 降到 1s
- 前端 diff 去重（按 EventID）
- 后端轮询 + push 到前端（减少 invoke 次数）

这些是**参数调优**，不是架构变更，不涉及 4c 的"事件流接入"目标。

### 4.2 中期（NICE-TO-HAVE）：日志文件监控

**条件推进**：如果 liveclientdata 在特定场景下不够用（如需要更细粒度的事件），可实施日志文件监控。

**优先级**：P3（顺风局再做），低于 bug 修复和体验优化。

**实施建议**：
1. 通过 `discover_game_root()` 定位日志目录
2. 使用 `notify` crate 监听日志文件变化
3. 正则解析事件类型（击杀/资源/塔/游戏状态）
4. 通过 Tauri event 推送到前端
5. 作为 liveclientdata 的**补充**（非替代），两者并行

---

## 5. 决策记录

| 决策 | 结论 | 理由 |
|------|------|------|
| 是否替换 liveclientdata 轮询？ | 否 | 轮询已满足需求，调参即可 |
| 是否接入 WeGame？ | 否 | 无公开 API |
| 是否读取游戏进程内存？ | 否 | ACE 反作弊风险 |
| 是否实施日志文件监控？ | 条件推进 | 安全可行，但优先级低 |
| 4c 整体结论 | **NO-GO** | 当前方案足够，无需架构变更 |

---

## 6. 对 4a/4b 的影响

- **4a 不受影响**：继续使用 liveclientdata 轮询 + diff 事件
- **4b 不受影响**：overlay 窗口数据源不变
- **4c 不阻塞其他里程碑**：NO-GO 结论，4a/4b 已独立完成

## 7. 修订记录

- **v1.0（2026-08-19）**：初版，基于现有代码分析 + 方案矩阵评估，输出 NO-GO 结论。