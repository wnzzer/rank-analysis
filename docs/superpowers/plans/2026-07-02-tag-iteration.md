# 标签体系迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-07-02-tag-iteration-design.md`：修复 CurrentChampion 断点、扩展规则引擎三原语两指标、新增六个语义默认标签与合并逻辑、手动备注接入 AI（带开关）、系统标签与备注的融合视图。

**Architecture:** 后端在 `user_tag_config.rs` 的条件树引擎上做最小扩展（`Recent` 前置切片、`DistinctChampions`/`Ratio` 统计、`damageShare`/`participation` 指标复用 `calculate()` 预计算）；前端镜像类型、扩展条件编辑器、在两条 AI 链路注入备注、新建 `UnifiedTagRow` 组件统一渲染。

**Tech Stack:** Rust (Tauri command 层) + Vue 3 / TypeScript / Pinia / naive-ui + vitest。

**⚠️ 平台约束（贯穿全程）：** 本机是 mac，`cargo test` / `cargo clippy` 因 `token.rs` 无条件依赖 winapi 而无法编译——**这与你的改动无关，不要试图修它**。Rust 任务的做法：测试代码与实现一起写（测试先写），本地只跑 `cargo fmt --check`，推送 PR 后由 Windows CI 执行 `cargo test`/clippy，红了再修。前端 vitest 正常本地跑。每个 PR 走 `.claude/skills/shipping-changes/SKILL.md` 流程（分支 → 门禁 → conventional commit → PR）。

**交付节奏：4 个 PR 按序合入**，PR1 是 PR2 的前置，PR3/PR4 相互独立但依赖 main 上已有代码。

---

## PR1 — `fix(user-tag): CurrentChampion 注入与引擎原语扩展`

分支：`fix/user-tag-engine-primitives`

### Task 1: evaluate 注入 current_champion

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/command/user_tag_config.rs:362-383`（`evaluate`）、`:415-423`（`EvalContext`）
- Modify: `lol-record-analysis-tauri/src-tauri/src/command/user_tag.rs:264-278`（`get_user_tag_by_puuid`）、`:241`（`get_user_tag_by_name`）
- Modify: `lol-record-analysis-tauri/src-tauri/src/command/session.rs:640`（调用处）
- Test: `user_tag_config.rs` 尾部 `#[cfg(test)] mod tests`

- [ ] **Step 1: 在 `user_tag_config.rs` 尾部新建测试模块与 fixture 帮助函数（后续所有引擎测试共用）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::match_history::{Game, GamesWrapper, MatchHistory};
    use crate::lcu::api::model::Participant;

    /// 构造一场对局：指定英雄、胜负、队列；其余字段取 Default。
    fn make_game(champion_id: i32, win: bool, queue_id: i32) -> Game {
        let mut p = Participant::default();
        p.champion_id = champion_id;
        p.team_id = 100;
        p.stats.win = win;
        Game {
            queue_id,
            participants: vec![p],
            ..Default::default()
        }
    }

    fn make_history(games: Vec<Game>) -> MatchHistory {
        MatchHistory {
            games: GamesWrapper { games },
            ..Default::default()
        }
    }

    #[test]
    fn current_champion_hits_when_injected() {
        let cfg = TagConfig {
            id: "t".into(),
            name: "本命".into(),
            desc: "".into(),
            good: true,
            enabled: true,
            is_default: false,
            condition: TagCondition::CurrentChampion { ids: vec![157] },
        };
        let history = make_history(vec![make_game(157, true, QUEUE_SOLO_5X5)]);
        assert!(cfg.evaluate(&history, 420, Some(157)).is_some());
        assert!(cfg.evaluate(&history, 420, Some(1)).is_none());
        assert!(cfg.evaluate(&history, 420, None).is_none());
    }
}
```

- [ ] **Step 2: 修改 `evaluate` 签名并注入（`user_tag_config.rs:362`）**

```rust
    pub fn evaluate(
        &self,
        match_history: &MatchHistory,
        current_mode: i32,
        current_champion: Option<i32>,
    ) -> Option<RankTag> {
        if !self.enabled {
            return None;
        }

        let context = EvalContext {
            history: match_history,
            current_mode,
            current_champion,
        };
        // ...其余不变
```

同时删掉 `EvalContext.current_champion` 上的 `#[allow(dead_code)]`（`:421`）。

- [ ] **Step 3: 更新所有 `evaluate` 调用方**

先 `grep -rn "\.evaluate(" lol-record-analysis-tauri/src-tauri/src` 确认全部调用点，再逐一更新：

`user_tag.rs`：`get_user_tag_by_puuid` 增加参数并透传：

```rust
#[tauri::command]
pub async fn get_user_tag_by_puuid(
    puuid: &str,
    mode: i32,
    champion_id: Option<i32>,
) -> Result<UserTag, String> {
    // ...
    if let Some(tag) = config.evaluate(&match_history, mode, champion_id) {
```

`get_user_tag_by_name`（`user_tag.rs:241`）改为 `get_user_tag_by_puuid(&summoner.puuid, mode, None).await`。

`session.rs:640` 改为：

```rust
let user_tag = crate::command::user_tag::get_user_tag_by_puuid(&puuid, mode, Some(player.champion_id))
```

注意：`session.rs` 闭包里 `player.champion_id` 需在 `puuid` clone 附近先取出（`let champion_id = player.champion_id;`），避免借用问题。

前端 `UserRecord.vue:234` 走的是 `get_user_tag_by_name`，无参数变化，不用改。Tauri 可选参数前端不传即为 `None`，其他 `invoke('get_user_tag_by_puuid')` 调用点（如有）用 `grep -rn "get_user_tag_by_puuid" lol-record-analysis-tauri/src` 确认，不传 `championId` 即可。

- [ ] **Step 4: 本地验证 + 提交**

```bash
cd lol-record-analysis-tauri/src-tauri && cargo fmt && cargo fmt --check
git add -u && git commit -m "fix(user-tag): evaluate 注入 current_champion，修复 CurrentChampion 条件恒 false"
```

### Task 2: Recent 窗口筛选器

**Files:**
- Modify: `user_tag_config.rs:161-181`（`MatchFilter`）、`:466-479`（`evaluate_history` 开头）、`:558-573`（`match_filter`）
- Test: 同文件 tests 模块

- [ ] **Step 1: 写测试**

```rust
    #[test]
    fn recent_filter_slices_newest_games_before_other_filters() {
        // 6 场：最新 3 场全胜，更早 3 场全败（列表最新在前）
        let games = vec![
            make_game(1, true, QUEUE_SOLO_5X5),
            make_game(2, true, QUEUE_SOLO_5X5),
            make_game(3, true, QUEUE_SOLO_5X5),
            make_game(4, false, QUEUE_SOLO_5X5),
            make_game(5, false, QUEUE_SOLO_5X5),
            make_game(6, false, QUEUE_SOLO_5X5),
        ];
        let history = make_history(games);
        let ctx = EvalContext { history: &history, current_mode: 420, current_champion: None };

        // 近 3 场平均胜率 1.0；全 6 场是 0.5
        let win_recent3 = ctx.evaluate_history(
            &[MatchFilter::Recent { count: 3 }],
            &MatchRefresh::Average { metric: "win".into(), op: Operator::Gte, value: 0.99 },
        );
        assert!(win_recent3);
        let win_all = ctx.evaluate_history(
            &[],
            &MatchRefresh::Average { metric: "win".into(), op: Operator::Gte, value: 0.99 },
        );
        assert!(!win_all);
        // count 超过总场次不 panic
        let over = ctx.evaluate_history(
            &[MatchFilter::Recent { count: 99 }],
            &MatchRefresh::Count { op: Operator::Eq, value: 6.0 },
        );
        assert!(over);
    }
```

- [ ] **Step 2: 实现**

`MatchFilter` 加变体（`:181` 前）：

```rust
    /// 只取最近 N 场（对局列表最新在前），在其他筛选器之前应用；
    /// 多个 Recent 取最小窗口
    Recent {
        /// 窗口场数
        count: i32,
    },
```

`evaluate_history` 开头（`:467` 之前）加前置切片：

```rust
        // Recent 是位置性筛选，逐场谓词拿不到位置信息，须先切片
        let recent_limit = filters
            .iter()
            .filter_map(|f| match f {
                MatchFilter::Recent { count } => Some((*count).max(0) as usize),
                _ => None,
            })
            .min();
        let all_games = &self.history.games.games;
        let base = match recent_limit {
            Some(n) => &all_games[..n.min(all_games.len())],
            None => &all_games[..],
        };
        let games_iter = base.iter().filter(|g| {
```

（原来是 `self.history.games.games.iter().filter(...)`，其余不变。）

`match_filter` 加分支（已在上游处理，逐场恒过）：

```rust
        MatchFilter::Recent { .. } => true,
```

- [ ] **Step 3: fmt + 提交**

```bash
cargo fmt && cargo fmt --check
git add -u && git commit -m "feat(user-tag): 引擎新增 Recent 窗口筛选器"
```

### Task 3: DistinctChampions 与 Ratio 统计

**Files:**
- Modify: `user_tag_config.rs:197-248`（`MatchRefresh`）、`:481-542`（`evaluate_history` match 分支）
- Test: 同文件 tests 模块

- [ ] **Step 1: 写测试**

```rust
    #[test]
    fn distinct_champions_counts_unique_ids() {
        let history = make_history(vec![
            make_game(1, true, QUEUE_SOLO_5X5),
            make_game(1, true, QUEUE_SOLO_5X5),
            make_game(2, true, QUEUE_SOLO_5X5),
        ]);
        let ctx = EvalContext { history: &history, current_mode: 420, current_champion: None };
        assert!(ctx.evaluate_history(
            &[],
            &MatchRefresh::DistinctChampions { op: Operator::Eq, value: 2.0 },
        ));
    }

    #[test]
    fn ratio_counts_matching_games_share() {
        // 4 场里 1 场 0 击杀 → kills < 1 的占比 0.25
        let mut g_feed = make_game(1, false, QUEUE_SOLO_5X5);
        g_feed.participants[0].stats.kills = 0;
        let mut normal = || {
            let mut g = make_game(2, true, QUEUE_SOLO_5X5);
            g.participants[0].stats.kills = 5;
            g
        };
        let history = make_history(vec![g_feed, normal(), normal(), normal()]);
        let ctx = EvalContext { history: &history, current_mode: 420, current_champion: None };
        assert!(ctx.evaluate_history(
            &[],
            &MatchRefresh::Ratio {
                metric: "kills".into(),
                game_op: Operator::Lt,
                game_value: 1.0,
                op: Operator::Gte,
                value: 0.25,
            },
        ));
        // 空历史返回 false
        let empty = make_history(vec![]);
        let ctx2 = EvalContext { history: &empty, current_mode: 420, current_champion: None };
        assert!(!ctx2.evaluate_history(
            &[],
            &MatchRefresh::Ratio {
                metric: "kills".into(),
                game_op: Operator::Lt,
                game_value: 1.0,
                op: Operator::Gte,
                value: 0.0,
            },
        ));
    }
```

- [ ] **Step 2: 实现**

`MatchRefresh` 加变体（`:248` 前）。**注意 `game_op`/`game_value` 需要显式 serde rename**——enum 级 `rename_all = "camelCase"` 只作用于变体名，不作用于字段名：

```rust
    /// 筛选后对局中不同英雄数量与阈值比较
    DistinctChampions {
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 「满足逐场条件的场次占比」与阈值比较：
    /// ratio = count(metric <game_op> game_value 的场次) / count(筛选后场次)
    Ratio {
        /// 逐场统计指标名称
        metric: String,
        /// 逐场比较运算符
        #[serde(rename = "gameOp")]
        game_op: Operator,
        /// 逐场比较值
        #[serde(rename = "gameValue")]
        game_value: f64,
        /// 占比比较运算符
        op: Operator,
        /// 占比比较值
        value: f64,
    },
```

`evaluate_history` 的 match 加两个分支（`Streak` 分支后）：

```rust
            MatchRefresh::DistinctChampions { op, value } => {
                let distinct: std::collections::HashSet<i32> = games
                    .iter()
                    .filter_map(|g| g.participants.first().map(|p| p.champion_id))
                    .collect();
                op.check(distinct.len() as f64, *value)
            }
            MatchRefresh::Ratio { metric, game_op, game_value, op, value } => {
                if games.is_empty() {
                    return false;
                }
                let hits = games
                    .iter()
                    .filter(|g| game_op.check(extract_game_metric(g, metric), *game_value))
                    .count();
                op.check(hits as f64 / games.len() as f64, *value)
            }
```

- [ ] **Step 3: fmt + 提交**

```bash
cargo fmt && cargo fmt --check
git add -u && git commit -m "feat(user-tag): 引擎新增 DistinctChampions 与 Ratio 统计原语"
```

### Task 4: damageShare / participation 指标

**Files:**
- Modify: `user_tag_config.rs:594-620`（`extract_game_metric`）
- Modify: `user_tag.rs:268`（enrich 后补 `calculate()`）
- Test: 同文件 tests 模块

- [ ] **Step 1: 写测试**

```rust
    #[test]
    fn damage_share_reads_precomputed_rate_and_nan_when_no_detail() {
        let mut g = make_game(1, true, QUEUE_SOLO_5X5);
        g.participants[0].stats.damage_dealt_to_champions_rate = 30;
        // game_detail 为空 → NAN，任何 op.check 均为 false（不误伤）
        assert!(extract_game_metric(&g, "damageShare").is_nan());
        // 有 detail 时读预计算占比（0-100 → 0.0-1.0）
        g.game_detail.participants = vec![Default::default()];
        assert!((extract_game_metric(&g, "damageShare") - 0.30).abs() < 1e-9);
    }

    #[test]
    fn participation_is_ka_over_team_kills() {
        let mut g = make_game(1, true, QUEUE_SOLO_5X5);
        g.participants[0].stats.kills = 3;
        g.participants[0].stats.assists = 5;
        let mut ally = crate::lcu::api::game_detail::GameDetailParticipant::default();
        ally.team_id = 100;
        ally.stats.kills = 13; // 全队 13+3? —— 以 game_detail 为准：detail 里包含本人
        let mut me = crate::lcu::api::game_detail::GameDetailParticipant::default();
        me.team_id = 100;
        me.stats.kills = 3;
        let mut enemy = crate::lcu::api::game_detail::GameDetailParticipant::default();
        enemy.team_id = 200;
        enemy.stats.kills = 50;
        g.game_detail.participants = vec![ally, me, enemy];
        // (3+5) / (13+3) = 0.5
        assert!((extract_game_metric(&g, "participation") - 0.5).abs() < 1e-9);
        // 全队 0 击杀 → 0.0 不 panic
        let mut g2 = make_game(1, true, QUEUE_SOLO_5X5);
        g2.game_detail.participants = vec![Default::default()];
        assert_eq!(extract_game_metric(&g2, "participation"), 0.0);
    }
```

> 注：`game_detail.rs` 里 detail 参与者结构体的实际名字以代码为准（`grep -n "pub struct" game_detail.rs`），测试里按真实类型名替换 `GameDetailParticipant`；其 `stats` 字段与 `model.rs` 的 `ParticipantStats` 同构（有 `kills`、`team_id` 在外层）。

- [ ] **Step 2: 实现 `extract_game_metric` 两个新分支（`"gameDuration"` 分支后）**

```rust
        // 伤害占比：calculate() 预计算的 0-100 整数；detail 缺失时返回 NAN，
        // 使任何 Operator::check 都为 false，避免把数据缺失误判成"低伤害"
        "damageShare" => {
            if game.game_detail.participants.is_empty() {
                return f64::NAN;
            }
            stats.damage_dealt_to_champions_rate as f64 / 100.0
        }
        // 参团率：(K+A) / 本方全队击杀（含本人，取自 game_detail）
        "participation" => {
            if game.game_detail.participants.is_empty() {
                return f64::NAN;
            }
            let team_id = game.participants[0].team_id;
            let team_kills: i32 = game
                .game_detail
                .participants
                .iter()
                .filter(|p| p.team_id == team_id)
                .map(|p| p.stats.kills)
                .sum();
            if team_kills == 0 {
                0.0
            } else {
                (stats.kills + stats.assists) as f64 / team_kills as f64
            }
        }
```

同时把函数的文档注释补上两个新指标说明（`:582-593` 的支持指标列表）。

- [ ] **Step 3: user_tag 流程补 `calculate()`（否则 rate 恒 0）**

`user_tag.rs:268` `enrich_game_detail` 之后：

```rust
    match_history.enrich_game_detail().await?;
    match_history.calculate()?; // damageShare 依赖预计算的伤害占比
```

- [ ] **Step 4: fmt + 提交 + 发 PR**

```bash
cargo fmt && cargo fmt --check
git add -u && git commit -m "feat(user-tag): 新增 damageShare/participation 指标"
git push -u origin HEAD
gh pr create --title "fix(user-tag): CurrentChampion 注入与引擎原语扩展" --body "..."
```

PR body 按 shipping-changes 模板写；**等 Windows CI 绿（含 cargo test）再合**，红了根据 CI 日志修。

---

## PR2 — `feat(user-tag): 语义默认标签 + 老用户合并 + 编辑器支持`

分支：`feat/semantic-default-tags`（基于 PR1 合入后的 main）

### Task 5: 六个语义默认标签

**Files:**
- Modify: `user_tag_config.rs:695+`（`get_default_tags` 的 vec 尾部追加）
- Test: 同文件 tests 模块

- [ ] **Step 1: 写测试（规则语义级，不逐字段断言）**

```rust
    #[test]
    fn default_smurf_fires_on_high_winrate_high_kda() {
        // 12 场排位全胜、KDA 高 → 命中「炸鱼嫌疑」
        let games: Vec<Game> = (0..12)
            .map(|_| {
                let mut g = make_game(1, true, QUEUE_SOLO_5X5);
                g.participants[0].stats.kills = 10;
                g.participants[0].stats.assists = 5;
                g.participants[0].stats.deaths = 2;
                g
            })
            .collect();
        let history = make_history(games);
        let smurf = get_default_tags().into_iter().find(|t| t.id == "default_smurf").unwrap();
        assert!(smurf.evaluate(&history, 420, None).is_some());
        // 6 场样本不足 → 不命中
        let few = make_history((0..6).map(|_| make_game(1, true, QUEUE_SOLO_5X5)).collect());
        assert!(smurf.evaluate(&few, 420, None).is_none());
    }
```

（同样地为 `default_champion_pool_wide` / `default_hot_streak_form` / `default_int_risk` 各写一个正例 + 一个反例测试，构造方式同上，用 `make_game` 微调字段。）

- [ ] **Step 2: 追加默认标签定义（完整代码，追加到 `get_default_tags` 的 vec 尾部）**

```rust
        // --- 语义类默认标签（2026-07 迭代新增）---
        TagConfig {
            id: "default_smurf".to_string(),
            name: "炸鱼嫌疑".to_string(),
            desc: "近期排位胜率与 KDA 异常偏高，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count { op: Operator::Gte, value: 10.0 },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.75,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "kda".to_string(),
                            op: Operator::Gte,
                            value: 5.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_champion_pool_wide".to_string(),
            name: "英雄海".to_string(),
            desc: "近 20 场使用了 12 个以上英雄".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Recent { count: 20 }],
                refresh: MatchRefresh::DistinctChampions { op: Operator::Gte, value: 12.0 },
            },
        },
        TagConfig {
            id: "default_champion_pool_narrow".to_string(),
            name: "专精".to_string(),
            desc: "近 20 场只玩 3 个以内英雄".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::DistinctChampions {
                            op: Operator::Lte,
                            value: 3.0,
                        },
                    },
                    TagCondition::History {
                        filters: vec![MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count { op: Operator::Gte, value: 10.0 },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_hot_streak_form".to_string(),
            name: "手热".to_string(),
            desc: "近 10 场排位胜率显著高于近 20 场，状态上升".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 10 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.7,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Lte,
                            value: 0.55,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count { op: Operator::Gte, value: 15.0 },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_cold_form".to_string(),
            name: "低谷".to_string(),
            desc: "近 10 场排位胜率显著低于近 20 场，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 10 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Lte,
                            value: 0.3,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.45,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count { op: Operator::Gte, value: 15.0 },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_int_risk".to_string(),
            name: "挂机送头风险".to_string(),
            desc: "近 20 场中伤害占比极低的场次偏多，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Recent { count: 20 }],
                refresh: MatchRefresh::Ratio {
                    metric: "damageShare".to_string(),
                    game_op: Operator::Lt,
                    game_value: 0.08,
                    op: Operator::Gte,
                    value: 0.2,
                },
            },
        },
```

- [ ] **Step 3: fmt + 提交**

```bash
cargo fmt && cargo fmt --check
git add -u && git commit -m "feat(user-tag): 新增六个语义类默认标签"
```

### Task 6: load_config 合并缺失默认标签

**Files:**
- Modify: `user_tag_config.rs:826-835`（`load_config`）
- Test: 同文件 tests 模块（合并逻辑抽成纯函数便于测试）

- [ ] **Step 1: 写测试**

```rust
    #[test]
    fn merge_appends_missing_defaults_without_touching_user_edits() {
        let mut mine = get_default_tags();
        mine.truncate(2); // 模拟老用户只有旧的两个默认标签
        mine[0].enabled = false; // 用户禁用过
        mine[0].name = "我改过名".to_string();
        let merged = merge_missing_defaults(mine);
        // 新默认标签补齐
        assert!(merged.iter().any(|t| t.id == "default_smurf"));
        // 用户的修改原样保留
        let first = merged.iter().find(|t| t.id == get_default_tags()[0].id).unwrap();
        assert!(!first.enabled);
        assert_eq!(first.name, "我改过名");
        // 幂等：再 merge 不再增长
        let len = merged.len();
        assert_eq!(merge_missing_defaults(merged).len(), len);
    }
```

- [ ] **Step 2: 实现**

```rust
/// 将 get_default_tags 中用户配置里缺失的默认标签追加进来。
///
/// 只补"id 不存在"的项；用户对已有标签的任何修改（禁用/改名/调阈值）不被覆盖。
/// is_default 标签 UI 上不可删除，因此无需删除墓碑机制。
fn merge_missing_defaults(mut tags: Vec<TagConfig>) -> Vec<TagConfig> {
    let existing: std::collections::HashSet<String> =
        tags.iter().map(|t| t.id.clone()).collect();
    tags.extend(
        get_default_tags()
            .into_iter()
            .filter(|d| !existing.contains(&d.id)),
    );
    tags
}

pub async fn load_config() -> Vec<TagConfig> {
    match config::get_config("userTags").await {
        Ok(val) => {
            let tags = config_value_to_tags(val);
            let before = tags.len();
            let merged = merge_missing_defaults(tags);
            if merged.len() != before {
                let _ = save_tag_configs(merged.clone()).await;
            }
            merged
        }
        Err(_) => {
            let defaults = get_default_tags();
            let _ = save_tag_configs(defaults.clone()).await;
            defaults
        }
    }
}
```

- [ ] **Step 3: fmt + 提交**

```bash
cargo fmt && cargo fmt --check
git add -u && git commit -m "feat(user-tag): load_config 自动补齐新增默认标签（不覆盖用户修改）"
```

### Task 7: 前端类型镜像 + 条件编辑器支持新原语

**Files:**
- Modify: `lol-record-analysis-tauri/src/types/tagSuggest.ts:11-22`
- Modify: `lol-record-analysis-tauri/src/views/settings/TagConditionNode.vue`（模板分支 + `:293-327` 的 options）
- Test: `lol-record-analysis-tauri/src/types/__tests__/tagSuggest.spec.ts`（新建）

- [ ] **Step 1: 写序列化一致性测试（新建 spec 文件）**

```typescript
import { describe, it, expect } from 'vitest'
import type { MatchFilter, MatchRefresh } from '../tagSuggest'

describe('tagSuggest 类型与 Rust serde 序列化一致', () => {
  it('recent filter 使用 count 字段', () => {
    const f: MatchFilter = { type: 'recent', count: 20 }
    expect(JSON.parse(JSON.stringify(f))).toEqual({ type: 'recent', count: 20 })
  })
  it('ratio refresh 使用 gameOp/gameValue 命名（对应 Rust serde rename）', () => {
    const r: MatchRefresh = {
      type: 'ratio',
      metric: 'damageShare',
      gameOp: '<',
      gameValue: 0.08,
      op: '>=',
      value: 0.2
    }
    expect(Object.keys(r).sort()).toEqual(
      ['gameOp', 'gameValue', 'metric', 'op', 'type', 'value'].sort()
    )
  })
})
```

- [ ] **Step 2: 跑测试确认类型错误（红）**

```bash
cd lol-record-analysis-tauri && npx vitest run src/types/__tests__/tagSuggest.spec.ts
```

Expected: 编译失败（`'recent'` 不在 `MatchFilter` 联合类型里）。

- [ ] **Step 3: 扩展类型（tagSuggest.ts）**

```typescript
export type MatchFilter =
  | { type: 'queue'; ids: number[] }
  | { type: 'champion'; ids: number[] }
  | { type: 'stat'; metric: string; op: Operator; value: number }
  | { type: 'recent'; count: number }

export type MatchRefresh =
  | { type: 'count'; op: Operator; value: number }
  | { type: 'average'; metric: string; op: Operator; value: number }
  | { type: 'sum'; metric: string; op: Operator; value: number }
  | { type: 'max'; metric: string; op: Operator; value: number }
  | { type: 'min'; metric: string; op: Operator; value: number }
  | { type: 'streak'; min: number; kind: StreakType }
  | { type: 'distinctChampions'; op: Operator; value: number }
  | {
      type: 'ratio'
      metric: string
      gameOp: Operator
      gameValue: number
      op: Operator
      value: number
    }
```

- [ ] **Step 4: 跑测试确认通过（绿）**

```bash
npx vitest run src/types/__tests__/tagSuggest.spec.ts
```

- [ ] **Step 5: TagConditionNode.vue 支持新原语**

options 增补（`:293-327`）：

```typescript
const filterTypeOptions = [
  { label: '模式', value: 'queue' },
  { label: '英雄', value: 'champion' },
  { label: '单场数据', value: 'stat' },
  { label: '最近 N 场', value: 'recent' }
]

const metricOptions = [
  // ...原有 10 项不动，追加：
  { label: '伤害占比 (0-1)', value: 'damageShare' },
  { label: '参团率 (0-1)', value: 'participation' }
]

const refreshTypeOptions = [
  // ...原有 6 项不动，追加：
  { label: '英雄数量', value: 'distinctChampions' },
  { label: '场次占比', value: 'ratio' }
]
```

模板分支：参照现有 `stat` filter 分支（`:80-120` 一带）加 `recent` 的 `n-input-number`（绑 `filter.count`，min 1 max 50）；参照 `average` refresh 分支加 `distinctChampions`（op + value）与 `ratio`（metric 下拉 + gameOp + gameValue + op + value 五控件）。切换类型时的默认值工厂（`:336`/`:364` 一带的 `type: 'history'` 初始化处）为新类型给初值：`{ type: 'recent', count: 20 }`、`{ type: 'distinctChampions', op: '>=', value: 12 }`、`{ type: 'ratio', metric: 'damageShare', gameOp: '<', gameValue: 0.08, op: '>=', value: 0.2 }`。

- [ ] **Step 6: 全量门禁 + 提交 + 发 PR**

```bash
cd lol-record-analysis-tauri
npx prettier --write src/ && npx eslint src/ && npx vue-tsc --noEmit
npm run test
git add -u && git commit -m "feat(tags): 条件编辑器与类型支持 Recent/DistinctChampions/Ratio"
git push -u origin HEAD
gh pr create --title "feat(user-tag): 语义默认标签 + 老用户合并 + 编辑器支持" --body "..."
```

手动验证（`npm run tauri dev`，可选但建议）：`/Settings/Tags` 里新默认标签出现、可编辑新原语、保存后重进不丢。

---

## PR3 — `feat(ai): 手动备注接入 AI 分析（带开关）`

分支：`feat/ai-player-notes`

### Task 8: 配置键 + 设置页开关

**Files:**
- Modify: `lol-record-analysis-tauri/src/services/configKeys.ts`
- Modify: `lol-record-analysis-tauri/src/views/settings/General.vue`

- [ ] **Step 1: configKeys.ts 加键**

```typescript
export const CONFIG_KEYS = {
  errorReportingEnabled: 'errorReportingEnabled',
  errorReportingConsentShown: 'errorReportingConsentShown',
  dashscopeApiKey: 'dashscopeApiKey',
  /** 玩家备注是否随 AI 分析请求发送到云端模型（默认开） */
  aiUsePlayerNotes: 'aiUsePlayerNotes'
} as const
```

- [ ] **Step 2: General.vue 加开关**

在「自定义 AI Key」区块（`:20` 一带）后加一项，交互照抄 `matchCount` 的读写模式（`:49-57` 读、`:77-84` 写）：

```vue
<n-switch v-model:value="aiUseNotes" @update:value="onAiUseNotesChange" />
```

```typescript
const aiUseNotes = ref(true)
onMounted(async () => {
  const v = await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)
  if (typeof v === 'boolean') aiUseNotes.value = v
})
async function onAiUseNotesChange(value: boolean) {
  await putConfigByIpc(CONFIG_KEYS.aiUsePlayerNotes, value)
  message.success('设置已保存')
}
```

文案（开关旁说明文字）：「AI 分析时携带你的玩家备注 — 开启后备注内容会随分析请求发送到 AI 服务」。

- [ ] **Step 3: 提交**

```bash
git add -u && git commit -m "feat(settings): AI 分析携带玩家备注的开关（默认开）"
```

### Task 9: noteBrief 工具 + 两条链路注入

**Files:**
- Create: `lol-record-analysis-tauri/src/services/ai/shared/noteBrief.ts`
- Modify: `lol-record-analysis-tauri/src/services/ai/player-insight.ts:91-131`（`extractPlayerInsight`）
- Modify: `lol-record-analysis-tauri/src/services/ai/index.ts`（读取开关并传入）
- Modify: `lol-record-analysis-tauri/src/services/ai/shared/types.ts:19+`（`RecentPlayerProfile` 加 `note?`）
- Modify: `lol-record-analysis-tauri/src/services/ai/shared/recentProfile.batch.ts`（组装时注入）
- Modify: `lol-record-analysis-tauri/src/services/ai/matchDetail/prompts/stage1-attribution.ts:38` 一带（字段说明）
- Test: `lol-record-analysis-tauri/src/services/ai/shared/__tests__/noteBrief.spec.ts`（新建）

- [ ] **Step 1: 写 noteBrief 测试（红）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildNoteBrief } from '../noteBrief'
import { usePlayerNotesStore } from '../../../../pinia/playerNotes'

describe('buildNoteBrief', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('无备注返回 undefined', () => {
    expect(buildNoteBrief('nobody')).toBeUndefined()
  })

  it('有备注返回 [色档] 文本，超 50 字截断', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', {
      note: 'x'.repeat(80),
      label: 'blacklist',
      gameName: 'A',
      tagLine: '1'
    })
    const brief = buildNoteBrief('p1')
    expect(brief).toContain('[拉黑]')
    expect(brief!.length).toBeLessThanOrEqual('[拉黑] '.length + 50)
  })

  it('只标色档不写字时仅返回 [色档]', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p2', { note: '', label: 'friendly', gameName: 'B', tagLine: '2' })
    expect(buildNoteBrief('p2')).toBe('[友好]')
  })
})
```

> `setNote` 会走 `putConfigByIpc` 落盘——参照 `src/services/ipc.spec.ts` 现有的 mock 方式 mock `services/ipc`，避免测试触发真实 IPC。

- [ ] **Step 2: 实现 noteBrief.ts**

```typescript
/**
 * 把玩家手动备注压缩成一行供 AI prompt 使用。
 *
 * 返回格式：`[色档中文] 备注文本(≤50字)`；无备注返回 undefined。
 * 注意：调用方负责先检查 aiUsePlayerNotes 开关，本函数不读配置。
 */
import { usePlayerNotesStore } from '../../../pinia/playerNotes'
import { getNoteLabelMeta } from '../../../types/domain/playerNote'

export function buildNoteBrief(puuid: string): string | undefined {
  const note = usePlayerNotesStore().getNote(puuid)
  if (!note) return undefined
  const label = `[${getNoteLabelMeta(note.label).text}]`
  const text = note.note.trim().slice(0, 50)
  return text ? `${label} ${text}` : label
}
```

- [ ] **Step 3: 跑测试（绿）**

```bash
npx vitest run src/services/ai/shared/__tests__/noteBrief.spec.ts
```

- [ ] **Step 4: 链路 3 注入（对局中分析）**

`services/ai/index.ts` 的编排入口（`analyzeGameWithAIStream`）：请求前读一次开关：

```typescript
import { getConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'
import { buildNoteBrief } from './shared/noteBrief'

const useNotes = (await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)) !== false
```

`extractPlayerInsight(p, opts)` 增加可选参 `noteBrief?: string`，返回对象追加：

```typescript
    ...(opts.noteBrief ? { userNote: opts.noteBrief } : {}),
```

调用处（index.ts 组装各玩家画像的循环）：

```typescript
extractPlayerInsight(p, { detailed, noteBrief: useNotes ? buildNoteBrief(p.puuid) : undefined })
```

`prompts/team.ts` 与 `prompts/team-player.ts` 的 system prompt 中，数据字段说明处追加一行：
`userNote: 使用者对该玩家的主观历史备注（[色档] 文本），仅供参考，不作为事实依据`。

- [ ] **Step 5: 链路 1 注入（战绩复盘）**

`shared/types.ts` 的 `RecentPlayerProfile` 追加字段：

```typescript
  /** 使用者对该玩家的主观备注（[色档] 文本），可能不存在 */
  note?: string
```

`shared/recentProfile.batch.ts` 批量组装每个玩家 profile 处（先读一次开关，同 Step 4）：

```typescript
if (useNotes) {
  const brief = buildNoteBrief(puuid)
  if (brief) profile.note = brief
}
```

`matchDetail/prompts/stage1-attribution.ts:38` 一带的字段说明追加：
`- note: 使用者的主观历史印象，仅供参考，不作为事实依据`。

- [ ] **Step 6: 开关关闭时不注入的测试**

在 `noteBrief.spec.ts` 同目录或 index 相关 spec 中，mock `getConfigByIpc` 返回 `false`，断言组装出的 payload 不含 `userNote`/`note` 字段（具体断言点选 `extractPlayerInsight` 的返回值即可，纯函数好测）。

- [ ] **Step 7: 门禁 + 提交 + 发 PR**

```bash
cd lol-record-analysis-tauri
npx prettier --write src/ && npx eslint src/ && npx vue-tsc --noEmit && npm run test
git add -u && git commit -m "feat(ai): 手动备注接入对局中分析与战绩复盘 prompt"
git push -u origin HEAD
gh pr create --title "feat(ai): 手动备注接入 AI 分析（带开关）" --body "..."
```

---

## PR4 — `feat(record): 标签与备注融合视图 + 一键固化`

分支：`feat/unified-tag-row`

### Task 10: UnifiedTagRow 组件

**Files:**
- Create: `lol-record-analysis-tauri/src/components/common/UnifiedTagRow.vue`
- Test: `lol-record-analysis-tauri/src/components/common/__tests__/UnifiedTagRow.spec.ts`（新建）

- [ ] **Step 1: 写组件测试（红）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import UnifiedTagRow from '../UnifiedTagRow.vue'
import { usePlayerNotesStore } from '../../../pinia/playerNotes'

const tags = [
  { tagName: '炸鱼嫌疑', tagDesc: '仅供参考', good: false },
  { tagName: '英雄海', tagDesc: '', good: true }
]

describe('UnifiedTagRow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('渲染系统标签 chips', () => {
    const w = mount(UnifiedTagRow, {
      props: { tags, puuid: 'p1', gameName: 'A', tagLine: '1' }
    })
    expect(w.text()).toContain('炸鱼嫌疑')
    expect(w.text()).toContain('英雄海')
  })

  it('有备注时渲染备注 chip（带来源图标）', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', { note: '上把挂机', label: 'blacklist', gameName: 'A', tagLine: '1' })
    const w = mount(UnifiedTagRow, {
      props: { tags: [], puuid: 'p1', gameName: 'A', tagLine: '1' }
    })
    expect(w.text()).toContain('上把挂机')
    expect(w.find('[data-test="note-chip"]').exists()).toBe(true)
  })

  it('固化系统标签时 setNote 参数正确（good→friendly，追加不覆盖）', async () => {
    const store = usePlayerNotesStore()
    const w = mount(UnifiedTagRow, {
      props: { tags, puuid: 'p2', gameName: 'B', tagLine: '2' }
    })
    await (w.vm as any).solidifyTag(tags[1]) // 英雄海, good
    expect(store.getNote('p2')?.label).toBe('friendly')
    expect(store.getNote('p2')?.note).toContain('英雄海')
    await (w.vm as any).solidifyTag(tags[0]) // 炸鱼嫌疑, bad —— 追加，保留原色档
    expect(store.getNote('p2')?.label).toBe('friendly')
    expect(store.getNote('p2')?.note).toContain('上一行')
  })
})
```

> naive-ui 组件挂载需要全局 stub 或引入 `naive-ui` 测试插件——参照仓库现有组件 spec 的写法（`src/components/tags/__tests__/` 下有先例）；`setNote` 落盘同样 mock `services/ipc`。最后一个断言"追加不覆盖"验证 note 里同时含两个标签名（以换行分隔）。

- [ ] **Step 2: 实现组件**

```vue
<!--
  UnifiedTagRow —— 系统标签与手动备注的统一标签行

  系统标签：n-tag（good→success / bad→error），hover 出 tooltip 显示 desc，
  点击弹 popover 可「存为备注」（一键固化，见 issue #67 讨论）。
  备注 chip：色档语义色 + ✎ 图标区分来源，hover 显示完整备注。
-->
<template>
  <div class="unified-tag-row">
    <n-popover v-if="note" trigger="hover">
      <template #trigger>
        <n-tag
          data-test="note-chip"
          size="small"
          round
          :type="noteMeta.naiveType"
        >
          ✎ {{ note.note ? truncated(note.note) : noteMeta.text }}
        </n-tag>
      </template>
      <span>[{{ noteMeta.text }}] {{ note.note || '（未填写文字）' }}</span>
    </n-popover>

    <n-popover v-for="tag in tags" :key="tag.tagName" trigger="click">
      <template #trigger>
        <n-tooltip>
          <template #trigger>
            <n-tag size="small" :type="tag.good ? 'success' : 'error'" :bordered="false">
              {{ tag.tagName }}
            </n-tag>
          </template>
          <span>{{ tag.tagDesc }}</span>
        </n-tooltip>
      </template>
      <div class="solidify-pop">
        <div>把「{{ tag.tagName }}」存为对该玩家的备注？</div>
        <n-button size="tiny" type="primary" @click="solidifyTag(tag)">存为备注</n-button>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTag, NPopover, NTooltip, NButton } from 'naive-ui'
import { usePlayerNotesStore } from '../../pinia/playerNotes'
import { getNoteLabelMeta } from '../../types/domain/playerNote'
import type { RankTag } from '../../types' // 以实际 RankTag 类型导出位置为准（grep "tagName" src/types）

const props = defineProps<{
  tags: RankTag[]
  puuid: string
  gameName: string
  tagLine: string
}>()

const store = usePlayerNotesStore()
const note = computed(() => store.getNote(props.puuid))
const noteMeta = computed(() => getNoteLabelMeta(note.value?.label ?? 'normal'))

function truncated(s: string): string {
  return s.length > 8 ? s.slice(0, 8) + '…' : s
}

/** 一键固化：系统标签 → 手动备注。已有备注则文本追加（换行分隔）、色档保留。 */
async function solidifyTag(tag: RankTag) {
  const existing = store.getNote(props.puuid)
  const line = `${tag.tagName}${tag.tagDesc ? `：${tag.tagDesc}` : ''}`
  await store.setNote(props.puuid, {
    note: existing?.note ? `${existing.note}\n${line}` : line,
    label: existing?.label ?? (tag.good ? 'friendly' : 'careful'),
    gameName: props.gameName,
    tagLine: props.tagLine
  })
}

defineExpose({ solidifyTag })
</script>

<style scoped>
.unified-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.solidify-pop {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
```

- [ ] **Step 3: 跑测试（绿）**

```bash
npx vitest run src/components/common/__tests__/UnifiedTagRow.spec.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/components/common/UnifiedTagRow.vue src/components/common/__tests__/UnifiedTagRow.spec.ts
git commit -m "feat(record): UnifiedTagRow 统一标签行组件（渲染 + 一键固化）"
```

### Task 11: 三处替换接入

**Files:**
- Modify: `lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue:134-160`（`profile-tags` 区块）
- Modify: `lol-record-analysis-tauri/src/components/record/UserRecord.vue`（标签展示区，`grep -n "userTag" 定位`）
- Modify: `lol-record-analysis-tauri/src/components/record/MatchDetailModal.vue`（同上）

- [ ] **Step 1: PlayerCard.vue 替换**

`:149-158` 现有的 `v-for="tag in sessionSummoner?.userTag.tag"` + n-tooltip + n-tag 段落整体替换为：

```vue
<UnifiedTagRow
  :tags="sessionSummoner?.userTag?.tag || []"
  :puuid="sessionSummoner.summoner.puuid"
  :game-name="sessionSummoner.summoner.gameName"
  :tag-line="sessionSummoner.summoner.tagLine"
/>
```

保留 `:134-148` 的其它 profile-tags 内容（预组队/遇见过 chips）不动。原 `:84-88` 的 `PlayerNoteBadge`（打备注入口 popover）**保留**——它是"写"入口，UnifiedTagRow 是"读+固化"入口，职责不同。

- [ ] **Step 2: UserRecord.vue 与 MatchDetailModal.vue 同样替换**

两处均 `grep -n "userTag\|RankTag\|tag in" <file>` 定位标签渲染段，替换为 `UnifiedTagRow`，props 从各自上下文取（UserRecord 有当前查询玩家的 summoner 对象；MatchDetailModal 的玩家行有 puuid/gameName/tagLine）。若 MatchDetailModal 里拿不到完整 gameName/tagLine（仅 puuid），传空字符串——`setNote` 的 gameName/tagLine 仅用于设置页列表展示，空值可接受。

- [ ] **Step 3: 门禁 + 手动验证 + 提交 + 发 PR**

```bash
cd lol-record-analysis-tauri
npx prettier --write src/ && npx eslint src/ && npx vue-tsc --noEmit && npm run test
npm run tauri dev   # 手动：对局中/战绩页/对局详情三处标签行正常、点标签可固化、备注 chip 出现
git add -u && git commit -m "feat(record): PlayerCard/UserRecord/MatchDetailModal 接入统一标签行"
git push -u origin HEAD
gh pr create --title "feat(record): 标签与备注融合视图 + 一键固化" --body "..."
```

---

## Self-review 结论（已执行）

- **Spec 覆盖**：子项 1→Task 1；子项 2→Task 2/3/4/7；子项 3→Task 5；子项 4→Task 6；子项 5→Task 8/9；子项 6→Task 10/11。无缺口。
- **类型一致性**：`evaluate(&history, mode, champion)` 三参签名在 Task 1/5 一致；`gameOp`/`gameValue` serde rename 与 TS 类型、编辑器初值三处一致；`buildNoteBrief` 签名在 Task 9 内一致。
- **已知不确定点（执行时按注释处理）**：game_detail 参与者结构体的真实类型名（Task 4 测试）、`RankTag` 的 TS 导出位置（Task 10）、naive-ui 组件测试的挂载方式（参照仓库既有 spec）。这些均给了 grep 定位指令，不是占位符。
