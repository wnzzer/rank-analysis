//! # 本地对位样本沉淀（backtest/samples，主链 ADR-6）
//!
//! 回测胜率基准主链 = 本机历史（路线图 §6.5.2）：从 `meet.db` 的
//! collected_games 提取**本机玩家**每局一条样本
//! `(champion, position, enemy_champion, win, score)`，增量入库
//! `local_samples` 表（backtest.db）。本机玩家不在局内（收集的是别人的
//! 局）→ 该局不产生样本，宁缺毋滥不编造。
//!
//! score 口径与战绩页一致（17 分制 [`crate::command::score`]）；position
//! 由 timeline.lane/role 归一化到 SGP 五档（TOP/JUNGLE/MIDDLE/BOTTOM/
//! UTILITY），无法归一化（NONE/空）→ 该局不出样本。

use std::collections::HashSet;

use crate::backtest::store::{self, LocalSample};
use crate::command::score::{score_participants, PlayerScoreInput};
use crate::lcu::api::match_history::Game;

/// lane/role → SGP 五档 position；无法归一化 → None（该局不出样本）。
/// pub(crate)：对账命令（command/backtest.rs）复用同一口径。
pub(crate) fn normalize_position(lane: &str, role: &str) -> Option<&'static str> {
    match (lane, role) {
        ("MID", _) | ("MIDDLE", _) => Some("MIDDLE"),
        ("TOP", _) => Some("TOP"),
        ("JUNGLE", _) => Some("JUNGLE"),
        ("BOTTOM", "DUO_SUPPORT") | ("UTILITY", _) => Some("UTILITY"),
        ("BOTTOM", _) => Some("BOTTOM"),
        _ => None,
    }
}

/// 从一局收集数据提取"本机玩家"的样本（一局一条；提取不出 → None）。
fn extract_my_sample(game: &Game, my_puuid: &str) -> Option<LocalSample> {
    let identities = &game.game_detail.participant_identities;
    let identity_idx = identities.iter().position(|i| i.player.puuid == my_puuid)?;
    // participantId 从 1 起且 identity 数组按 participantId 顺序（与前端
    // buildScoreInputsFromGame 同款对齐），找不到再退回同索引。
    let my = game
        .game_detail
        .participants
        .iter()
        .find(|p| p.participant_id == identity_idx as i32 + 1)
        .or_else(|| game.game_detail.participants.get(identity_idx))?;
    let (lane, role) = match &my.timeline {
        Some(t) => (t.lane.as_str(), t.role.as_str()),
        None => ("", ""),
    };
    let position = normalize_position(lane, role)?;
    // 敌方同分路玩家（归一化后同值）；敌方没有同分路 → 不出样本（宁缺毋滥）。
    let enemy = game
        .game_detail
        .participants
        .iter()
        .find(|p| {
            p.team_id != my.team_id
                && p.timeline
                    .as_ref()
                    .and_then(|t| normalize_position(&t.lane, &t.role))
                    == Some(position)
        })
        .map(|p| p.champion_id)?;
    let input = PlayerScoreInput {
        participant_id: my.participant_id,
        champion_id: my.champion_id,
        team_id: my.team_id,
        puuid: my_puuid.to_string(),
        summoner_name: String::new(),
        win: my.stats.win,
        kills: my.stats.kills,
        deaths: my.stats.deaths,
        assists: my.stats.assists,
        gold_earned: my.stats.gold_earned,
        damage_dealt_to_champions: my.stats.total_damage_dealt_to_champions,
        damage_taken: my.stats.total_damage_taken,
        total_heal: my.stats.total_heal,
        cs: my.stats.total_minions_killed + my.stats.neutral_minions_killed,
        vision_score: my.stats.vision_score,
        game_duration: game.game_duration,
    };
    let score = score_participants(&[input])
        .first()
        .map(|s| s.total)
        .unwrap_or(0.0);
    Some(LocalSample {
        game_id: game.game_id,
        champion_id: my.champion_id,
        position: position.to_string(),
        enemy_champion_id: enemy,
        win: my.stats.win,
        score,
    })
}

/// 纯函数：从一批对局中挑出尚未入库（不在 `known`）的样本，供调用方落库。
/// `impl Trait` 内匿名生命周期在 CI 固定 toolchain 上不稳定（E0658），
/// 显式 `'a` 是必要写法，clippy 的省略建议在此不适用。
#[allow(clippy::needless_lifetimes)]
fn extract_missing_samples<'a>(
    games: impl Iterator<Item = &'a Game>,
    my_puuid: &str,
    known: &HashSet<i64>,
) -> Vec<LocalSample> {
    let mut out = Vec::new();
    for game in games {
        if known.contains(&game.game_id) {
            continue;
        }
        if let Some(sample) = extract_my_sample(game, my_puuid) {
            out.push(sample);
        }
    }
    out
}

/// 增量刷新本地样本库（全局库：meet.db 全量收集 → backtest.db 样本表）。
/// 返回新增样本数（重复局/无法提取的局不计入）。
pub fn refresh_local_samples(my_puuid: &str) -> usize {
    let known: HashSet<i64> = store::known_sample_game_ids();
    let collected = crate::meet_db::all_collected_games();
    let samples = extract_missing_samples(
        collected.iter().flat_map(|(_region, _name, games)| games),
        my_puuid,
        &known,
    );
    let count = samples.len();
    for sample in samples {
        store::upsert_sample(&sample);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::model::{
        Participant, ParticipantIdentity, ParticipantTimeline, Player, Stats,
    };

    fn identity(puuid: &str) -> ParticipantIdentity {
        ParticipantIdentity {
            player: Player {
                puuid: puuid.to_string(),
                ..Default::default()
            },
        }
    }

    fn participant(id: i32, team: i32, champ: i32, lane: &str, role: &str) -> Participant {
        Participant {
            participant_id: id,
            team_id: team,
            champion_id: champ,
            timeline: Some(ParticipantTimeline {
                lane: lane.to_string(),
                role: role.to_string(),
            }),
            stats: Stats {
                win: team == 100,
                kills: 5,
                deaths: 3,
                assists: 7,
                gold_earned: 12_000,
                total_damage_dealt_to_champions: 25_000,
                total_damage_taken: 15_000,
                total_heal: 8_000,
                total_minions_killed: 180,
                neutral_minions_killed: 20,
                vision_score: 30,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    /// 10 人标准局：蓝队 1-5 / 红队 6-10，puuid 用 "p{id}"。
    fn ten_man_game(game_id: i64, my_puuid: &str) -> Game {
        let mut participants = Vec::new();
        let mut identities = Vec::new();
        for id in 1..=10 {
            let team = if id <= 5 { 100 } else { 200 };
            let (lane, role) = match id {
                1 | 6 => ("TOP", "SOLO"),
                2 | 7 => ("JUNGLE", "NONE"),
                3 | 8 => ("MID", "SOLO"),
                4 | 9 => ("BOTTOM", "DUO_CARRY"),
                _ => ("BOTTOM", "DUO_SUPPORT"),
            };
            let puuid = if id == 3 {
                my_puuid.to_string()
            } else {
                format!("p{id}")
            };
            participants.push(participant(id, team, 100 + id, lane, role));
            identities.push(identity(&puuid));
        }
        Game {
            game_id,
            game_duration: 1800,
            game_detail: crate::lcu::api::game_detail::GameDetail {
                participants,
                participant_identities: identities,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn normalize_position_maps_five_lanes() {
        assert_eq!(normalize_position("MID", "SOLO"), Some("MIDDLE"));
        assert_eq!(normalize_position("TOP", "SOLO"), Some("TOP"));
        assert_eq!(normalize_position("JUNGLE", "NONE"), Some("JUNGLE"));
        assert_eq!(normalize_position("BOTTOM", "DUO_SUPPORT"), Some("UTILITY"));
        assert_eq!(normalize_position("UTILITY", "NONE"), Some("UTILITY"));
        assert_eq!(normalize_position("BOTTOM", "DUO_CARRY"), Some("BOTTOM"));
        assert_eq!(normalize_position("", ""), None);
        assert_eq!(normalize_position("NONE", "NONE"), None);
    }

    #[test]
    fn extracts_my_sample_with_enemy_lane_opponent() {
        let game = ten_man_game(101, "p3");
        let s = extract_my_sample(&game, "p3").expect("本机在中路应产出样本");
        assert_eq!(s.game_id, 101);
        assert_eq!(s.champion_id, 103, "我的英雄");
        assert_eq!(s.position, "MIDDLE");
        assert_eq!(s.enemy_champion_id, 108, "敌方中单（id 8 → champion 108）");
        assert!(s.win, "蓝队（id 3）胜");
        assert!(s.score > 0.0, "score 应来自 17 分制");
    }

    #[test]
    fn my_puuid_absent_returns_none() {
        let game = ten_man_game(102, "p3");
        assert!(
            extract_my_sample(&game, "ghost").is_none(),
            "本机不在局内 → 无样本"
        );
    }

    #[test]
    fn missing_timeline_returns_none() {
        let mut game = ten_man_game(103, "p3");
        game.game_detail.participants[2].timeline = None;
        assert!(
            extract_my_sample(&game, "p3").is_none(),
            "无分路 → 宁缺毋滥"
        );
    }

    #[test]
    fn refresh_skips_known_games_and_counts_new() {
        let game = ten_man_game(104, "p3");
        let known: HashSet<i64> = [104].into_iter().collect();
        assert!(extract_missing_samples([&game].into_iter(), "p3", &known).is_empty());
        let known_empty = HashSet::new();
        let out = extract_missing_samples([&game].into_iter(), "p3", &known_empty);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].game_id, 104);
    }
}
