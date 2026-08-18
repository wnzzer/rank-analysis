//! # 习惯标签聚合（insight，M3 战场三）
//!
//! 从 meet_db 收集的完整对局详情提取「本机玩家」每局六个 L2 维度的表现，
//! 与**同局同位置 peer**（其他九人中归一化分路相同者）的均值对比，
//! 识别持续落后的维度，产出可验证的 [`store::HabitTag`]（路线图 §7.5-3）。
//!
//! 口径与纪律：
//! - 维度差统一「负 = 落后 peer」：正向维度（vision/cs/kills/assists/damage）
//!   取 `我 - peer 均值`；负向维度（deaths）取 `peer 均值 - 我`（死得多即落后）。
//! - 本机缺失 / 无同位置 peer 的局，该局整体跳过（宁缺毋滥，同 samples.rs）。
//! - 有效局数 `< MIN_GAMES`（5，验收线）不产标签；维度均值 ≥ 0 不产标签。
//! - `streak` = 从最近一局往回数连续落后的局数（近因）；`first/last_seen`
//!   取局时间（game_creation_date ISO 串，字典序即时间序）。

pub mod store;

use crate::backtest::samples::normalize_position;
use crate::lcu::api::match_history::Game;
use crate::lcu::api::model::{Participant, Stats};
use store::HabitTag;

/// 产出标签所需的最少有效对局数（验收：≥5 局）。
pub const MIN_GAMES: usize = 5;

/// 六个 L2 维度键（顺序即维度表顺序）。
pub const DIMENSIONS: [&str; 6] = ["vision", "cs", "deaths", "kills", "assists", "damage"];

/// 从单局统计取某维度原始值（缺失维度 → None，该局跳过该维度）。
fn dim_value(stats: &Stats, dim: &str) -> Option<i32> {
    match dim {
        "vision" => Some(stats.vision_score),
        "cs" => Some(stats.total_minions_killed + stats.neutral_minions_killed),
        "deaths" => Some(stats.deaths),
        "kills" => Some(stats.kills),
        "assists" => Some(stats.assists),
        "damage" => Some(stats.total_damage_dealt_to_champions),
        _ => None,
    }
}

/// 定位本机参与者（口径同 samples.rs：identity 按 participantId 对齐，找不到退回同索引）。
fn my_participant(game: &Game, my_puuid: &str) -> Option<&Participant> {
    let identities = &game.game_detail.participant_identities;
    let idx = identities.iter().position(|i| i.player.puuid == my_puuid)?;
    game.game_detail
        .participants
        .iter()
        .find(|p| p.participant_id == idx as i32 + 1)
        .or_else(|| game.game_detail.participants.get(idx))
}

/// 单局六维差值（负 = 落后 peer）；本机缺失或局内无同位置 peer → None（整局跳过）。
fn game_deltas(game: &Game, my_puuid: &str) -> Option<[f64; 6]> {
    let my = my_participant(game, my_puuid)?;
    let (lane, role) = match &my.timeline {
        Some(t) => (t.lane.as_str(), t.role.as_str()),
        None => ("", ""),
    };
    let position = normalize_position(lane, role)?;
    let peers: Vec<&Participant> = game
        .game_detail
        .participants
        .iter()
        .filter(|p| p.participant_id != my.participant_id)
        .filter(|p| {
            p.timeline
                .as_ref()
                .and_then(|t| normalize_position(&t.lane, &t.role))
                == Some(position)
        })
        .collect();
    if peers.is_empty() {
        return None;
    }
    let mut deltas = [0.0f64; 6];
    for (i, dim) in DIMENSIONS.iter().enumerate() {
        let my_v = dim_value(&my.stats, dim)? as f64;
        let peer_mean = peers
            .iter()
            .map(|p| dim_value(&p.stats, dim).unwrap_or_default() as f64)
            .sum::<f64>()
            / peers.len() as f64;
        deltas[i] = if dim == "deaths" {
            peer_mean - my_v
        } else {
            my_v - peer_mean
        };
    }
    Some(deltas)
}

/// 聚合产出习惯标签（时间升序的 games 输入）：不足 MIN_GAMES 或无落后维度 → 空。
pub fn aggregate_habit_tags(games: &[Game], my_puuid: &str) -> Vec<HabitTag> {
    let mut samples: Vec<Vec<(f64, String)>> = vec![Vec::new(); DIMENSIONS.len()];
    for game in games {
        let Some(deltas) = game_deltas(game, my_puuid) else {
            continue;
        };
        let stamp = game.game_creation_date.clone();
        for (i, bucket) in samples.iter_mut().enumerate() {
            bucket.push((deltas[i], stamp.clone()));
        }
    }
    DIMENSIONS
        .iter()
        .enumerate()
        .filter_map(|(i, dim)| {
            let bucket = &samples[i];
            if bucket.len() < MIN_GAMES {
                return None;
            }
            let avg = bucket.iter().map(|(d, _)| d).sum::<f64>() / bucket.len() as f64;
            if avg >= 0.0 {
                return None;
            }
            let streak = bucket.iter().rev().take_while(|(d, _)| *d < 0.0).count() as u32;
            Some(HabitTag {
                dimension: dim.to_string(),
                avg_vs_peer: (avg * 100.0).round() / 100.0,
                streak,
                first_seen: bucket.first().map(|(_, s)| s.clone()).unwrap_or_default(),
                last_seen: bucket.last().map(|(_, s)| s.clone()).unwrap_or_default(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::model::{Participant, ParticipantIdentity, Player};

    fn participant(
        id: i32,
        lane: &str,
        role: &str,
        vision: i32,
        cs: i32,
        deaths: i32,
        kills: i32,
    ) -> Participant {
        Participant {
            participant_id: id,
            team_id: if id <= 5 { 100 } else { 200 },
            timeline: Some(crate::lcu::api::model::ParticipantTimeline {
                lane: lane.to_string(),
                role: role.to_string(),
            }),
            stats: crate::lcu::api::model::Stats {
                vision_score: vision,
                total_minions_killed: cs,
                neutral_minions_killed: 0,
                deaths,
                kills,
                assists: 0,
                total_damage_dealt_to_champions: 0,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    /// 一局：蓝 5 人 vs 红 5 人，全部 MID；p1 = 本机，其余 peer。
    fn mid_game(id: i64, stamp: &str, my_vision: i32) -> Game {
        let mut participants = Vec::new();
        for i in 1..=10 {
            let vision = if i == 1 { my_vision } else { 40 };
            participants.push(participant(i, "MID", "SOLO", vision, 200, 5, 8));
        }
        let mut game = Game::default();
        game.game_id = id;
        game.game_creation_date = stamp.to_string();
        game.game_detail.participants = participants;
        game.game_detail.participant_identities = (1..=10)
            .map(|i| ParticipantIdentity {
                participant_id: i,
                player: Player {
                    puuid: if i == 1 {
                        "me".to_string()
                    } else {
                        format!("u{i}")
                    },
                    ..Default::default()
                },
            })
            .collect();
        game
    }

    #[test]
    fn aggregates_consistent_weakness_into_tags() {
        let stamps = [
            "2026-08-01T00:00:00Z",
            "2026-08-02T00:00:00Z",
            "2026-08-03T00:00:00Z",
            "2026-08-04T00:00:00Z",
            "2026-08-05T00:00:00Z",
            "2026-08-06T00:00:00Z",
        ];
        // 前 5 局视力 20 < peer 40；第 6 局 60 领先 → 均值仍落后，streak=1（近因回正）
        let games: Vec<Game> = stamps
            .iter()
            .enumerate()
            .map(|(i, s)| mid_game(i as i64 + 1, s, if i < 5 { 20 } else { 60 }))
            .collect();
        let tags = aggregate_habit_tags(&games, "me");
        let vision = tags.iter().find(|t| t.dimension == "vision");
        assert!(vision.is_some(), "持续落后应出标签");
        let v = vision.unwrap();
        assert!(v.avg_vs_peer < 0.0);
        assert_eq!(v.avg_vs_peer, -6.0, "(20*5+60)/6 - 40");
        assert_eq!(v.streak, 1, "最近一局已回正");
        assert_eq!(v.first_seen, "2026-08-01T00:00:00Z");
        assert_eq!(v.last_seen, "2026-08-06T00:00:00Z");
        assert!(
            !tags.iter().any(|t| t.dimension == "cs"),
            "cs 与 peer 持平不产标签"
        );
    }

    #[test]
    fn streak_counts_consecutive_behind_from_latest() {
        let stamps = [
            "2026-08-01T00:00:00Z",
            "2026-08-02T00:00:00Z",
            "2026-08-03T00:00:00Z",
            "2026-08-04T00:00:00Z",
            "2026-08-05T00:00:00Z",
            "2026-08-06T00:00:00Z",
        ];
        let games: Vec<Game> = stamps
            .iter()
            .enumerate()
            .map(|(i, s)| mid_game(i as i64 + 1, s, if i >= 3 { 20 } else { 40 }))
            .collect();
        let tags = aggregate_habit_tags(&games, "me");
        let v = tags.iter().find(|t| t.dimension == "vision").unwrap();
        assert_eq!(v.streak, 3, "最近连续 3 局落后");
        assert_eq!(v.first_seen, "2026-08-04T00:00:00Z", "首次检出在连续段起点");
    }

    #[test]
    fn below_min_games_returns_empty() {
        let games: Vec<Game> = (1..=4)
            .map(|i| mid_game(i, &format!("2026-08-0{i}T00:00:00Z"), 10))
            .collect();
        assert!(
            aggregate_habit_tags(&games, "me").is_empty(),
            "不足 5 局不产标签"
        );
    }

    #[test]
    fn game_without_me_or_peer_is_skipped() {
        let stamps = [
            "2026-08-01T00:00:00Z",
            "2026-08-02T00:00:00Z",
            "2026-08-03T00:00:00Z",
            "2026-08-04T00:00:00Z",
            "2026-08-05T00:00:00Z",
        ];
        let mut games: Vec<Game> = stamps
            .iter()
            .enumerate()
            .map(|(i, s)| mid_game(i as i64 + 1, s, 20))
            .collect();
        // 第 3 局把本机 lane 改成 TOP（无同位置 peer 则整局跳过）——本机在 MID 时
        // 同队/对方都有 MID，这里改成无 peers 的独行位置。
        games[2].game_detail.participants[0].timeline =
            Some(crate::lcu::api::model::ParticipantTimeline {
                lane: "TOP".to_string(),
                role: "SOLO".to_string(),
            });
        let tags = aggregate_habit_tags(&games, "me");
        assert!(tags.is_empty(), "4 有效局 < 5，且被跳过的局不产生样本");
    }

    #[test]
    fn deaths_dimension_is_inverted() {
        let mut game = mid_game(1, "2026-08-01T00:00:00Z", 40);
        // 本机死 12 次，peer 平均 5 → peer_mean - my = 5 - 12 = -7 < 0（落后）
        game.game_detail.participants[0].stats.deaths = 12;
        let stamps = [
            "2026-08-01T00:00:00Z",
            "2026-08-02T00:00:00Z",
            "2026-08-03T00:00:00Z",
            "2026-08-04T00:00:00Z",
            "2026-08-05T00:00:00Z",
        ];
        let mut games: Vec<Game> = stamps
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let mut g = game.clone();
                g.game_id = i as i64 + 1;
                g.game_creation_date = s.to_string();
                g
            })
            .collect();
        for g in games.iter_mut().skip(1) {
            g.game_detail.participants[0].stats.deaths = 12;
        }
        let tags = aggregate_habit_tags(&games, "me");
        let d = tags.iter().find(|t| t.dimension == "deaths").unwrap();
        assert!(d.avg_vs_peer < 0.0, "死得多应落后");
        assert_eq!(d.avg_vs_peer, -7.0);
    }
}
