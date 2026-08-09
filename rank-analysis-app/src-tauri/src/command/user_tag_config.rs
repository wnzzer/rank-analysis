//! # UserTagConfig 命令模块
//!
//! 用户标签配置的读写与解析：标签规则（筛选、刷新条件）、保存/加载。
//!
//! ## 主要功能
//!
//! - **配置管理**: 标签配置的持久化存储和加载
//! - **规则引擎**: 灵活的条件树系统（AND/OR/NOT）用于标签判定
//! - **历史筛选**: 基于对局历史的复杂筛选和统计
//! - **默认标签**: 提供内置的默认标签配置
//!
//! ## 条件树系统
//!
//! 标签配置使用树形结构表示复杂条件：
//!
//! ```text
//! TagCondition
//!     ├── And { conditions: Vec<TagCondition> }      # 所有条件都满足
//!     ├── Or { conditions: Vec<TagCondition> }       # 任一条件满足
//!     ├── Not { condition: Box<TagCondition> }       # 条件不满足
//!     ├── History { filters, refresh }               # 历史数据检查
//!     ├── CurrentQueue { ids }                       # 当前队列检查
//!     └── CurrentChampion { ids }                    # 当前英雄检查
//! ```
//!
//! ## 历史筛选示例
//!
//! ```text
//! History {
//!     filters: [
//!         Queue { ids: [420, 440] },                  # 只考虑排位赛
//!         Stat { metric: "kda", op: Gte, value: 6.0 } # KDA >= 6
//!     ],
//!     refresh: Count { op: Gte, value: 5.0 }          # 满足条件的对局 >= 5
//! }
//! ```
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 获取所有标签配置
//! let configs = get_all_tag_configs().await?;
//!
//! // 保存标签配置
//! save_tag_configs(new_configs).await?;
//!
//! // 评估标签（内部使用）
//! if let Some(tag) = config.evaluate(&match_history, mode, Some(champion_id)) {
//!     println!("玩家获得标签: {}", tag.tag_name);
//! }
//! ```

use crate::command::user_tag::RankTag;
use crate::config;
use crate::constant::game::{QUEUE_FLEX, QUEUE_IDS, QUEUE_SOLO_5X5};
use crate::lcu::api::match_history::MatchHistory;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 获取当前所有标签配置。
///
/// 如果配置不存在，会自动加载默认配置。
///
/// # 返回值
///
/// - `Ok(Vec<TagConfig>)`: 标签配置列表
/// - `Err(String)`: 加载失败时的错误信息
#[tauri::command]
pub async fn get_all_tag_configs() -> Result<Vec<TagConfig>, String> {
    Ok(load_config().await)
}

/// 保存标签配置到本地。
///
/// 配置会被序列化为 JSON 格式，然后通过 config 模块保存。
///
/// # 参数
///
/// - `configs`: 要保存的标签配置列表
///
/// # 返回值
///
/// - `Ok(())`: 保存成功
/// - `Err(String)`: 保存失败时的错误信息
#[tauri::command]
pub async fn save_tag_configs(configs: Vec<TagConfig>) -> Result<(), String> {
    let val = tags_to_value(&configs);
    config::put_config("userTags".to_string(), val).await
}

// --- Foundational Types ---

/// 比较运算符枚举。
///
/// 用于历史数据筛选中的数值比较。
///
/// # 变体
///
/// - `Gt`: 大于 (>)
/// - `Gte`: 大于等于 (>=)
/// - `Lt`: 小于 (<)
/// - `Lte`: 小于等于 (<=)
/// - `Eq`: 等于 (==)
/// - `Neq`: 不等于 (!=)
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
    /// 执行数值比较。
    ///
    /// # 参数
    ///
    /// - `a`: 左侧操作数
    /// - `b`: 右侧操作数
    ///
    /// # 返回值
    ///
    /// 比较结果（true/false）
    ///
    /// # 注意
    ///
    /// `Eq` 和 `Neq` 使用 0.001 的误差范围处理浮点数比较。
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

/// 对局筛选条件。
///
/// 用于 `History` 条件中的对局筛选。
///
/// # 变体
///
/// - `Queue { ids }`: 按队列模式筛选
/// - `Champion { ids }`: 按英雄筛选
/// - `Stat { metric, op, value }`: 按统计数据筛选
/// - `Recent { count }`: 只取最近 N 场（位置性筛选）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchFilter {
    /// 队列模式筛选
    Queue {
        /// 允许的队列 ID 列表
        ids: Vec<i32>,
    },
    /// 英雄筛选
    Champion {
        /// 允许的英雄 ID 列表
        ids: Vec<i32>,
    },
    /// 统计数据筛选
    Stat {
        /// 统计指标名称（如 "kills", "deaths", "kda"）
        metric: String,
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 只取最近 N 场（对局列表最新在前），在其他筛选器之前应用；
    /// 多个 Recent 取最小窗口
    Recent {
        /// 窗口场数
        count: i32,
    },
}

/// 历史数据刷新（统计）条件。
///
/// 用于 `History` 条件中的统计计算。
///
/// # 变体
///
/// - `Count`: 对局数量检查
/// - `Average`: 平均值检查
/// - `Sum`: 总和检查
/// - `Max`: 最大值检查
/// - `Min`: 最小值检查
/// - `Streak`: 连胜/连败检查
/// - `DistinctChampions`: 不同英雄数量检查
/// - `Ratio`: 满足逐场条件的场次占比检查
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchRefresh {
    /// 对局数量检查
    Count {
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 平均值检查
    Average {
        /// 统计指标名称
        metric: String,
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 总和检查
    Sum {
        /// 统计指标名称
        metric: String,
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 最大值检查
    Max {
        /// 统计指标名称
        metric: String,
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 最小值检查
    Min {
        /// 统计指标名称
        metric: String,
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 连胜/连败检查
    Streak {
        /// 最小连续场次
        min: i32,
        /// 连胜或连败
        kind: StreakType,
    },
    /// 筛选后对局中不同英雄数量与阈值比较；空集（无匹配场次）时恒不命中
    DistinctChampions {
        /// 比较运算符
        op: Operator,
        /// 比较值
        value: f64,
    },
    /// 「满足逐场条件的场次占比」与阈值比较：
    /// ratio = count(metric <game_op> game_value 的场次) / count(筛选后场次)
    ///
    /// 注意：NAN 场次（detail 缺失的 damageShare/participation）不计入分子但计入分母（保守稀释）
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
}

/// 连胜/连败类型。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StreakType {
    /// 连胜
    Win,
    /// 连败
    Loss,
}

// --- Composite Condition Tree ---

/// 标签条件树节点。
///
/// 使用树形结构表示复杂的逻辑条件。
///
/// # 变体
///
/// - `And`: 所有子条件都满足
/// - `Or`: 任一子条件满足
/// - `Not`: 子条件不满足
/// - `History`: 基于历史数据的条件
/// - `CurrentQueue`: 当前队列检查
/// - `CurrentChampion`: 当前英雄检查
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TagCondition {
    /// 逻辑与：所有条件都满足
    And {
        /// 子条件列表
        conditions: Vec<TagCondition>,
    },
    /// 逻辑或：任一条件满足
    Or {
        /// 子条件列表
        conditions: Vec<TagCondition>,
    },
    /// 逻辑非：条件不满足
    Not {
        /// 子条件
        condition: Box<TagCondition>,
    },

    /// 历史数据条件
    History {
        /// 对局筛选链
        filters: Vec<MatchFilter>,
        /// 统计检查条件
        refresh: MatchRefresh,
    },

    /// 当前队列检查
    CurrentQueue {
        /// 允许的队列 ID 列表
        ids: Vec<i32>,
    },
    /// 当前英雄检查
    CurrentChampion {
        /// 允许的英雄 ID 列表
        ids: Vec<i32>,
    },
}

/// 标签配置。
///
/// 完整的标签定义，包含显示信息和判定条件。
///
/// # 字段说明
///
/// - `id`: 唯一标识符
/// - `name`: 标签名称（支持 `{N}` 占位符，会被替换为连胜/连败数的中文）
/// - `desc`: 标签描述
/// - `good`: 是否为正面标签（影响 UI 显示颜色）
/// - `enabled`: 是否启用
/// - `condition`: 判定条件树根节点
/// - `is_default`: 是否为默认标签（用户不可删除）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagConfig {
    /// 唯一标识符
    pub id: String,
    /// 标签名称（支持 `{N}` 占位符）
    pub name: String,
    /// 标签描述
    pub desc: String,
    /// 是否为正面标签
    pub good: bool,
    /// 是否启用
    pub enabled: bool,
    /// 判定条件树根节点
    ///
    /// 之前的 "scope" 概念现在作为顶层 AND 条件实现：
    /// `And(CurrentQueue(...), ...)`
    pub condition: TagCondition,
    /// 是否为默认标签
    pub is_default: bool,
}

impl TagConfig {
    /// 评估标签条件。
    ///
    /// 根据对局历史、当前模式和当前英雄判断是否满足标签条件。
    ///
    /// # 参数
    ///
    /// - `match_history`: 对局历史记录
    /// - `current_mode`: 当前队列模式 ID
    /// - `current_champion`: 当前选用的英雄 ID（未知时传 `None`，此时 `CurrentChampion` 条件恒为 false）
    ///
    /// # 返回值
    ///
    /// - `Some(RankTag)`: 条件满足，返回标签
    /// - `None`: 条件不满足或标签被禁用
    ///
    /// # 前置条件
    ///
    /// 使用 `damageShare` 指标的条件要求 `match_history` 已执行 `calculate()`
    /// 预计算伤害占比（当前唯一调用方 `get_user_tag_by_puuid` 已保证）
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

    /// 格式化标签名称。
    ///
    /// 将 `{N}` 占位符替换为实际的连胜/连败数中文。
    ///
    /// # 参数
    ///
    /// - `match_history`: 对局历史记录
    ///
    /// # 返回值
    ///
    /// 格式化后的标签名称
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

/// 条件评估上下文。
///
/// 包含评估条件所需的所有数据。
struct EvalContext<'a> {
    /// 对局历史记录
    history: &'a MatchHistory,
    /// 当前队列模式 ID
    current_mode: i32,
    /// 当前英雄 ID（选人阶段已知时注入，未知为 `None`）
    current_champion: Option<i32>,
}

impl EvalContext<'_> {
    /// 递归评估条件树节点。
    ///
    /// # 参数
    ///
    /// - `condition`: 条件节点
    ///
    /// # 返回值
    ///
    /// 条件是否满足
    fn evaluate_node(&self, condition: &TagCondition) -> bool {
        match condition {
            TagCondition::And { conditions } => conditions.iter().all(|c| self.evaluate_node(c)),
            TagCondition::Or { conditions } => conditions.iter().any(|c| self.evaluate_node(c)),
            TagCondition::Not { condition } => !self.evaluate_node(condition),

            // 按分组匹配而非精确 contains：配置里存的可能是别名队列 ID
            // （新旧人机、430/490 匹配），LCU 报的当前队列则恒为现行 ID
            TagCondition::CurrentQueue { ids } => ids.iter().any(|id| {
                crate::constant::game::queue_ids_same_group(*id as u32, self.current_mode as u32)
            }),
            TagCondition::CurrentChampion { ids } => {
                // 未注入当前英雄（如战绩页场景）时恒不命中
                if let Some(curr) = self.current_champion {
                    ids.contains(&curr)
                } else {
                    false
                }
            }

            TagCondition::History { filters, refresh } => self.evaluate_history(filters, refresh),
        }
    }

    /// 评估历史数据条件。
    ///
    /// `Recent` 筛选器会先被提取并对「最近 N 场」做前置切片，之后才应用逐场筛选链。
    ///
    /// # 参数
    ///
    /// - `filters`: 对局筛选链
    /// - `refresh`: 统计检查条件
    ///
    /// # 返回值
    ///
    /// 条件是否满足
    fn evaluate_history(&self, filters: &[MatchFilter], refresh: &MatchRefresh) -> bool {
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
                // 跳过 NAN 场次（detail 缺失的 damageShare/participation），只对有数据的场次求均值，
                // 否则一场 NAN 会把整个聚合毒化成 NAN、条件永 false
                let vals: Vec<f64> = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .filter(|v| v.is_finite())
                    .collect();
                if vals.is_empty() {
                    return false;
                }
                let total: f64 = vals.iter().sum();
                op.check(total / vals.len() as f64, *value)
            }
            MatchRefresh::Sum { metric, op, value } => {
                // 同 Average：跳过 NAN 场次，避免单场数据缺失毒化总和
                let total: f64 = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .filter(|v| v.is_finite())
                    .sum();
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
            MatchRefresh::DistinctChampions { op, value } => {
                if games.is_empty() {
                    return false;
                }
                let distinct: std::collections::HashSet<i32> = games
                    .iter()
                    .filter_map(|g| g.participants.first().map(|p| p.champion_id))
                    .collect();
                op.check(distinct.len() as f64, *value)
            }
            MatchRefresh::Ratio {
                metric,
                game_op,
                game_value,
                op,
                value,
            } => {
                if games.is_empty() {
                    return false;
                }
                let hits = games
                    .iter()
                    .filter(|g| game_op.check(extract_game_metric(g, metric), *game_value))
                    .count();
                op.check(hits as f64 / games.len() as f64, *value)
            }
        }
    }
}

/// 对局筛选函数。
///
/// 检查单局对局是否匹配筛选条件。
///
/// # 参数
///
/// - `game`: 对局数据
/// - `filter`: 筛选条件
///
/// # 返回值
///
/// 是否匹配筛选条件
fn match_filter(game: &crate::lcu::api::match_history::Game, filter: &MatchFilter) -> bool {
    // Safe lookup for participant
    if game.participants.is_empty() {
        return false;
    }
    let p = &game.participants[0];

    match filter {
        // 队列按中文名分组匹配（如「人机(入门)」对应新旧 830/870 两个 ID，选项去重后只存代表 ID）
        MatchFilter::Queue { ids } => ids.iter().any(|id| {
            crate::constant::game::queue_ids_same_group(game.queue_id as u32, *id as u32)
        }),
        MatchFilter::Champion { ids } => ids.contains(&p.champion_id),
        MatchFilter::Stat { metric, op, value } => {
            let v = extract_game_metric(game, metric);
            op.check(v, *value)
        }
        // Recent 已在 evaluate_history 开头统一切片处理，逐场恒过
        MatchFilter::Recent { .. } => true,
    }
}

/// 提取对局统计指标。
///
/// # 参数
///
/// - `game`: 对局数据
/// - `metric`: 指标名称
///
/// # 支持的指标
///
/// - `kills`: 击杀数
/// - `deaths`: 死亡数
/// - `assists`: 助攻数
/// - `kda`: KDA（(击杀+助攻)/死亡，死亡为0时返回击杀+助攻）
/// - `win`: 胜利（1.0 或 0.0）
/// - `gold`: 获得金币
/// - `cs`: 补刀数
/// - `damage`: 对英雄伤害
/// - `damageTaken`: 承受伤害
/// - `gameDuration`: 对局时长
/// - `damageShare`: 伤害占比（0.0-1.0，依赖 `calculate()` 预计算；game_detail 缺失时为 NAN）
/// - `participation`: 参团率（(击杀+助攻)/本方全队击杀；game_detail 缺失时为 NAN）
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
        "win" if stats.win => 1.0,
        "win" => 0.0,
        "gold" => stats.gold_earned as f64,
        "cs" => stats.total_minions_killed as f64, // + neutral?
        "damage" => stats.total_damage_dealt_to_champions as f64,
        "damageTaken" => stats.total_damage_taken as f64,
        "gameDuration" => game.game_duration as f64,
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
            // CHERRY/斗魂的 teamId 是 9 人大组，须按 playerSubteamId 分小队累加，
            // 否则分母被放大 3 倍（与 match_history::calculate 同一处理）
            let is_cherry = game.game_mode == "CHERRY";
            let my_subteam = game.participants[0].stats.player_subteam_id;
            let team_kills: i32 = game
                .game_detail
                .participants
                .iter()
                .filter(|p| {
                    if is_cherry && my_subteam > 0 {
                        p.stats.player_subteam_id == my_subteam
                    } else {
                        p.team_id == team_id
                    }
                })
                .map(|p| p.stats.kills)
                .sum();
            if team_kills == 0 {
                0.0
            } else {
                (stats.kills + stats.assists) as f64 / team_kills as f64
            }
        }
        _ => 0.0,
    }
}

// Keeping helper for {N} usage

/// 计算当前连胜/连败数。
///
/// 只考虑排位赛（单双排和灵活组排）。
///
/// # 参数
///
/// - `match_history`: 对局历史记录
///
/// # 返回值
///
/// 正数表示连胜场数，负数表示连败场数，0 表示无连胜/连败
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

/// 将数字转换为中文。
///
/// 只支持 0-9 的数字，其他数字返回原字符串。
///
/// # 参数
///
/// - `num`: 数字
///
/// # 返回值
///
/// 中文数字或原数字字符串
fn number_to_chinese(num: i32) -> String {
    let chinese_digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (0..10).contains(&num) {
        return chinese_digits[num as usize].to_string();
    }
    format!("{}", num)
}

// Default Configuration

/// 获取默认标签配置列表。
///
/// 包含以下默认标签：
/// - 连胜（3场以上）
/// - 连败（3场以上）
/// - 娱乐玩家（非排位对局较多）
/// - 峡谷慈善家（死亡数较多）
/// - Carry（高 KDA）
/// - 小火龙（特定英雄场次较多）
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
            // 排位专属：只在当前对局是单双排/灵活组排时展示。
            // 乱斗等娱乐队列里「非排位场次多」几乎人人命中，标签沦为噪音
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::CurrentQueue {
                        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
                    },
                    TagCondition::History {
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
                ],
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
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 10.0,
                        },
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
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 10.0,
                        },
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
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 15.0,
                        },
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
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 15.0,
                        },
                    },
                ],
            },
        },
        // 阈值 0.05 / 0.3 与前端 TagConditionNode.vue 的 ratio 编辑器默认值保持一致，调参需同步
        TagConfig {
            id: "default_int_risk".to_string(),
            name: "伤害贡献低".to_string(),
            desc: "近 20 场中伤害占比极低的场次偏多，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Recent { count: 20 }],
                refresh: MatchRefresh::Ratio {
                    metric: "damageShare".to_string(),
                    game_op: Operator::Lt,
                    game_value: 0.05,
                    op: Operator::Gte,
                    value: 0.3,
                },
            },
        },
    ]
}

/// 将 get_default_tags 中用户配置里缺失的默认标签追加进来。
///
/// 只补"id 不存在"的项；用户对已有标签的任何修改（禁用/改名/调阈值）不被覆盖。
/// is_default 标签 UI 上不可删除，因此无需删除墓碑机制。
fn merge_missing_defaults(mut tags: Vec<TagConfig>) -> Vec<TagConfig> {
    let existing: std::collections::HashSet<String> = tags.iter().map(|t| t.id.clone()).collect();
    tags.extend(
        get_default_tags()
            .into_iter()
            .filter(|d| !existing.contains(&d.id)),
    );
    tags
}

/// 条件树中是否已含 CurrentQueue 节点（用于迁移幂等判断）。
fn condition_has_current_queue(c: &TagCondition) -> bool {
    match c {
        TagCondition::CurrentQueue { .. } => true,
        TagCondition::And { conditions } | TagCondition::Or { conditions } => {
            conditions.iter().any(condition_has_current_queue)
        }
        TagCondition::Not { condition } => condition_has_current_queue(condition),
        _ => false,
    }
}

/// 一次性迁移：「娱乐」标签补上排位专属门控。
///
/// 旧版条件只有 History（非排位场次多），在乱斗等娱乐队列里几乎人人命中、沦为噪音。
/// 就地把原条件包进 `And[CurrentQueue(排位), 原条件]`——用户自调的阈值原样保留。
/// 幂等：条件树里已有 CurrentQueue（无论是迁移过还是用户自己加的）则不动。
///
/// # 返回值
/// 是否发生了迁移（调用方据此决定要不要落盘）
fn migrate_casual_ranked_only(tags: &mut [TagConfig]) -> bool {
    let mut changed = false;
    for t in tags.iter_mut() {
        if t.id == "default_casual" && !condition_has_current_queue(&t.condition) {
            let inner = t.condition.clone();
            t.condition = TagCondition::And {
                conditions: vec![
                    TagCondition::CurrentQueue {
                        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
                    },
                    inner,
                ],
            };
            changed = true;
        }
    }
    changed
}

/// 加载标签配置。
///
/// 如果配置文件不存在，会自动创建默认配置；
/// 已有配置会自动补齐版本更新后新增的默认标签（不覆盖用户对已有标签的修改）。
///
/// # 返回值
///
/// 标签配置列表
pub async fn load_config() -> Vec<TagConfig> {
    match config::get_config("userTags").await {
        Ok(val) => {
            let tags = config_value_to_tags(val);
            let before = tags.len();
            let mut merged = merge_missing_defaults(tags);
            let migrated = migrate_casual_ranked_only(&mut merged);
            if merged.len() != before || migrated {
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

/// 将标签配置列表转换为 config::Value。
fn tags_to_value(tags: &Vec<TagConfig>) -> config::Value {
    let json = serde_json::to_value(tags).unwrap();
    json_to_config_value(json)
}

/// 将 config::Value 转换为标签配置列表。
fn config_value_to_tags(v: config::Value) -> Vec<TagConfig> {
    let json = config_value_to_json(v);
    serde_json::from_value(json).unwrap_or_else(|_| get_default_tags())
}

/// 将 serde_json::Value 转换为 config::Value。
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

/// 将 config::Value 转换为 serde_json::Value。
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::match_history::{Game, GamesWrapper};
    use crate::lcu::api::model::{Participant, Stats};

    /// 构造一场对局：指定英雄、胜负、队列；其余字段取 Default。
    fn make_game(champion_id: i32, win: bool, queue_id: i32) -> Game {
        let p = Participant {
            champion_id,
            team_id: 100,
            stats: Stats {
                win,
                ..Default::default()
            },
            ..Default::default()
        };
        Game {
            queue_id,
            participants: vec![p],
            ..Default::default()
        }
    }

    /// 用给定对局列表构造对局历史；其余字段取 Default。
    fn make_history(games: Vec<Game>) -> MatchHistory {
        MatchHistory {
            games: GamesWrapper { games },
            ..Default::default()
        }
    }

    /// 构造一场带 K/D/A 数据的对局（其余同 `make_game`）。
    fn make_game_kda(
        champion_id: i32,
        win: bool,
        queue_id: i32,
        kills: i32,
        deaths: i32,
        assists: i32,
    ) -> Game {
        let mut g = make_game(champion_id, win, queue_id);
        g.participants[0].stats.kills = kills;
        g.participants[0].stats.deaths = deaths;
        g.participants[0].stats.assists = assists;
        g
    }

    /// 构造一场带伤害占比（rate 为 calculate() 预计算的 0-100 整数）
    /// 且 game_detail 非空的排位对局——detail 缺失时 damageShare 为 NAN，不计入 Ratio 分子。
    fn make_game_with_damage_rate(win: bool, rate: i32) -> Game {
        let mut g = make_game(1, win, QUEUE_SOLO_5X5);
        g.participants[0].stats.damage_dealt_to_champions_rate = rate;
        g.game_detail.participants = vec![Default::default()];
        g
    }

    /// 按 id 从默认标签列表中取出一个 TagConfig。
    fn default_tag(id: &str) -> TagConfig {
        get_default_tags()
            .into_iter()
            .find(|t| t.id == id)
            .unwrap_or_else(|| panic!("默认标签不存在: {}", id))
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
        // 注入的英雄命中条件列表 → 命中
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, Some(157)).is_some());
        // 注入的英雄不在条件列表 → 不命中
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, Some(1)).is_none());
        // 未注入英雄（None）→ 条件恒为 false，不命中
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, None).is_none());
    }

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
        let ctx = EvalContext {
            history: &history,
            current_mode: 420,
            current_champion: None,
        };

        // 近 3 场平均胜率 1.0；全 6 场是 0.5
        let win_recent3 = ctx.evaluate_history(
            &[MatchFilter::Recent { count: 3 }],
            &MatchRefresh::Average {
                metric: "win".into(),
                op: Operator::Gte,
                value: 0.99,
            },
        );
        assert!(win_recent3);
        let win_all = ctx.evaluate_history(
            &[],
            &MatchRefresh::Average {
                metric: "win".into(),
                op: Operator::Gte,
                value: 0.99,
            },
        );
        assert!(!win_all);
        // count 超过总场次不 panic
        let over = ctx.evaluate_history(
            &[MatchFilter::Recent { count: 99 }],
            &MatchRefresh::Count {
                op: Operator::Eq,
                value: 6.0,
            },
        );
        assert!(over);
    }

    #[test]
    fn current_queue_matches_alias_ids_across_generations() {
        let history = make_history(vec![]);
        // 配置里存的是旧人机 850（一般），LCU 报的当前队列是现行 890 → 同组应命中
        let ctx = EvalContext {
            history: &history,
            current_mode: 890,
            current_champion: None,
        };
        assert!(ctx.evaluate_node(&TagCondition::CurrentQueue { ids: vec![850] }));
        // 反向：配置存现行匹配 490，当前队列为 430
        let ctx2 = EvalContext {
            history: &history,
            current_mode: 430,
            current_champion: None,
        };
        assert!(ctx2.evaluate_node(&TagCondition::CurrentQueue { ids: vec![490] }));
        // 不同玩法（大乱斗 450）不得命中
        assert!(!ctx2.evaluate_node(&TagCondition::CurrentQueue { ids: vec![450] }));
    }

    #[test]
    fn recent_slices_before_queue_filter_not_after() {
        // 最新 2 场大乱斗 + 更早 3 场排位。
        // Recent 3 + Queue[420,440]：先切最近 3 场再筛队列 → 只剩 1 场排位；
        // 若实现错误地"先筛队列再取 3 场"会得到 3 场。
        let history = make_history(vec![
            make_game(1, true, 450),
            make_game(2, true, 450),
            make_game(3, true, QUEUE_SOLO_5X5),
            make_game(4, true, QUEUE_SOLO_5X5),
            make_game(5, true, QUEUE_SOLO_5X5),
        ]);
        let ctx = EvalContext {
            history: &history,
            current_mode: 420,
            current_champion: None,
        };
        let filters = [
            MatchFilter::Recent { count: 3 },
            MatchFilter::Queue {
                ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
            },
        ];
        assert!(ctx.evaluate_history(
            &filters,
            &MatchRefresh::Count {
                op: Operator::Eq,
                value: 1.0
            },
        ));
    }

    #[test]
    fn distinct_champions_counts_unique_ids() {
        let history = make_history(vec![
            make_game(1, true, QUEUE_SOLO_5X5),
            make_game(1, true, QUEUE_SOLO_5X5),
            make_game(2, true, QUEUE_SOLO_5X5),
        ]);
        let ctx = EvalContext {
            history: &history,
            current_mode: 420,
            current_champion: None,
        };
        assert!(ctx.evaluate_history(
            &[],
            &MatchRefresh::DistinctChampions {
                op: Operator::Eq,
                value: 2.0
            },
        ));
    }

    #[test]
    fn ratio_counts_matching_games_share() {
        // 4 场里 1 场 0 击杀 → kills < 1 的占比 0.25
        let g_feed = make_game(1, false, QUEUE_SOLO_5X5); // kills 默认 0
        let mk_normal = |champ: i32| {
            let mut g = make_game(champ, true, QUEUE_SOLO_5X5);
            g.participants[0].stats.kills = 5;
            g
        };
        let history = make_history(vec![g_feed, mk_normal(2), mk_normal(3), mk_normal(4)]);
        let ctx = EvalContext {
            history: &history,
            current_mode: 420,
            current_champion: None,
        };
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
        let ctx2 = EvalContext {
            history: &empty,
            current_mode: 420,
            current_champion: None,
        };
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

    #[test]
    fn damage_share_reads_precomputed_rate_and_nan_when_no_detail() {
        // game_detail 为空 → NAN，任何 Operator::check 均为 false（不把数据缺失误判成低伤害）
        let mut g = make_game(1, true, QUEUE_SOLO_5X5);
        g.participants[0].stats.damage_dealt_to_champions_rate = 30;
        assert!(extract_game_metric(&g, "damageShare").is_nan());
        // 有 detail 时读 calculate() 预计算占比（0-100 → 0.0-1.0）
        g.game_detail.participants = vec![Default::default()];
        assert!((extract_game_metric(&g, "damageShare") - 0.30).abs() < 1e-9);
    }

    #[test]
    fn participation_is_ka_over_team_kills() {
        let mut g = make_game(1, true, QUEUE_SOLO_5X5);
        g.participants[0].stats.kills = 3;
        g.participants[0].stats.assists = 5;
        // 本方（team 100）总击杀 16（含本人 3），敌方 50 不计入
        g.game_detail.participants = vec![
            Participant {
                team_id: 100,
                stats: Stats {
                    kills: 13,
                    ..Default::default()
                },
                ..Default::default()
            },
            Participant {
                team_id: 100,
                stats: Stats {
                    kills: 3,
                    ..Default::default()
                },
                ..Default::default()
            },
            Participant {
                team_id: 200,
                stats: Stats {
                    kills: 50,
                    ..Default::default()
                },
                ..Default::default()
            },
        ];
        assert!((extract_game_metric(&g, "participation") - 0.5).abs() < 1e-9);
        // 有 detail 但全队 0 击杀 → 0.0 不 panic（区别于 detail 缺失的 NAN）
        let mut g2 = make_game(1, true, QUEUE_SOLO_5X5);
        g2.game_detail.participants = vec![Default::default()];
        assert_eq!(extract_game_metric(&g2, "participation"), 0.0);
        // detail 缺失 → NAN
        let g3 = make_game(1, true, QUEUE_SOLO_5X5);
        assert!(extract_game_metric(&g3, "participation").is_nan());
    }

    #[test]
    fn average_skips_nan_games_instead_of_poisoning() {
        // 2 场有 detail（rate 30）+ 1 场无 detail（NAN）→ Average damageShare = 0.30 而非 NAN
        let mk = |with_detail: bool| {
            let mut g = make_game(1, true, QUEUE_SOLO_5X5);
            g.participants[0].stats.damage_dealt_to_champions_rate = 30;
            if with_detail {
                g.game_detail.participants = vec![Default::default()];
            }
            g
        };
        let history = make_history(vec![mk(true), mk(true), mk(false)]);
        let ctx = EvalContext {
            history: &history,
            current_mode: 420,
            current_champion: None,
        };
        assert!(ctx.evaluate_history(
            &[],
            &MatchRefresh::Average {
                metric: "damageShare".into(),
                op: Operator::Eq,
                value: 0.30,
            },
        ));
    }

    #[test]
    fn participation_uses_subteam_kills_in_cherry_mode() {
        // CHERRY：teamId 是 9 人大组，参团率分母须只算本人 subteam（1）的击杀
        let mut g = make_game(1, true, 1700);
        g.game_mode = "CHERRY".into();
        g.participants[0].stats.kills = 2;
        g.participants[0].stats.assists = 2;
        g.participants[0].stats.player_subteam_id = 1;
        let mk_detail = |subteam: i32, kills: i32| Participant {
            team_id: 100,
            stats: Stats {
                kills,
                player_subteam_id: subteam,
                ..Default::default()
            },
            ..Default::default()
        };
        g.game_detail.participants = vec![
            mk_detail(1, 2), // 本人
            mk_detail(1, 2), // 同 subteam 队友
            mk_detail(2, 6), // 其他 subteam（同大组），不应计入分母
            mk_detail(3, 4),
        ];
        // (2+2) / 4 = 1.0；若误按大组累加，分母为 14 → 4/14
        assert!((extract_game_metric(&g, "participation") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn distinct_champions_empty_set_returns_false() {
        let empty = make_history(vec![]);
        let ctx = EvalContext {
            history: &empty,
            current_mode: 420,
            current_champion: None,
        };
        assert!(!ctx.evaluate_history(
            &[],
            &MatchRefresh::DistinctChampions {
                op: Operator::Lte,
                value: 3.0
            },
        ));
    }

    // --- 语义类默认标签（规则语义级测试）---

    #[test]
    fn default_smurf_fires_on_high_winrate_high_kda() {
        // 12 场排位全胜、KDA (10+5)/2 = 7.5 ≥ 5：
        // Count 12 ≥ 10、胜率 1.0 ≥ 0.75、KDA 7.5 ≥ 5 → 命中「炸鱼嫌疑」
        let games: Vec<Game> = (0..12)
            .map(|_| make_game_kda(1, true, QUEUE_SOLO_5X5, 10, 2, 5))
            .collect();
        let history = make_history(games);
        let smurf = default_tag("default_smurf");
        assert!(smurf.evaluate(&history, 420, None).is_some());
        // 6 场样本不足（Count 6 < 10）→ 不命中
        let few = make_history(
            (0..6)
                .map(|_| make_game_kda(1, true, QUEUE_SOLO_5X5, 10, 2, 5))
                .collect(),
        );
        assert!(smurf.evaluate(&few, 420, None).is_none());
    }

    #[test]
    fn default_champion_pool_narrow_fires_on_few_champions_enough_games() {
        let tag = default_tag("default_champion_pool_narrow");
        // 20 场全英雄 1 → Distinct 1 ≤ 3 且 Count 20 ≥ 10 命中
        let narrow = make_history(
            (0..20)
                .map(|_| make_game(1, true, QUEUE_SOLO_5X5))
                .collect(),
        );
        assert!(tag.evaluate(&narrow, 420, None).is_some());
        // 英雄海玩家（20 个英雄）→ Distinct 20 > 3 不命中「专精」
        let wide = make_history(
            (0..20)
                .map(|i| make_game(i, true, QUEUE_SOLO_5X5))
                .collect(),
        );
        assert!(tag.evaluate(&wide, 420, None).is_none());
    }

    #[test]
    fn default_hot_streak_form_fires_on_recent_surge_only() {
        let tag = default_tag("default_hot_streak_form");
        // 列表最新在前：近 10 场 8 胜（0.8 ≥ 0.7），更早 10 场 2 胜，
        // 整体 20 场胜率 0.5 ≤ 0.55 且 Count 20 ≥ 15 → 命中「手热」
        let mut games: Vec<Game> = (0..10)
            .map(|i| make_game(1, i < 8, QUEUE_SOLO_5X5))
            .collect();
        games.extend((0..10).map(|i| make_game(1, i < 2, QUEUE_SOLO_5X5)));
        assert!(tag.evaluate(&make_history(games), 420, None).is_some());
        // 20 场全胜：近 10 胜率高但整体 1.0 > 0.55，「一直很强」不算「手热」
        let all_win = make_history(
            (0..20)
                .map(|_| make_game(1, true, QUEUE_SOLO_5X5))
                .collect(),
        );
        assert!(tag.evaluate(&all_win, 420, None).is_none());
    }

    #[test]
    fn default_cold_form_fires_on_recent_slump() {
        let tag = default_tag("default_cold_form");
        // 近 10 场 2 胜（0.2 ≤ 0.3），更早 10 场 8 胜，
        // 整体 20 场胜率 0.5 ≥ 0.45 且 Count 20 ≥ 15 → 命中「低谷」
        let mut games: Vec<Game> = (0..10)
            .map(|i| make_game(1, i < 2, QUEUE_SOLO_5X5))
            .collect();
        games.extend((0..10).map(|i| make_game(1, i < 8, QUEUE_SOLO_5X5)));
        assert!(tag.evaluate(&make_history(games), 420, None).is_some());
        // 20 场全败：近 10 胜率 0 ≤ 0.3，但整体 0 < 0.45，「一直低迷」不算「低谷」
        let all_loss = make_history(
            (0..20)
                .map(|_| make_game(1, false, QUEUE_SOLO_5X5))
                .collect(),
        );
        assert!(tag.evaluate(&all_loss, 420, None).is_none());
    }

    #[test]
    fn default_int_risk_fires_on_frequent_low_damage_share() {
        let tag = default_tag("default_int_risk");
        // 20 场全部带 game_detail（避免 NAN 稀释分子）：
        // 6 场 rate 3（0.03 < 0.05）+ 14 场 rate 25 → 占比 6/20 = 0.3 ≥ 0.3 命中
        // （rate 5 → 0.05 不满足 Lt 0.05，故正例用 rate 3）
        let mut games: Vec<Game> = (0..6)
            .map(|_| make_game_with_damage_rate(false, 3))
            .collect();
        games.extend((0..14).map(|_| make_game_with_damage_rate(true, 25)));
        assert!(tag.evaluate(&make_history(games), 420, None).is_some());
        // 20 场伤害占比全部正常（0.25）→ 占比 0 < 0.3 不命中
        let normal = make_history(
            (0..20)
                .map(|_| make_game_with_damage_rate(true, 25))
                .collect(),
        );
        assert!(tag.evaluate(&normal, 420, None).is_none());
    }

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
        let first = merged
            .iter()
            .find(|t| t.id == get_default_tags()[0].id)
            .unwrap();
        assert!(!first.enabled);
        assert_eq!(first.name, "我改过名");
        // 幂等：再 merge 不再增长
        let len = merged.len();
        assert_eq!(merge_missing_defaults(merged).len(), len);
    }

    /// 造一个旧版（无 CurrentQueue 门控）的「娱乐」标签配置
    fn legacy_casual_tag() -> TagConfig {
        TagConfig {
            id: "default_casual".to_string(),
            name: "娱乐".to_string(),
            desc: "排位比例较少".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Queue { ids: vec![450] }],
                refresh: MatchRefresh::Count {
                    op: Operator::Gt,
                    value: 5.0,
                },
            },
        }
    }

    #[test]
    fn should_migrate_legacy_casual_to_ranked_only_once() {
        let mut tags = vec![legacy_casual_tag()];
        // 首次迁移：包上 CurrentQueue 门控
        assert!(migrate_casual_ranked_only(&mut tags));
        assert!(condition_has_current_queue(&tags[0].condition));
        // 用户自调的 History 阈值保留在内层
        if let TagCondition::And { conditions } = &tags[0].condition {
            assert!(matches!(conditions[1], TagCondition::History { .. }));
        } else {
            panic!("expected And-wrapped condition");
        }
        // 幂等：已迁移过不再动
        assert!(!migrate_casual_ranked_only(&mut tags));
    }

    #[test]
    fn casual_tag_should_only_hit_in_ranked_lobby() {
        let casual = get_default_tags()
            .into_iter()
            .find(|t| t.id == "default_casual")
            .unwrap();
        // 近 20 场大量非排位（450 ARAM）→ History 条件满足
        let history = make_history((0..10).map(|_| make_game(1, true, 450)).collect());
        // 当前在排位（420）→ 展示
        assert!(casual.evaluate(&history, 420, None).is_some());
        // 当前在乱斗等非排位队列 → 不展示
        assert!(casual.evaluate(&history, 450, None).is_none());
    }
}
