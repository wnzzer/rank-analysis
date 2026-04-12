# 性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 减少战绩加载延迟、消除冗余请求、修复 MVP 计算。

**Architecture:** 4 项独立优化：(1) 删除前端预加载 watch，(2) 后端单玩家内 3 个 API 调用并行化，(3) HTTP GET 层加 singleflight + semaphore，(4) 在 calculate() 中补全 MVP/SVP 计算。

**Tech Stack:** Rust + Tokio + moka (singleflight) + tokio::sync::Semaphore

**Design spec:** `docs/superpowers/specs/2026-04-12-performance-optimization-design.md`

---

## File Map

| 文件 | 操作 |
|------|------|
| `lol-record-analysis-tauri/src/components/SideNavigation.vue` | Modify — 删除预加载 watch |
| `lol-record-analysis-tauri/src-tauri/src/command/session.rs` | Modify — 单玩家内调用并发化 |
| `lol-record-analysis-tauri/src-tauri/src/lcu/util/http.rs` | Modify — 加 singleflight + semaphore |
| `lol-record-analysis-tauri/src-tauri/src/lcu/api/match_history.rs` | Modify — MVP/SVP 计算 |

**验证命令：**
```bash
cd lol-record-analysis-tauri/src-tauri && cargo check
```

---

## Task 1: 删除预加载 watch

**Files:**
- Modify: `lol-record-analysis-tauri/src/components/SideNavigation.vue`

- [ ] **Step 1: 删除预加载 watch 块**

在 `SideNavigation.vue` 的 `<script setup>` 中，找到以下代码块（在 `isInGame` computed 之后）并**整段删除**：

```typescript
/** phase 进入对局时预加载 session 数据，加快进入对局页的加载速度 */
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

- [ ] **Step 2: 清理不再需要的 import**

检查 `invoke` 是否在该文件其他地方还有使用。如果 `invoke` 只在被删除的 watch 中使用，则从 import 行中移除 `invoke`：

```typescript
// 如果不再需要，删除这行：
import { invoke } from '@tauri-apps/api/core'
```

注意：如果 `invoke` 在其他地方还有使用（检查搜索结果），则保留 import。

- [ ] **Step 3: typecheck 验证**

```bash
cd lol-record-analysis-tauri && npm run typecheck
```

期望：零错误。

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src/components/SideNavigation.vue
git commit -m "perf: 移除 SideNav 预加载 watch — 避免非必要 session 请求"
```

---

## Task 2: 单玩家内调用并发化

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/command/session.rs`

- [ ] **Step 1: 找到 `process_team_parallel` 中的单玩家串行逻辑**

在 `command/session.rs` 的 `process_team_parallel` 函数中，找到 `let futures = team.iter().enumerate().map(|(_index, player)| async move {` 开始的闭包。当前闭包内部是串行的 4 步：

```rust
// 当前：串行
let summoner = Summoner::get_summoner_by_puuid(...).await;
let match_history = MatchHistory::get_match_history_by_puuid(...).await;
let user_tag = get_user_tag_by_puuid(...).await;
let rank = Rank::get_rank_by_puuid(...).await;
```

- [ ] **Step 2: 将前三个独立调用改为 tokio::join! 并行**

将闭包内部从 `// 获取召唤师信息` 开始到 `// 获取段位信息` 结束的部分，替换为以下代码：

```rust
        // 获取配置
        let count = match crate::config::get_config("matchHistoryCount").await {
            Ok(crate::config::Value::Integer(v)) => v as i32,
            Ok(crate::config::Value::String(s)) => s.parse().unwrap_or(4),
            _ => 4,
        };

        let puuid = player.puuid.clone();

        // ── 第一组：summoner / match_history / rank 无依赖，并行执行 ──
        let (summoner, match_history, rank) = tokio::join!(
            async {
                match Summoner::get_summoner_by_puuid(&puuid).await {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!("Failed to get summoner for {}: {}", puuid, e);
                        Summoner::default()
                    }
                }
            },
            async {
                match MatchHistory::get_match_history_by_puuid(&puuid, 0, count - 1).await {
                    Ok(mut mh) => {
                        mh.enrich_info_cn().ok();
                        mh
                    }
                    Err(e) => {
                        log::warn!("Failed to get match history for {}: {}", puuid, e);
                        MatchHistory::default()
                    }
                }
            },
            async {
                match Rank::get_rank_by_puuid(&puuid).await {
                    Ok(mut r) => {
                        r.enrich_cn_info();
                        r
                    }
                    Err(e) => {
                        log::warn!("Failed to get rank for {}: {}", puuid, e);
                        Rank::default()
                    }
                }
            }
        );

        // ── 第二组：user_tag 依赖 match_history，串行 ──
        let user_tag =
            match crate::command::user_tag::get_user_tag_by_puuid(&puuid, mode).await {
                Ok(tag) => tag,
                Err(e) => {
                    log::warn!("Failed to get user tag for {}: {}", puuid, e);
                    UserTag {
                        recent_data: crate::command::user_tag::RecentData {
                            kda: 0.0,
                            kills: 0.0,
                            deaths: 0.0,
                            assists: 0.0,
                            select_mode: mode,
                            select_mode_cn: QUEUE_ID_TO_CN
                                .get(&(mode as u32))
                                .unwrap_or(&"未知模式")
                                .to_string(),
                            select_wins: 0,
                            select_losses: 0,
                            group_rate: 0,
                            average_gold: 0,
                            gold_rate: 0,
                            average_damage_dealt_to_champions: 0,
                            damage_dealt_to_champions_rate: 0,
                            friend_and_dispute: Default::default(),
                            one_game_players_map: None,
                        },
                        tag: Vec::new(),
                    }
                }
            };
```

注意：`config::get_config` 调用提前到 join 之前，因为它是轻量本地操作。

- [ ] **Step 3: cargo check 验证**

```bash
cd lol-record-analysis-tauri/src-tauri && cargo check
```

期望：零错误。

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/command/session.rs
git commit -m "perf: 单玩家内 summoner/match_history/rank 并行加载 (tokio::join!)"
```

---

## Task 3: Singleflight + 最大并发数

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/lcu/util/http.rs`

- [ ] **Step 1: 添加 Semaphore 和 singleflight 缓存的 static 声明**

在文件顶部的 `use` 和 `static` 声明区域（`static HTTP_CLIENT` 之后），添加：

```rust
use std::sync::LazyLock;
use tokio::sync::Semaphore;

/// 最大并发 LCU GET 请求数
static LCU_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(10));

/// Singleflight：相同 URI 的并发 GET 请求只发一次，其他等待者共享结果。
/// 使用 moka 缓存，TTL 100ms（只合并同一瞬间的重复请求，不做持久缓存）。
static SINGLEFLIGHT: LazyLock<moka::future::Cache<String, String>> = LazyLock::new(|| {
    moka::future::Cache::builder()
        .time_to_live(std::time::Duration::from_millis(100))
        .max_capacity(200)
        .build()
});
```

注意：`moka` 已在 `Cargo.toml` 中作为依赖（`features = ["future"]`），无需添加。

- [ ] **Step 2: 重写 `lcu_get` 函数，加入 singleflight + semaphore**

将现有 `lcu_get` 函数替换为：

```rust
/// 向 LCU 发起 GET 请求，将响应 JSON 反序列化为 `T`。
/// 内置 singleflight（相同 URI 并发请求合并）和并发限制（最多 10 个同时请求）。
pub async fn lcu_get<T: DeserializeOwned + 'static>(uri: &str) -> Result<T, String> {
    let uri_owned = uri.to_string();

    // singleflight：相同 URI 的并发请求只发一次
    let raw_json = SINGLEFLIGHT
        .try_get_with(uri_owned.clone(), async {
            // 获取 semaphore permit（限制并发数）
            let _permit = LCU_SEMAPHORE
                .acquire()
                .await
                .map_err(|e| format!("Semaphore error: {}", e))?;

            lcu_get_raw(&uri_owned).await
        })
        .await
        .map_err(|e| format!("{}", e))?;

    // 从缓存的 JSON 字符串反序列化（每个调用者可能需要不同的类型 T）
    serde_json::from_str::<T>(&raw_json).map_err(|e| format!("反序列化失败: {}", e))
}

/// 内部：发起真实 HTTP GET 请求，返回原始 JSON 字符串。
async fn lcu_get_raw(uri: &str) -> Result<String, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        log::debug!("LCU GET URL: {}", url);
        let resp = get_client().get(&url).send().await;
        match resp {
            Ok(r) if r.status() == StatusCode::OK => {
                let text = r
                    .text()
                    .await
                    .map_err(|e| format!("读取响应失败: {}", e))?;
                return Ok(text);
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("请求失败或认证失效".to_string())
}
```

关键变化：
1. `lcu_get` 不再直接发 HTTP 请求，而是通过 `SINGLEFLIGHT.try_get_with()` 去重
2. `lcu_get_raw` 是新的内部函数，返回 `String`（原始 JSON），因为 moka 缓存需要统一值类型
3. 反序列化移到 singleflight 之后（每个调用者自己反序列化，因为 T 可能不同）
4. `_permit` 在 singleflight 内部获取，保证限制的是真实请求数

- [ ] **Step 3: cargo check 验证**

```bash
cd lol-record-analysis-tauri/src-tauri && cargo check
```

期望：零错误。如果有 `Arc` 相关问题，检查 `moka::future::Cache` 的 `try_get_with` 签名——它要求闭包返回值实现 `Clone + Send + Sync`，`String` 满足这些约束。

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/lcu/util/http.rs
git commit -m "perf: lcu_get 加 singleflight (moka) + semaphore (tokio) — 去重+限流"
```

---

## Task 4: MVP/SVP 计算

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/lcu/api/match_history.rs`

- [ ] **Step 1: 在 `calculate()` 方法末尾添加 MVP 计算**

在 `match_history.rs` 的 `impl MatchHistory` 中 `calculate()` 方法最后（`Ok(())` 之前），添加 MVP 计算逻辑。

找到 `calculate()` 方法中 `for game in &mut self.games.games {` 循环的末尾（在 `my_stats.heal_rate = ...` 之后），添加：

```rust
            // ── MVP / SVP 计算 ──
            // 当前玩家是 participants[0]，判断其在胜方还是败方
            // 遍历 game_detail.participants 找到同队 KDA 最高者
            if !game.game_detail.participants.is_empty() {
                let my_team_id = game.participants[0].team_id;
                let my_win = game.participants[0].stats.win;

                // 找出当前玩家在 game_detail 中的 participant_id
                // participants[0] 对应 game_detail.participants 中 participant_id 相同的条目
                let my_participant_id = game.participants[0].participant_id;

                // 计算所有同队玩家的 KDA，找最高者
                let mut best_kda: f64 = -1.0;
                let mut best_participant_id: i32 = -1;

                for p in &game.game_detail.participants {
                    if p.team_id == my_team_id {
                        let deaths = if p.stats.deaths == 0 { 1 } else { p.stats.deaths };
                        let kda = (p.stats.kills as f64 + p.stats.assists as f64) / deaths as f64;
                        if kda > best_kda {
                            best_kda = kda;
                            best_participant_id = p.participant_id;
                        }
                    }
                }

                // 当前玩家是否是同队 KDA 最高者
                if best_participant_id == my_participant_id {
                    game.mvp = if my_win { "MVP".to_string() } else { "SVP".to_string() };
                }
            }
```

- [ ] **Step 2: 确认 `game_detail.participants` 中有 `participant_id` 和 `team_id`**

读取 `lol-record-analysis-tauri/src-tauri/src/lcu/api/game_detail.rs`，确认 `GameDetailParticipant` 结构体有以下字段：
- `participant_id: i32`
- `team_id: i32`
- `stats: ParticipantStats`（含 `kills`, `deaths`, `assists`, `win`）

如果字段名不同（比如驼峰 vs 蛇形），按实际字段名调整代码。

- [ ] **Step 3: 确认 `Participant` 结构体有 `participant_id`**

读取 `lol-record-analysis-tauri/src-tauri/src/lcu/api/model.rs`，确认 `Participant` 结构体有 `participant_id: i32` 字段。

- [ ] **Step 4: cargo check 验证**

```bash
cd lol-record-analysis-tauri/src-tauri && cargo check
```

期望：零错误。

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/lcu/api/match_history.rs
git commit -m "feat: MVP/SVP 计算 — 同队 KDA 最高者标记"
```

---

## Task 5: 最终验证

- [ ] **Step 1: cargo check 全项目**

```bash
cd lol-record-analysis-tauri/src-tauri && cargo check
```

- [ ] **Step 2: 前端 typecheck**

```bash
cd lol-record-analysis-tauri && npm run typecheck
```

- [ ] **Step 3: Commit（如有收尾修改）**

```bash
git add -A && git commit -m "perf: 性能优化完成 — 并发化/去预加载/singleflight/MVP"
```
