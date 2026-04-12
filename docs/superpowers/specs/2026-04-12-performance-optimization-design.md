# 性能优化设计文档

**日期：** 2026-04-12
**范围：** Rust 后端性能优化（4 项）
**目标：** 减少战绩加载延迟、消除冗余请求、修复 MVP 计算

---

## 1. 战绩接口内部并发化

### 现状

`command/session.rs` 的 `process_team_parallel()` 已跨玩家并行（5 人同时），但单个玩家内部的数据加载是串行的：

```
summoner → match_history → user_tag → rank（每步等上一步完成）
```

单玩家加载延迟 = 4 次串行 RTT。

### 方案

将单玩家内的调用分为两组并行：

**第一组（无依赖，可并行）：**
- `Summoner::get_summoner_by_puuid()`
- `MatchHistory::get_match_history_by_puuid()`
- `Rank::get_rank_by_puuid()`

**第二组（依赖 match_history 结果）：**
- `get_user_tag_by_puuid()` — 需要 match_history 数据

使用 `tokio::join!` 实现第一组并行，第一组全部完成后再执行第二组。

**预期效果：** 单玩家加载从 4 次串行 RTT 降到 2 次（第一组 1 RTT + 第二组 1 RTT）。

### 修改文件

- `lol-record-analysis-tauri/src-tauri/src/command/session.rs` — `process_team_parallel()` 内部的单玩家加载逻辑

---

## 2. 移除对局预加载

### 现状

`SideNavigation.vue` 中有一个 `watch(isInGame)` 监听器，在检测到游戏阶段变化时提前调用 `invoke('get_session_data')`。这会在后台 spawn 10 个并发请求加载所有玩家数据，即使用户尚未进入对局页面。

### 问题

- 用户可能不打算查看对局页，白白消耗资源
- 与正常导航时的 `get_session_data` 调用产生竞争
- LCU 本地 API 被额外打了一轮请求，可能造成卡顿

### 方案

删除 `SideNavigation.vue` 中的预加载 watch 块：

```typescript
// 删除这段代码（约8行）
watch(
  isInGame,
  inGame => {
    if (inGame) {
      invoke('get_session_data').catch(() => {})
    }
  },
  { immediate: true }
)
```

用户进入对局页时，`Gaming.vue` 的 `onMounted` 会正常调用 `get_session_data`，不受影响。

### 修改文件

- `lol-record-analysis-tauri/src/components/SideNavigation.vue` — 删除 watch 块及相关 `invoke` import

---

## 3. Singleflight + 最大并发数

### 现状

`lcu/util/http.rs` 的 `lcu_get<T>()` 没有任何请求去重和并发控制：
- 10 个玩家同时请求相同 game detail → 10 个重复 HTTP 请求
- 无并发上限，高峰期可能同时发出 50+ 请求打满 LCU

### 方案

#### 3.1 Singleflight（请求去重）

在 `lcu_get` 层面实现 in-flight 请求合并：

```rust
static IN_FLIGHT: LazyLock<DashMap<String, Arc<tokio::sync::watch::Sender<Option<Result<Bytes, String>>>>>>>
```

逻辑：
1. 收到请求 URL
2. 检查 `IN_FLIGHT` 是否有相同 URL 的进行中请求
3. 如果有 → 订阅该请求的结果 channel，等待返回
4. 如果没有 → 插入 key，发起真实请求，完成后广播结果给所有等待者，移除 key

简化实现：使用 `moka::future::Cache` 的 `try_get_with()` 方法，天然支持 singleflight 语义（相同 key 的并发调用只执行一次 init 闭包）。设置极短 TTL（如 100ms）使其只合并同一瞬间的重复请求，不做持久缓存。

#### 3.2 最大并发数

用 `tokio::sync::Semaphore` 限制同时发出的 LCU GET 请求：

```rust
static LCU_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(10));
```

在 `lcu_get` 入口获取 permit，请求完成后自动释放。上限 10 个并发（LCU 是本地服务，10 已足够）。

### 修改文件

- `lol-record-analysis-tauri/src-tauri/src/lcu/util/http.rs` — `lcu_get` 函数
- `lol-record-analysis-tauri/src-tauri/Cargo.toml` — 如需新增依赖（dashmap 或调整 moka 用法）

---

## 4. MVP/SVP 计算

### 现状

`Game.mvp` 字段（`lcu/api/match_history.rs:37`）永远是空字符串。代码中有字段定义和前端显示逻辑，但计算逻辑缺失。

### 方案

在 `enrich_game_detail()` 完成后、返回 MatchHistory 之前，对每局计算 MVP/SVP：

```
KDA = (kills + assists) / max(deaths, 1)
```

算法：
1. 将 10 个参与者按队伍分为两组（participantId 1-5 vs 6-10）
2. 根据 `stats.win` 确定胜方和败方
3. 胜方 KDA 最高者 → `game.mvp = "MVP"`
4. 败方 KDA 最高者 → `game.mvp = "SVP"`
5. 只对第一个参与者（`participants[0]`，即当前查询的玩家）设置该字段

注意：`game.participants[0]` 是当前玩家，`game.gameDetail.participants[0..10]` 是全部玩家。MVP 判定需要遍历 `gameDetail.participants` 找到当前玩家所在队伍的最高 KDA。

### 修改文件

- `lol-record-analysis-tauri/src-tauri/src/command/match_history.rs` — 在 `calculate()` 函数或新增 `calculate_mvp()` 函数中实现
- `lol-record-analysis-tauri/src-tauri/src/lcu/api/match_history.rs` — 确认 `Game.mvp` 字段类型和 `GameDetail` 结构

---

## 不在范围内

- 前端性能优化
- WebSocket 通信改造
- 新功能添加
- UI 变更
