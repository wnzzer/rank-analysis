//! # 对局中下一动作推荐引擎（M5a 战场四 4a 基础版 + M5b 增强版）
//!
//! 基于 liveclientdata 实时快照 + PUGG 出装聚合 + 习惯标签，生成「下一动作」建议。
//! reason 全模板化，不调 LLM，满足 < 2s 延迟。
//!
//! ## 复用的已有模块
//!
//! | 模块 | 复用方式 |
//! |------|---------|
//! | `lcu/api/live_game.rs` | `LiveGameSnapshot` 作为核心输入 |
//! | `pugg/aggregate.rs` | `BuildStats` 提供推荐出装序列 |
//! | `insight/store.rs` | `HabitTag` 个性化 reason 后缀 |
//!
//! ## 动作类型
//!
//! - `buy_item`: 推荐下一件装备（来自 PUGG 出装路径）
//! - `recall`: 持有足够金币时建议回城
//! - `objective`: 资源刷新前提醒站位/视野
//!
//! ## 降级纪律
//!
//! - 找不到我方玩家（名字不匹配）→ 返回空
//! - 无 PUGG 出装数据 → 只产出 objective 建议
//! - 无习惯标签 → 仅产出基础版 reason（不拼接个性化后缀）
//! - 数据不足以判断时返回空——不编造

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::insight::store::HabitTag;
use crate::lcu::api::live_game::{LiveGameSnapshot, LivePlayer};
use crate::pugg::aggregate::BuildStats;

/// 持有 800+ 金币时建议回城（至少能买一件基础装备）。
const RECALL_GOLD_LOW: u32 = 800;
/// 持有 2000+ 金币时强烈建议回城。
const RECALL_GOLD_HIGH: u32 = 2000;
/// 首条元素龙刷新时间（秒）。
const DRAGON_FIRST_SPAWN: f64 = 300.0;
/// 元素龙重生间隔（秒）。
const DRAGON_RESPAWN: f64 = 300.0;
/// 纳什男爵刷新时间（秒）。
const BARON_SPAWN: f64 = 1200.0;
/// 资源刷新前多少秒开始提醒。
const OBJECTIVE_PREP_SECS: f64 = 60.0;
/// 建议有效时长（秒）。
const ACTION_VALID_SECS: f64 = 30.0;

/// 下一动作建议。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextAction {
    pub kind: String,
    pub champion_id: i32,
    pub item_id: i32,
    pub reason: String,
    pub urgency: String,
    pub valid_until: f64,
}

/// 基于实时快照、PUGG 出装与习惯标签生成下一动作建议。
///
/// `habit_tags` 为空时行为同 M5a 基础版——不拼接个性化后缀。
pub fn suggest_next_actions(
    snapshot: &LiveGameSnapshot,
    my_champion_id: i32,
    my_game_name: &str,
    build_stats: Option<&BuildStats>,
    habit_tags: &[HabitTag],
) -> Vec<NextAction> {
    let mut actions = Vec::new();

    let me = find_me(snapshot, my_game_name);
    let Some(me) = me else {
        return actions;
    };

    let game_time = snapshot.game_time;
    let built_ids = built_item_ids(me);
    let habit_suffix = build_habit_suffix(habit_tags);

    // 1. 出装建议
    if let Some(stats) = build_stats {
        if let Some(mut action) = suggest_buy(me, my_champion_id, stats, &built_ids, game_time) {
            let gold = me.gold.total;
            let urgency = if gold >= RECALL_GOLD_HIGH {
                "high"
            } else if gold >= RECALL_GOLD_LOW {
                "medium"
            } else {
                "low"
            };
            action.urgency = urgency.to_string();
            action.reason.push_str(&habit_suffix);
            actions.push(action);
        }
    }

    // 2. 回城建议
    if let Some(mut action) = suggest_recall(me, game_time) {
        action.reason.push_str(&habit_suffix);
        actions.push(action);
    }

    // 3. 资源目标建议
    if let Some(mut action) = suggest_objective(snapshot, game_time) {
        action.reason.push_str(&habit_suffix);
        actions.push(action);
    }

    actions
}

fn find_me<'a>(snapshot: &'a LiveGameSnapshot, my_game_name: &str) -> Option<&'a LivePlayer> {
    let needle = my_game_name.trim().to_lowercase();
    snapshot
        .players
        .iter()
        .find(|p| p.summoner_name.trim().to_lowercase() == needle)
}

fn built_item_ids(player: &LivePlayer) -> HashSet<u32> {
    player
        .items
        .iter()
        .filter(|i| i.item_id > 0)
        .map(|i| i.item_id)
        .collect()
}

/// 在 PUGG 出装序列中找第一个玩家尚未购买的推荐装备。
fn suggest_buy(
    me: &LivePlayer,
    champion_id: i32,
    stats: &BuildStats,
    built_ids: &HashSet<u32>,
    game_time: f64,
) -> Option<NextAction> {
    let built_count = built_ids.len();

    // 遍历槽位（从第 0 槽开始），找到第一个缺失槽
    for slot in &stats.items {
        for item in slot {
            if !built_ids.contains(&(item.item_id as u32)) {
                let win_pct = if stats.samples > 0 {
                    format!(
                        "{:.0}",
                        item.win_count as f64 / stats.samples as f64 * 100.0
                    )
                } else {
                    String::from("?")
                };

                let reason = format!(
                    "根据你最近 {} 局 {} 的出装，建议购买装备 {}（第 {} 件核心装，{}% 胜率）",
                    stats.samples,
                    me.champion_name,
                    item.item_id,
                    built_count + 1,
                    win_pct
                );

                return Some(NextAction {
                    kind: "buy_item".to_string(),
                    champion_id,
                    item_id: item.item_id,
                    reason,
                    urgency: String::new(),
                    valid_until: game_time + ACTION_VALID_SECS,
                });
            }
        }
    }

    None
}

/// 当玩家持有足够金币且存活时建议回城。
fn suggest_recall(me: &LivePlayer, game_time: f64) -> Option<NextAction> {
    if me.is_dead {
        return None;
    }
    let gold = me.gold.total;
    let (urgency, template) = if gold >= RECALL_GOLD_HIGH {
        (
            "high",
            format!(
                "你当前持有 {} 金币，足够购买关键装备，建议回城更新装备",
                gold
            ),
        )
    } else if gold >= RECALL_GOLD_LOW {
        (
            "medium",
            format!("你当前持有 {} 金币，可以回城购买基础装备", gold),
        )
    } else {
        return None;
    };

    Some(NextAction {
        kind: "recall".to_string(),
        champion_id: 0,
        item_id: 0,
        reason: template,
        urgency: urgency.to_string(),
        valid_until: game_time + ACTION_VALID_SECS,
    })
}

/// 资源刷新前提醒站位/视野。
fn suggest_objective(_snapshot: &LiveGameSnapshot, game_time: f64) -> Option<NextAction> {
    let mut nearest_name: Option<&str> = None;
    let mut nearest_spawn = f64::MAX;

    // 小龙
    let dragon_spawns = dragon_spawn_times(game_time);
    if let Some(ts) = dragon_spawns {
        if ts < nearest_spawn {
            nearest_spawn = ts;
            nearest_name = Some("元素龙");
        }
    }

    // 大龙
    if game_time >= BARON_SPAWN - OBJECTIVE_PREP_SECS {
        // 大龙 20 分钟刷新，此后每 6 分钟重刷（简化：只提醒第一次）
        let baron_next = if game_time < BARON_SPAWN {
            BARON_SPAWN
        } else {
            // 已过 20 分钟，按 6 分钟间隔计算下次刷新
            let elapsed = game_time - BARON_SPAWN;
            let interval = 360.0;
            BARON_SPAWN + (elapsed / interval).ceil() * interval
        };
        if baron_next < nearest_spawn {
            nearest_spawn = baron_next;
            nearest_name = Some("纳什男爵");
        }
    }

    let nearest_name = nearest_name?;

    let remaining = nearest_spawn - game_time;
    if remaining > OBJECTIVE_PREP_SECS {
        return None;
    }

    let reason = format!(
        "{} 将在约 {} 秒后刷新，建议提前站位/布置视野",
        nearest_name,
        remaining.max(0.0) as u32
    );

    let urgency = if remaining <= 30.0 { "high" } else { "medium" };

    Some(NextAction {
        kind: "objective".to_string(),
        champion_id: 0,
        item_id: 0,
        reason,
        urgency: urgency.to_string(),
        valid_until: nearest_spawn - 5.0,
    })
}

/// 计算下一次元素龙刷新时间。
fn dragon_spawn_times(game_time: f64) -> Option<f64> {
    if game_time < DRAGON_FIRST_SPAWN {
        return Some(DRAGON_FIRST_SPAWN);
    }
    let elapsed = game_time - DRAGON_FIRST_SPAWN;
    let cycles = (elapsed / DRAGON_RESPAWN).ceil() as u32;
    let next = DRAGON_FIRST_SPAWN + cycles as f64 * DRAGON_RESPAWN;
    // 龙魂后不再刷新（最多 6 条龙，5 次重生 = 6 条龙总窗口）
    if cycles > 5 {
        return None;
    }
    Some(next)
}

/// 将习惯标签拼接为个性化 reason 后缀。
///
/// 无标签时返回空字符串，确保 M5a 基础版行为向后兼容。
fn build_habit_suffix(tags: &[HabitTag]) -> String {
    let parts: Vec<String> = tags
        .iter()
        .map(|t| {
            let label = match t.dimension.as_str() {
                "vision" => "视野",
                "cs" => "补刀",
                "deaths" => "死亡数",
                "kills" => "击杀",
                "assists" => "支援",
                "damage" => "伤害",
                _ => &t.dimension,
            };
            format!("连续 {} 局{}落后于同位置对手", t.streak, label)
        })
        .collect();

    if parts.is_empty() {
        String::new()
    } else {
        format!("，结合你{}", parts.join("、"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::live_game::{LiveGameData, LiveGold, LiveItem, LiveScore};
    use crate::pugg::aggregate::{BuildStats, ItemStat};

    fn player(name: &str, gold: u32, item_ids: &[u32], dead: bool) -> LivePlayer {
        LivePlayer {
            champion_name: "Ahri".to_string(),
            position: "MIDDLE".to_string(),
            team: "ORDER".to_string(),
            is_dead: dead,
            summoner_name: name.to_string(),
            level: 11,
            items: item_ids
                .iter()
                .map(|&id| LiveItem {
                    item_id: id,
                    item_count: 1,
                })
                .collect(),
            scores: LiveScore {
                assists: 3,
                creep_score: 120,
                deaths: 1,
                kills: 5,
                ward_score: 12,
            },
            gold: LiveGold { total: gold },
        }
    }

    fn snapshot(players: Vec<LivePlayer>, game_time: f64) -> LiveGameSnapshot {
        LiveGameSnapshot {
            game_time,
            players,
            events: vec![],
            game_data: LiveGameData {
                game_mode: "CLASSIC".to_string(),
                game_time,
            },
        }
    }

    fn build_stats() -> BuildStats {
        BuildStats {
            champion_id: 103,
            position: "MIDDLE".to_string(),
            mode: 420,
            samples: 20,
            win_count: 12,
            items: vec![
                vec![ItemStat {
                    item_id: 3157,
                    count: 18,
                    win_count: 11,
                }],
                vec![ItemStat {
                    item_id: 3020,
                    count: 15,
                    win_count: 10,
                }],
                vec![ItemStat {
                    item_id: 3135,
                    count: 14,
                    win_count: 9,
                }],
                vec![ItemStat {
                    item_id: 3089,
                    count: 13,
                    win_count: 8,
                }],
                vec![ItemStat {
                    item_id: 3165,
                    count: 12,
                    win_count: 7,
                }],
                vec![ItemStat {
                    item_id: 3100,
                    count: 10,
                    win_count: 6,
                }],
                vec![ItemStat {
                    item_id: 3116,
                    count: 9,
                    win_count: 5,
                }],
            ],
            rune_main: vec![],
            rune_sub: vec![],
            keystone: vec![],
            spells: vec![],
        }
    }

    fn habit_tag(dim: &str, streak: u32) -> HabitTag {
        HabitTag {
            dimension: dim.to_string(),
            avg_vs_peer: -5.0,
            streak,
            first_seen: "2026-08-01T00:00:00Z".to_string(),
            last_seen: "2026-08-18T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn returns_empty_when_player_not_found() {
        let snap = snapshot(vec![player("someone", 1000, &[3157], false)], 300.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        assert!(actions.is_empty());
    }

    #[test]
    fn suggests_buy_when_missing_item() {
        let snap = snapshot(vec![player("me", 1200, &[3157], false)], 420.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        let buy = actions.iter().find(|a| a.kind == "buy_item");
        assert!(buy.is_some(), "应推荐下一件装备");
        let buy = buy.unwrap();
        assert_eq!(buy.item_id, 3020);
        assert!(buy.reason.contains("3020"));
        assert!(buy.reason.contains("50"));
    }

    #[test]
    fn suggests_recall_when_rich() {
        let snap = snapshot(vec![player("me", 2500, &[3157, 3020], false)], 600.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        let recall = actions.iter().find(|a| a.kind == "recall");
        assert!(recall.is_some(), "金币充足应建议回城");
        assert_eq!(recall.unwrap().urgency, "high");
    }

    #[test]
    fn no_recall_when_dead() {
        let snap = snapshot(vec![player("me", 2500, &[3157, 3020], true)], 600.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        let recall = actions.iter().find(|a| a.kind == "recall");
        assert!(recall.is_none(), "阵亡中不应建议回城");
    }

    #[test]
    fn no_recall_when_poor() {
        let snap = snapshot(vec![player("me", 300, &[3157], false)], 400.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        let recall = actions.iter().find(|a| a.kind == "recall");
        assert!(recall.is_none(), "金币不足不应建议回城");
    }

    #[test]
    fn suggests_objective_before_dragon() {
        let snap = snapshot(vec![player("me", 0, &[], false)], 280.0);
        let actions = suggest_next_actions(&snap, 103, "me", None, &[]);
        let obj = actions.iter().find(|a| a.kind == "objective");
        assert!(obj.is_some(), "小龙刷新前应提醒");
        assert!(obj.unwrap().reason.contains("元素龙"));
    }

    #[test]
    fn no_objective_when_not_near_spawn() {
        let snap = snapshot(vec![player("me", 0, &[], false)], 500.0);
        let actions = suggest_next_actions(&snap, 103, "me", None, &[]);
        let obj = actions.iter().find(|a| a.kind == "objective");
        assert!(obj.is_none(), "远离龙刷新时间不应提醒");
    }

    #[test]
    fn skips_already_built_items() {
        let snap = snapshot(vec![player("me", 800, &[3157, 3020, 3135], false)], 500.0);
        let stats = build_stats();
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &[]);
        let buy = actions.iter().find(|a| a.kind == "buy_item").unwrap();
        assert_eq!(buy.item_id, 3089);
    }

    #[test]
    fn appends_habit_tag_suffix_when_tags_present() {
        let snap = snapshot(vec![player("me", 1200, &[3157], false)], 420.0);
        let stats = build_stats();
        let tags = vec![habit_tag("vision", 3), habit_tag("deaths", 5)];
        let actions = suggest_next_actions(&snap, 103, "me", Some(&stats), &tags);
        let buy = actions.iter().find(|a| a.kind == "buy_item").unwrap();
        assert!(buy.reason.contains("连续 3 局视野落后"));
        assert!(buy.reason.contains("连续 5 局死亡数落后"));
        let recall = actions.iter().find(|a| a.kind == "recall").unwrap();
        assert!(recall.reason.contains("连续 3 局视野落后"));
        assert!(recall.reason.contains("连续 5 局死亡数落后"));
    }

    #[test]
    fn build_habit_suffix_empty_when_no_tags() {
        let suffix = build_habit_suffix(&[]);
        assert!(suffix.is_empty());
    }

    #[test]
    fn build_habit_suffix_single_tag() {
        let tags = vec![habit_tag("vision", 4)];
        let suffix = build_habit_suffix(&tags);
        assert!(suffix.contains("连续 4 局视野落后"));
        assert!(!suffix.contains("、"), "单标签不拼接顿号");
    }

    #[test]
    fn build_habit_suffix_multiple_tags() {
        let tags = vec![habit_tag("vision", 3), habit_tag("cs", 2)];
        let suffix = build_habit_suffix(&tags);
        assert!(suffix.contains("连续 3 局视野落后"));
        assert!(suffix.contains("连续 2 局补刀落后"));
        assert!(suffix.contains("、"), "多标签用顿号分隔");
    }
}
