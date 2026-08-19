//! # 赛前威胁评级模块（M4 战场六）
//!
//! 对 champ-select 中敌方玩家进行赛前威胁评级，输出威胁等级、风格标签、
//! 相遇次数、对线侵略性、近期表现分等。
//!
//! ## 数据来源
//!
//! - 对方历史数据：`meet_db::all_collected_games()` 中按 puuid 匹配
//! - 相遇记录：`meet_db::query_summary(puuid)`
//! - 评分：复用 `score::score_participants` 17 分制
//!
//! ## 降级纪律
//!
//! - 单玩家数据不足 5 局 → `threat_level = Low`，`caveats` 标注"数据不足"
//! - 无相遇记录 → `encounter_count = 0`，`caveats` 标注"未交手"
//! - 无法定位本机 summoner → 整体返回空（不编造）

use serde::Serialize;

use crate::command::score::PlayerScoreInput;
use crate::lcu::api::match_history::Game;
use crate::lcu::api::model::Participant;
use crate::score::score_participants;

/// 最小有效局数阈值。
pub const MIN_GAMES_FOR_RATING: usize = 5;

/// 聚合窗口（最近 N 局）。
const AGGREGATE_LIMIT: usize = 20;

/// 高威胁阈值（表现分均值）。
const HIGH_PERFORMANCE_THRESHOLD: f64 = 10.0;

/// 极高威胁阈值（表现分均值）。
const CRITICAL_PERFORMANCE_THRESHOLD: f64 = 13.0;

/// 赛前威胁等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreatLevel {
    /// 数据不足或表现平平。
    Low,
    /// 有一定威胁，正常水平。
    Medium,
    /// 高威胁，近期表现出色。
    High,
    /// 极高威胁，近期表现碾压。
    Critical,
}

/// 另一名玩家的信息（供聚合用）。
#[derive(Debug, Clone)]
pub struct PlayerInfo {
    pub puuid: String,
    pub position: String,
}

/// 赛前威胁评级结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatRating {
    pub threat_level: ThreatLevel,
    pub style_tags: Vec<String>,
    pub encounter_count: u32,
    pub lane_aggression: f64,
    pub recent_performance: f64,
    pub main_champion_win_rate: Option<f64>,
    pub caveats: Vec<String>,
    pub puuid: String,
    pub position: String,
}

/// 按 puuid 在单局中定位参与者（口径同 insight::my_participant）。
///
/// 通过 `game_detail.participant_identities` 找到该 puuid 在列表中的索引，
/// 再在 `game_detail.participants` 中按 `participant_id == idx + 1` 匹配，
/// 找不到退回同索引取值。
fn find_participant<'a>(game: &'a Game, puuid: &str) -> Option<&'a Participant> {
    let identities = &game.game_detail.participant_identities;
    let idx = identities.iter().position(|i| i.player.puuid == puuid)?;
    game.game_detail
        .participants
        .iter()
        .find(|p| p.participant_id == idx as i32 + 1)
        .or_else(|| game.game_detail.participants.get(idx))
}

/// 从单局中提取玩家评分输入。
fn participant_to_score_input(p: &Participant, game_duration: i32) -> PlayerScoreInput {
    PlayerScoreInput {
        participant_id: p.participant_id,
        champion_id: p.champion_id,
        team_id: p.team_id,
        puuid: String::new(),
        summoner_name: String::new(),
        win: p.stats.win,
        kills: p.stats.kills,
        deaths: p.stats.deaths,
        assists: p.stats.assists,
        gold_earned: p.stats.gold_earned,
        damage_dealt_to_champions: p.stats.total_damage_dealt_to_champions,
        damage_taken: p.stats.total_damage_taken,
        total_heal: p.stats.total_heal,
        cs: p.stats.total_minions_killed + p.stats.neutral_minions_killed,
        vision_score: p.stats.vision_score,
        game_duration,
    }
}

/// 对局风格数据采集。
#[derive(Debug)]
struct PlayerStyle {
    kills: Vec<i32>,
    deaths: Vec<i32>,
    assists: Vec<i32>,
    damages: Vec<i32>,
    visions: Vec<i32>,
    cs: Vec<i32>,
    scores: Vec<f64>,
    wins: u32,
    total: u32,
    champion_counts: Vec<(i32, u32)>,
}

impl PlayerStyle {
    fn new() -> Self {
        Self {
            kills: Vec::new(),
            deaths: Vec::new(),
            assists: Vec::new(),
            damages: Vec::new(),
            visions: Vec::new(),
            cs: Vec::new(),
            scores: Vec::new(),
            wins: 0,
            total: 0,
            champion_counts: Vec::new(),
        }
    }

    fn add_game(&mut self, p: &Participant, score: f64) {
        self.kills.push(p.stats.kills);
        self.deaths.push(p.stats.deaths);
        self.assists.push(p.stats.assists);
        self.damages.push(p.stats.total_damage_dealt_to_champions);
        self.visions.push(p.stats.vision_score);
        self.cs
            .push(p.stats.total_minions_killed + p.stats.neutral_minions_killed);
        self.scores.push(score);
        if p.stats.win {
            self.wins += 1;
        }
        self.total += 1;

        if let Some((_, count)) = self
            .champion_counts
            .iter_mut()
            .find(|(cid, _)| *cid == p.champion_id)
        {
            *count += 1;
        } else {
            self.champion_counts.push((p.champion_id, 1));
        }
    }
}

/// 聚合产出风格标签。
fn generate_style_tags(style: &PlayerStyle) -> Vec<String> {
    let mut tags = Vec::new();

    if style.total < MIN_GAMES_FOR_RATING as u32 {
        return tags;
    }

    let n = style.total as f64;
    let avg_kills = style.kills.iter().sum::<i32>() as f64 / n;
    let avg_deaths = style.deaths.iter().sum::<i32>() as f64 / n;
    let avg_assists = style.assists.iter().sum::<i32>() as f64 / n;
    let avg_damage = style.damages.iter().sum::<i32>() as f64 / n;
    let avg_vision = style.visions.iter().sum::<i32>() as f64 / n;
    let avg_cs = style.cs.iter().sum::<i32>() as f64 / n;

    // 侵略性强：高击杀 + 高死亡
    if (avg_kills + avg_deaths) / (avg_assists + 1.0) > 1.2 {
        tags.push("侵略性强".to_string());
    }

    // 稳健发育：低死亡 + 高补刀
    if avg_deaths < 4.0 && avg_cs > 150.0 {
        tags.push("稳健发育".to_string());
    }

    // 团战核心：高伤害 + 高击杀参与
    if avg_damage > 15000.0 && (avg_kills + avg_assists) > 8.0 {
        tags.push("团战核心".to_string());
    }

    // 单带偏好：高补刀 + 低团战参与
    if avg_cs > 200.0 && (avg_kills + avg_assists) < 6.0 {
        tags.push("单带偏好".to_string());
    }

    // 视野控制：高视野分
    if avg_vision > 30.0 {
        tags.push("视野控制".to_string());
    }

    // 高 KDA：高击杀 + 低死亡
    if avg_kills > 5.0 && avg_deaths < 4.0 {
        tags.push("高KDA".to_string());
    }

    tags
}

/// 计算对线侵略性得分。
///
/// 使用 (击杀×1.5 + 助攻×0.5) / (死亡 + 1) 的公式。
fn compute_aggression(style: &PlayerStyle) -> f64 {
    if style.total == 0 {
        return 0.0;
    }
    let n = style.total as f64;
    let avg_kills = style.kills.iter().sum::<i32>() as f64 / n;
    let avg_assists = style.assists.iter().sum::<i32>() as f64 / n;
    let avg_deaths = style.deaths.iter().sum::<i32>() as f64 / n;
    (avg_kills * 1.5 + avg_assists * 0.5) / (avg_deaths + 1.0)
}

/// 评估单个敌方玩家的威胁等级。
fn assess_single_threat(style: &PlayerStyle, encounter_count: u32) -> ThreatRating {
    let mut caveats = Vec::new();

    let recent_performance = if style.total >= MIN_GAMES_FOR_RATING as u32 {
        style.scores.iter().sum::<f64>() / style.total as f64
    } else {
        caveats.push("数据不足".to_string());
        0.0
    };

    if encounter_count == 0 {
        caveats.push("未交手".to_string());
    }

    let threat_level = if style.total < MIN_GAMES_FOR_RATING as u32 {
        ThreatLevel::Low
    } else if recent_performance >= CRITICAL_PERFORMANCE_THRESHOLD {
        ThreatLevel::Critical
    } else if recent_performance >= HIGH_PERFORMANCE_THRESHOLD {
        ThreatLevel::High
    } else {
        ThreatLevel::Medium
    };

    let lane_aggression = compute_aggression(style);
    let style_tags = generate_style_tags(style);

    let main_champion_win_rate = if style.total > 0 {
        Some(style.wins as f64 / style.total as f64)
    } else {
        None
    };

    ThreatRating {
        threat_level,
        style_tags,
        encounter_count,
        lane_aggression,
        recent_performance,
        main_champion_win_rate,
        caveats,
        puuid: String::new(),
        position: String::new(),
    }
}

/// 对全体敌方玩家进行威胁评级。
///
/// # 参数
/// - `_my_puuid`: 本机玩家 PUUID（保留参数，未来扩展）
/// - `enemies`: 敌方玩家信息列表（puuid + 位置）
///
/// # 返回
/// 敌方玩家威胁评级结果列表，按威胁等级降序排列。
pub fn assess_team_threats(_my_puuid: &str, enemies: &[PlayerInfo]) -> Vec<ThreatRating> {
    let mut results = Vec::new();

    for enemy in enemies {
        let mut style = PlayerStyle::new();

        for game in all_games_for_player(&enemy.puuid) {
            if let Some(p) = find_participant(&game, &enemy.puuid) {
                let input = participant_to_score_input(p, game.game_detail.game_duration);
                let scores = score_participants(&[input]);
                let score = scores.first().map(|s| s.total).unwrap_or(0.0);
                style.add_game(p, score);
            }
        }

        let encounter_count = get_encounter_count(&enemy.puuid);
        let mut rating = assess_single_threat(&style, encounter_count);
        rating.puuid = enemy.puuid.clone();
        rating.position = enemy.position.clone();
        results.push(rating);
    }

    results.sort_by(|a, b| {
        let a_ord = threat_level_ord(a.threat_level);
        let b_ord = threat_level_ord(b.threat_level);
        b_ord.cmp(&a_ord)
    });

    results
}

fn threat_level_ord(level: ThreatLevel) -> i32 {
    match level {
        ThreatLevel::Low => 0,
        ThreatLevel::Medium => 1,
        ThreatLevel::High => 2,
        ThreatLevel::Critical => 3,
    }
}

/// 获取与某玩家的相遇次数。
fn get_encounter_count(puuid: &str) -> u32 {
    crate::meet_db::query_summary(puuid)
        .map(|s| s.total as u32)
        .unwrap_or(0)
}

/// 从 collected_games 中提取某 puuid 参与的所有对局（最近 AGGREGATE_LIMIT 局）。
fn all_games_for_player(puuid: &str) -> Vec<Game> {
    let mut result = Vec::new();
    for (_, _, games) in crate::meet_db::all_collected_games() {
        for game in games {
            if game
                .game_detail
                .participant_identities
                .iter()
                .any(|id| id.player.puuid == puuid)
            {
                result.push(game);
            }
        }
    }
    result.sort_by(|a, b| a.game_creation_date.cmp(&b.game_creation_date));
    if result.len() > AGGREGATE_LIMIT {
        result = result.split_off(result.len() - AGGREGATE_LIMIT);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_return_low_threat_when_no_games() {
        let style = PlayerStyle::new();
        let rating = assess_single_threat(&style, 0);
        assert_eq!(rating.threat_level, ThreatLevel::Low);
        assert!(rating.caveats.contains(&"数据不足".to_string()));
        assert!(rating.caveats.contains(&"未交手".to_string()));
    }

    #[test]
    fn should_return_low_threat_when_insufficient_games() {
        let mut style = PlayerStyle::new();
        for _ in 0..3 {
            style.kills.push(5);
            style.deaths.push(3);
            style.assists.push(8);
            style.damages.push(12000);
            style.visions.push(25);
            style.cs.push(180);
            style.scores.push(8.5);
            style.total += 1;
        }
        let rating = assess_single_threat(&style, 0);
        assert_eq!(rating.threat_level, ThreatLevel::Low);
        assert!(rating.caveats.contains(&"数据不足".to_string()));
    }

    #[test]
    fn should_assign_medium_threat_for_average_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(4);
            style.deaths.push(5);
            style.assists.push(6);
            style.damages.push(10000);
            style.visions.push(20);
            style.cs.push(150);
            style.scores.push(8.0);
            style.total += 1;
        }
        let rating = assess_single_threat(&style, 5);
        assert_eq!(rating.threat_level, ThreatLevel::Medium);
        assert_eq!(rating.encounter_count, 5);
    }

    #[test]
    fn should_assign_high_threat_for_strong_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(8);
            style.deaths.push(2);
            style.assists.push(10);
            style.damages.push(25000);
            style.visions.push(30);
            style.cs.push(200);
            style.scores.push(12.0);
            style.total += 1;
            style.wins += 1;
        }
        let rating = assess_single_threat(&style, 3);
        assert_eq!(rating.threat_level, ThreatLevel::High);
        assert!(rating.recent_performance >= HIGH_PERFORMANCE_THRESHOLD);
    }

    #[test]
    fn should_assign_critical_threat_for_elite_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(12);
            style.deaths.push(1);
            style.assists.push(15);
            style.damages.push(35000);
            style.visions.push(40);
            style.cs.push(250);
            style.scores.push(15.0);
            style.total += 1;
            style.wins += 1;
        }
        let rating = assess_single_threat(&style, 10);
        assert_eq!(rating.threat_level, ThreatLevel::Critical);
        assert!(rating.recent_performance >= CRITICAL_PERFORMANCE_THRESHOLD);
    }

    #[test]
    fn should_generate_style_tags() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(10);
            style.deaths.push(2);
            style.assists.push(3);
            style.damages.push(30000);
            style.visions.push(10);
            style.cs.push(250);
            style.scores.push(13.0);
            style.total += 1;
        }
        let tags = generate_style_tags(&style);
        assert!(tags.iter().any(|t| t == "侵略性强"));
        assert!(tags.iter().any(|t| t == "高KDA"));
        assert!(!tags.is_empty());
    }

    #[test]
    fn should_return_zero_aggression_for_empty() {
        let style = PlayerStyle::new();
        assert_eq!(compute_aggression(&style), 0.0);
    }
}
