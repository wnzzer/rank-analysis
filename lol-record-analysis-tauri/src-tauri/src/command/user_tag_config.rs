use crate::command::user_tag::RankTag;
use crate::config;
use crate::constant::game::{QUEUE_FLEX, QUEUE_IDS, QUEUE_SOLO_5X5};
use crate::lcu::api::match_history::MatchHistory;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[tauri::command]
pub async fn get_all_tag_configs() -> Result<Vec<TagConfig>, String> {
    Ok(load_config().await)
}

#[tauri::command]
pub async fn save_tag_configs(configs: Vec<TagConfig>) -> Result<(), String> {
    let val = tags_to_value(&configs);
    config::put_config("userTags".to_string(), val).await
}

// --- Foundational Types ---

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Operator {
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Gte,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Lte,
    #[serde(rename = "==")]
    Eq,
    #[serde(rename = "!=")]
    Neq,
}

impl Operator {
    pub fn check(&self, a: f64, b: f64) -> bool {
        match self {
            Operator::Gt => a > b,
            Operator::Gte => a >= b,
            Operator::Lt => a < b,
            Operator::Lte => a <= b,
            Operator::Eq => (a - b).abs() < 0.001,
            Operator::Neq => (a - b).abs() >= 0.001,
        }
    }
}

// --- Filter & Extraction Logic ---

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchFilter {
    // Game context filters
    Queue {
        ids: Vec<i32>,
    },
    Champion {
        ids: Vec<i32>,
    },
    // Game stat filters (e.g., only count games where I died > 10 times)
    Stat {
        metric: String,
        op: Operator,
        value: f64,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchRefresh {
    // Actions to perform on the filtered dataset
    Count {
        op: Operator,
        value: f64,
    },
    Average {
        metric: String,
        op: Operator,
        value: f64,
    },
    Sum {
        metric: String,
        op: Operator,
        value: f64,
    },
    Max {
        metric: String,
        op: Operator,
        value: f64,
    },
    Min {
        metric: String,
        op: Operator,
        value: f64,
    },
    Streak {
        min: i32,
        kind: StreakType,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StreakType {
    Win,
    Loss,
}

// --- Composite Condition Tree ---

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TagCondition {
    // Logic Combinators
    And {
        conditions: Vec<TagCondition>,
    },
    Or {
        conditions: Vec<TagCondition>,
    },
    Not {
        condition: Box<TagCondition>,
    },

    // Data Evaluation
    History {
        filters: Vec<MatchFilter>, // Chain of filters to narrow down the games
        refresh: MatchRefresh,     // Calculation and check on the remaining games
    },

    // Current Context Checks (for future extensibility, e.g. "If I am playing Yasuo")
    CurrentQueue {
        ids: Vec<i32>,
    },
    CurrentChampion {
        ids: Vec<i32>,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagConfig {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub good: bool,
    pub enabled: bool,
    // Replaced triggers/scope with a single root condition for maximum flexibility.
    // The previous "scope" is just a top-level AND condition: And(CurrentQueue(...), ...)
    pub condition: TagCondition,
    pub is_default: bool,
}

impl TagConfig {
    pub fn evaluate(&self, match_history: &MatchHistory, current_mode: i32) -> Option<RankTag> {
        if !self.enabled {
            return None;
        }

        let context = EvalContext {
            history: match_history,
            current_mode,
            current_champion: None, // Can be injected if available
        };

        if context.evaluate_node(&self.condition) {
            let display_name = self.format_name(match_history);
            Some(RankTag {
                good: self.good,
                tag_name: display_name,
                tag_desc: self.desc.clone(),
            })
        } else {
            None
        }
    }

    fn format_name(&self, match_history: &MatchHistory) -> String {
        if self.name.contains("{N}") {
            // Best effort dynamic naming.
            // In the new tree structure, it's hard to know WHICH condition triggered and what the value is.
            // We'll fall back to global streak for {N} placeholder for now, or could try to inspect the condition tree.
            // For simple migration, simple implementation:
            let streak = get_current_streak(match_history);
            let n_cn = number_to_chinese(streak.abs());
            return self.name.replace("{N}", &n_cn);
        }
        self.name.clone()
    }
}

// --- Evaluation Logic ---

struct EvalContext<'a> {
    history: &'a MatchHistory,
    current_mode: i32,
    #[allow(dead_code)]
    current_champion: Option<i32>,
}

impl<'a> EvalContext<'a> {
    fn evaluate_node(&self, condition: &TagCondition) -> bool {
        match condition {
            TagCondition::And { conditions } => conditions.iter().all(|c| self.evaluate_node(c)),
            TagCondition::Or { conditions } => conditions.iter().any(|c| self.evaluate_node(c)),
            TagCondition::Not { condition } => !self.evaluate_node(condition),

            TagCondition::CurrentQueue { ids } => ids.contains(&self.current_mode),
            TagCondition::CurrentChampion { ids } => {
                // If we don't know current champ, usually evaluate to False or ignore?
                // For safety, FALSE.
                if let Some(curr) = self.current_champion {
                    ids.contains(&curr)
                } else {
                    false
                }
            }

            TagCondition::History { filters, refresh } => self.evaluate_history(filters, refresh),
        }
    }

    fn evaluate_history(&self, filters: &[MatchFilter], refresh: &MatchRefresh) -> bool {
        let games_iter = self.history.games.games.iter().filter(|g| {
            for f in filters {
                if !match_filter(g, f) {
                    return false;
                }
            }
            true
        });

        // Collecting because some aggregations (Streak) need order/random access or double pass
        // But Streak just needs iterator if carefully written.
        // For simplicity and small size (20-100 games), collecting references is fine.
        let games: Vec<_> = games_iter.collect();

        match refresh {
            MatchRefresh::Count { op, value } => op.check(games.len() as f64, *value),
            MatchRefresh::Average { metric, op, value } => {
                if games.is_empty() {
                    return false;
                }
                let total: f64 = games.iter().map(|g| extract_game_metric(g, metric)).sum();
                op.check(total / games.len() as f64, *value)
            }
            MatchRefresh::Sum { metric, op, value } => {
                let total: f64 = games.iter().map(|g| extract_game_metric(g, metric)).sum();
                op.check(total, *value)
            }
            MatchRefresh::Max { metric, op, value } => {
                let max_val = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .fold(f64::MIN, f64::max);
                // If no games, what is max? MIN?
                if games.is_empty() {
                    return false;
                }
                op.check(max_val, *value)
            }
            MatchRefresh::Min { metric, op, value } => {
                let min_val = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .fold(f64::MAX, f64::min);
                if games.is_empty() {
                    return false;
                }
                op.check(min_val, *value)
            }
            MatchRefresh::Streak { min, kind } => {
                // Calculate streak on the FILTERED games
                let mut current_streak = 0;

                // Games are typically ordered Newest -> Oldest in match history
                for g in games {
                    let win = extract_game_metric(g, "win") > 0.5;

                    match kind {
                        StreakType::Win => {
                            if win {
                                current_streak += 1;
                            } else {
                                break;
                            }
                        }
                        StreakType::Loss => {
                            if !win {
                                current_streak += 1;
                            } else {
                                break;
                            }
                        }
                    }
                }
                current_streak >= *min
            }
        }
    }
}

fn match_filter(game: &crate::lcu::api::match_history::Game, filter: &MatchFilter) -> bool {
    // Safe lookup for participant
    if game.participants.is_empty() {
        return false;
    }
    let p = &game.participants[0];

    match filter {
        MatchFilter::Queue { ids } => ids.contains(&game.queue_id),
        MatchFilter::Champion { ids } => ids.contains(&p.champion_id),
        MatchFilter::Stat { metric, op, value } => {
            let v = extract_game_metric(game, metric);
            op.check(v, *value)
        }
    }
}

fn extract_game_metric(game: &crate::lcu::api::match_history::Game, metric: &str) -> f64 {
    if game.participants.is_empty() {
        return 0.0;
    }
    let stats = &game.participants[0].stats;

    match metric {
        "kills" => stats.kills as f64,
        "deaths" => stats.deaths as f64,
        "assists" => stats.assists as f64,
        "kda" => {
            if stats.deaths == 0 {
                (stats.kills + stats.assists) as f64
            } else {
                (stats.kills + stats.assists) as f64 / stats.deaths as f64
            }
        }
        "win" => {
            if stats.win {
                1.0
            } else {
                0.0
            }
        }
        "gold" => stats.gold_earned as f64,
        "cs" => stats.total_minions_killed as f64, // + neutral?
        "damage" => stats.total_damage_dealt_to_champions as f64,
        "damageTaken" => stats.total_damage_taken as f64,
        "gameDuration" => game.game_duration as f64,
        _ => 0.0,
    }
}

// Keeping helper for {N} usage
fn get_current_streak(match_history: &MatchHistory) -> i32 {
    let mut s = 0;
    let mut is_win = None;
    for g in &match_history.games.games {
        // Global streak usually implies ranked? Or just general?
        // Keeping behavior simple: Solo/Flex
        if ![QUEUE_SOLO_5X5, QUEUE_FLEX].contains(&g.queue_id) {
            continue;
        }

        if g.participants.is_empty() {
            continue;
        }
        let win = g.participants[0].stats.win;

        if is_win.is_none() {
            is_win = Some(win);
        }
        if Some(win) != is_win {
            break;
        }
        s += 1;
    }
    match is_win {
        Some(true) => s,
        Some(false) => -s,
        None => 0,
    }
}

fn number_to_chinese(num: i32) -> String {
    let chinese_digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (0..10).contains(&num) {
        return chinese_digits[num as usize].to_string();
    }
    format!("{}", num)
}

// Default Configuration
pub fn get_default_tags() -> Vec<TagConfig> {
    let ranked_filter = MatchFilter::Queue {
        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
    };

    vec![
        TagConfig {
            id: "default_streak_win".to_string(),
            name: "{N}连胜".to_string(),
            desc: "最近胜率较高的大腿玩家哦".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![ranked_filter.clone()],
                refresh: MatchRefresh::Streak {
                    min: 3,
                    kind: StreakType::Win,
                },
            },
        },
        TagConfig {
            id: "default_streak_loss".to_string(),
            name: "{N}连败".to_string(),
            desc: "最近连败的玩家哦".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![ranked_filter.clone()],
                refresh: MatchRefresh::Streak {
                    min: 3,
                    kind: StreakType::Loss,
                },
            },
        },
        TagConfig {
            id: "default_casual".to_string(),
            name: "娱乐".to_string(),
            desc: "排位比例较少".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Queue {
                    ids: QUEUE_IDS
                        .iter()
                        .filter(|&id| *id != 420 && *id != 440)
                        .cloned()
                        .collect(),
                }],
                refresh: MatchRefresh::Count {
                    op: Operator::Gt,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_feeder".to_string(),
            name: "峡谷慈善家".to_string(),
            desc: "死亡数较多的玩家".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    // Internal filter: only count games where deaths > 10
                    MatchFilter::Stat {
                        metric: "deaths".to_string(),
                        op: Operator::Gte,
                        value: 10.0,
                    },
                ],
                // If count of such games >= 5
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_carry".to_string(),
            name: "Carry".to_string(),
            desc: "近期比赛多次Carry".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    MatchFilter::Stat {
                        metric: "kda".to_string(),
                        op: Operator::Gte,
                        value: 6.0,
                    },
                ],
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_special_smolder".to_string(),
            name: "小火龙".to_string(),
            desc: "该玩家使用小火龙场次较多".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    MatchFilter::Champion { ids: vec![901] },
                ],
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
    ]
}

pub async fn load_config() -> Vec<TagConfig> {
    match config::get_config("userTags").await {
        Ok(val) => config_value_to_tags(val),
        Err(_) => {
            let defaults = get_default_tags();
            let _ = save_tag_configs(defaults.clone()).await;
            defaults
        }
    }
}

fn tags_to_value(tags: &Vec<TagConfig>) -> config::Value {
    let json = serde_json::to_value(tags).unwrap();
    json_to_config_value(json)
}

fn config_value_to_tags(v: config::Value) -> Vec<TagConfig> {
    let json = config_value_to_json(v);
    serde_json::from_value(json).unwrap_or_else(|_| get_default_tags())
}

fn json_to_config_value(v: serde_json::Value) -> config::Value {
    match v {
        serde_json::Value::Null => config::Value::Null,
        serde_json::Value::Bool(b) => config::Value::Boolean(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                config::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                config::Value::Float(f)
            } else {
                config::Value::Integer(0)
            }
        }
        serde_json::Value::String(s) => config::Value::String(s),
        serde_json::Value::Array(arr) => {
            config::Value::List(arr.into_iter().map(json_to_config_value).collect())
        }
        serde_json::Value::Object(map) => {
            let mut m = HashMap::new();
            for (k, v) in map {
                m.insert(k, json_to_config_value(v));
            }
            config::Value::Map(m)
        }
    }
}

fn config_value_to_json(v: config::Value) -> serde_json::Value {
    match v {
        config::Value::Null => serde_json::Value::Null,
        config::Value::String(s) => serde_json::Value::String(s),
        config::Value::Integer(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        config::Value::Float(f) => serde_json::Value::Number(
            serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
        ),
        config::Value::Boolean(b) => serde_json::Value::Bool(b),
        config::Value::List(arr) => {
            serde_json::Value::Array(arr.into_iter().map(config_value_to_json).collect())
        }
        config::Value::Map(map) => {
            let mut m = serde_json::Map::new();
            for (k, v) in map {
                m.insert(k, config_value_to_json(v));
            }
            serde_json::Value::Object(m)
        }
    }
}
