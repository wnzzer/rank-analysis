//! # 对局快照：玩家 / 队伍部分（TS `snapshot.ts#buildMatchSnapshot`）
//!
//! P1 对外入口 [`build_snapshot`]。序列化字段名与 TS 一致（camelCase），与
//! `scripts/parity/golden.eval.ts` 的 P1 子集逐字段对拍：
//! - 在内：gameId / queueName / queueId / gameMode / mapId / durationSeconds / modeContext / teams / players
//! - 延后：`timeline`（卡片与队伍上下文 P2；阵亡归责与时间线指标 P3）
//! - 不在本子项目：`players[].recentProfile`（仅 AI 提示词路径传 profileMap 时有值）

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::input::{MatchInput, PlayerInput, PlayerStats};
use super::js::js_fixed_num;
use super::lane_facts::{compute_vs_lane_opponent, LaneFactPlayer, VsLaneOpponent};
use super::mode::{classify_mode, ModeContext};
use super::position::{resolve_positions, TeamPosition};

/// 符文：基石（perk0）与副系
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Perks {
    pub primary: i64,
    pub sub_style: i64,
}

/// 多杀次数
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct MultiKills {
    pub double: i64,
    pub triple: i64,
    pub quadra: i64,
    pub penta: i64,
}

/// 快照里的一名玩家（字段与顺序 = TS 玩家行，去掉 `recentProfile`）
///
/// - 百分比字段（`damage_share` 等）与 `kda` / `dpm` 等按 TS `Number(x.toFixed(d))` 取整
/// - `objective_damage` / `cc_seconds` / `ward_score`：SGP 值优先，其次 LCU，都无为 `None`
/// - `control_wards_placed` 读 LCU `sightWardsBoughtInGame`、`vision_wards_bought` 读
///   `visionWardsBoughtInGame`（照搬 TS，见计划「TS 疑似问题」）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPlayer {
    pub participant_id: i64,
    pub team_id: i64,
    pub name: String,
    pub champion: String,
    pub champion_id: i64,
    pub is_me: bool,
    pub win: bool,
    pub kda: f64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub gold: i64,
    pub cs: i64,
    pub damage: i64,
    pub taken: i64,
    pub heal: i64,
    pub turret_damage: i64,
    pub damage_share: f64,
    pub damage_taken_share: f64,
    pub gold_share: f64,
    pub kill_participation: f64,
    pub perks: Perks,
    pub augments: Vec<i64>,
    pub team_position: TeamPosition,
    pub lane: String,
    pub role: String,
    pub summoner_spells: Vec<String>,
    pub dpm: f64,
    pub gpm: f64,
    pub csm: f64,
    pub items: Vec<i64>,
    pub trinket_id: i64,
    pub objective_damage: Option<i64>,
    pub cc_seconds: Option<i64>,
    pub ward_score: Option<i64>,
    pub control_wards_placed: Option<i64>,
    pub vision_wards_bought: Option<i64>,
    pub multi_kills: MultiKills,
    pub vs_lane_opponent: Option<VsLaneOpponent>,
}

/// 队伍汇总；`players` 按 participantId 升序
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTeam {
    pub team_id: i64,
    /// `胜方` / `败方`
    pub result: String,
    pub total_kills: i64,
    pub total_deaths: i64,
    pub total_assists: i64,
    pub total_damage: i64,
    pub total_taken: i64,
    pub total_gold: i64,
    pub players: Vec<SnapshotPlayer>,
}

/// 快照（P1 子集）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchSnapshot {
    pub game_id: i64,
    pub queue_name: Option<String>,
    pub queue_id: i64,
    pub game_mode: String,
    pub map_id: i64,
    pub duration_seconds: i64,
    pub mode_context: ModeContext,
    /// 胜方在前（稳定排序）
    pub teams: Vec<SnapshotTeam>,
    /// 与输入同序
    pub players: Vec<SnapshotPlayer>,
}

impl From<&SnapshotPlayer> for LaneFactPlayer {
    fn from(p: &SnapshotPlayer) -> Self {
        LaneFactPlayer {
            participant_id: p.participant_id,
            team_id: p.team_id,
            name: p.name.clone(),
            champion: p.champion.clone(),
            team_position: p.team_position,
            kills: p.kills,
            deaths: p.deaths,
            kda: p.kda,
            gold: p.gold,
            cs: p.cs,
            damage_share: p.damage_share,
            gold_share: p.gold_share,
            kill_participation: p.kill_participation,
            damage_taken_share: p.damage_taken_share,
            csm: p.csm,
        }
    }
}

/// 每队累计（TS `teamTotals`）
#[derive(Debug, Clone, Copy, Default)]
struct TeamTotals {
    damage: i64,
    taken: i64,
    gold: i64,
    kills: i64,
}

/// TS `kda`：(击杀 + 助攻) / max(1, 死亡)
fn kda(s: &PlayerStats) -> f64 {
    (s.kills + s.assists) as f64 / s.deaths.max(1) as f64
}

/// TS `totalCs`：小兵 + 野怪
fn total_cs(s: &PlayerStats) -> i64 {
    s.total_minions_killed + s.neutral_minions_killed
}

/// TS `percentOf`：总量 ≤ 0 为 0，否则 `roundStat(value / total * 100)`（先除后乘，一位小数）
fn percent_of(value: i64, total: i64) -> f64 {
    if total <= 0 {
        return 0.0;
    }
    js_fixed_num((value as f64 / total as f64) * 100.0, 1)
}

/// TS `safePerMinute`：时长 ≤ 0 为 0，否则 `roundStat(value / (duration / 60), 1)`
fn safe_per_minute(value: i64, duration_seconds: i64) -> f64 {
    if duration_seconds <= 0 {
        return 0.0;
    }
    let minutes = duration_seconds as f64 / 60.0;
    js_fixed_num(value as f64 / minutes, 1)
}

/// TS `basePlayers.map(...)` 的单人部分（`vsLaneOpponent` 稍后填）
fn base_player(
    p: &PlayerInput,
    team_position: TeamPosition,
    totals: TeamTotals,
    mode: &ModeContext,
    duration_seconds: i64,
) -> SnapshotPlayer {
    let s = &p.stats;
    SnapshotPlayer {
        participant_id: p.participant_id,
        team_id: p.team_id,
        name: p.name.clone(),
        champion: p.champion_name.clone(),
        champion_id: p.champion_id,
        is_me: p.is_me,
        win: s.win,
        kda: js_fixed_num(kda(s), 2),
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        gold: s.gold_earned,
        cs: total_cs(s),
        damage: s.total_damage_dealt_to_champions,
        taken: s.total_damage_taken,
        heal: s.total_heal,
        turret_damage: s.damage_dealt_to_turrets,
        damage_share: percent_of(s.total_damage_dealt_to_champions, totals.damage),
        damage_taken_share: percent_of(s.total_damage_taken, totals.taken),
        gold_share: percent_of(s.gold_earned, totals.gold),
        kill_participation: percent_of(s.kills + s.assists, totals.kills.max(1)),
        perks: Perks {
            primary: s.perk0,
            sub_style: s.perk_sub_style,
        },
        augments: s.augments.iter().copied().filter(|&id| id > 0).collect(),
        team_position,
        lane: p.lane.clone(),
        role: p.role.clone(),
        summoner_spells: p.spell_names.clone(),
        dpm: safe_per_minute(s.total_damage_dealt_to_champions, duration_seconds),
        gpm: safe_per_minute(s.gold_earned, duration_seconds),
        csm: safe_per_minute(total_cs(s), duration_seconds),
        items: if mode.has_item_build {
            s.items.to_vec()
        } else {
            Vec::new()
        },
        trinket_id: s.trinket_id,
        objective_damage: p.sgp_objective_damage.or(s.damage_dealt_to_objectives),
        cc_seconds: p.sgp_cc_seconds.or(s.time_c_cing_others),
        ward_score: p.sgp_vision_score.or(s.vision_score),
        control_wards_placed: s.sight_wards_bought_in_game,
        vision_wards_bought: s.vision_wards_bought_in_game,
        multi_kills: MultiKills {
            double: s.double_kills,
            triple: s.triple_kills,
            quadra: s.quadra_kills,
            penta: s.penta_kills,
        },
        vs_lane_opponent: None,
    }
}

/// 队伍里排序后首人的胜负（TS 队伍排序键 `Number(players[0]?.win ?? false)`）
fn team_win(t: &SnapshotTeam) -> u8 {
    u8::from(t.players.first().is_some_and(|p| p.win))
}

/// TS `teams`：队伍按首次出现顺序，`result` 取参与者原序首人胜负，再按胜负稳定排序（胜方在前）
fn build_teams(players: &[SnapshotPlayer]) -> Vec<SnapshotTeam> {
    let mut team_ids: Vec<i64> = Vec::new();
    for p in players {
        if !team_ids.contains(&p.team_id) {
            team_ids.push(p.team_id);
        }
    }
    let mut teams: Vec<SnapshotTeam> = team_ids
        .into_iter()
        .map(|team_id| {
            let team_players: Vec<&SnapshotPlayer> =
                players.iter().filter(|p| p.team_id == team_id).collect();
            let first_win = team_players.first().is_some_and(|p| p.win);
            let mut sorted: Vec<SnapshotPlayer> = team_players.iter().copied().cloned().collect();
            sorted.sort_by_key(|p| p.participant_id);
            SnapshotTeam {
                team_id,
                result: if first_win { "胜方" } else { "败方" }.to_string(),
                total_kills: team_players.iter().map(|p| p.kills).sum(),
                total_deaths: team_players.iter().map(|p| p.deaths).sum(),
                total_assists: team_players.iter().map(|p| p.assists).sum(),
                total_damage: team_players.iter().map(|p| p.damage).sum(),
                total_taken: team_players.iter().map(|p| p.taken).sum(),
                total_gold: team_players.iter().map(|p| p.gold).sum(),
                players: sorted,
            }
        })
        .collect();
    teams.sort_by_key(|t| std::cmp::Reverse(team_win(t)));
    teams
}

/// 由中立输入组装快照的玩家 / 队伍部分（P1 对外入口）。
///
/// # 行为（与 TS 逐步一致）
/// 1. `classify_mode(queueId, gameMode)`
/// 2. 按队累计伤害 / 承伤 / 经济 / 击杀
/// 3. 分路 [`resolve_positions`]
/// 4. 逐人组装玩家行；有分路模式再按快照顺序算对位差值，无分路模式一律 `None`
/// 5. 队伍汇总与排序
///
/// # 示例
/// ```
/// use rank_analysis_lib::match_analysis::{build_snapshot, from_lcu, NameTable};
/// use rank_analysis_lib::match_analysis::input::LcuGame;
/// let game: LcuGame = serde_json::from_str(r#"{"gameId":1,"queueId":450,"gameMode":"ARAM"}"#).unwrap();
/// let snap = build_snapshot(&from_lcu(&game, None, &NameTable::default()));
/// assert!(snap.players.is_empty());
/// assert!(!snap.mode_context.has_lanes);
/// ```
pub fn build_snapshot(input: &MatchInput) -> MatchSnapshot {
    let mode_context = classify_mode(input.queue_id, &input.game_mode);
    let duration_seconds = input.duration_seconds;

    let mut team_totals: HashMap<i64, TeamTotals> = HashMap::new();
    for p in &input.players {
        let t = team_totals.entry(p.team_id).or_default();
        t.damage += p.stats.total_damage_dealt_to_champions;
        t.taken += p.stats.total_damage_taken;
        t.gold += p.stats.gold_earned;
        t.kills += p.stats.kills;
    }

    let positions = resolve_positions(&input.players, mode_context.has_lanes, input.queue_id);
    let base: Vec<SnapshotPlayer> = input
        .players
        .iter()
        .zip(positions)
        .map(|(p, pos)| {
            let totals = team_totals.get(&p.team_id).copied().unwrap_or_default();
            base_player(p, pos, totals, &mode_context, duration_seconds)
        })
        .collect();

    let lane_view: Vec<LaneFactPlayer> = base.iter().map(LaneFactPlayer::from).collect();
    let players: Vec<SnapshotPlayer> = base
        .into_iter()
        .zip(&lane_view)
        .map(|(mut p, view)| {
            p.vs_lane_opponent = if mode_context.has_lanes {
                compute_vs_lane_opponent(view, &lane_view)
            } else {
                None
            };
            p
        })
        .collect();

    let teams = build_teams(&players);

    MatchSnapshot {
        game_id: input.game_id,
        queue_name: input.queue_name.clone(),
        queue_id: input.queue_id,
        game_mode: input.game_mode.clone(),
        map_id: input.map_id,
        duration_seconds,
        mode_context,
        teams,
        players,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::timeline::{SlimParticipant, SlimTimeline};
    use crate::match_analysis::input::{from_lcu, LcuGame, NameTable};
    use crate::match_analysis::mode::ModeKind;
    use crate::match_analysis::test_support::{
        make_scoring_game, make_scoring_timeline, merge_shallow, regression_fixture,
    };
    use serde_json::{json, Value};
    use TeamPosition::{Bottom, Jungle, Middle, Top, Utility};

    // ── snapshot.spec.ts 的构造器 ──
    fn base_stats() -> Value {
        json!({
            "win": true, "kills": 5, "deaths": 3, "assists": 7,
            "totalDamageDealtToChampions": 25000, "totalDamageTaken": 18000, "goldEarned": 12000,
            "totalMinionsKilled": 100, "neutralMinionsKilled": 80, "totalHeal": 1000,
            "damageDealtToTurrets": 3000, "perk0": 8005, "perkSubStyle": 8200,
            "playerAugment1": 0, "playerAugment2": 0, "playerAugment3": 0,
            "playerAugment4": 0, "playerAugment5": 0, "playerAugment6": 0,
            "item0": 1001, "item1": 1018, "item2": 1031, "item3": 1037, "item4": 1042, "item5": 0,
            "item6": 3340, "doubleKills": 0, "tripleKills": 0, "quadraKills": 0, "pentaKills": 0,
            "visionScore": 25, "sightWardsBoughtInGame": 0, "visionWardsBoughtInGame": 2
        })
    }

    fn stats_with(overrides: Value) -> Value {
        let mut s = base_stats();
        merge_shallow(&mut s, overrides);
        s
    }

    /// TS `makeParticipant(overrides)`：浅合并，`null` 表示 TS 的 `undefined`
    fn make_participant(overrides: Value) -> Value {
        let mut p = json!({
            "participantId": 1, "teamId": 100, "championId": 64, "spell1Id": 4, "spell2Id": 11,
            "stats": base_stats(),
            "timeline": { "lane": "JUNGLE", "role": "NONE" },
            "teamPosition": "JUNGLE"
        });
        merge_shallow(&mut p, overrides);
        p
    }

    /// TS `makeGame`（无 mapId、无 gameDetail，单个身份 Test#1234）
    fn make_game(queue_id: i64, game_mode: &str, duration: i64, participants: Vec<Value>) -> Value {
        json!({
            "gameId": 1, "queueId": queue_id, "gameMode": game_mode, "gameDuration": duration,
            "queueName": "排位", "participants": participants,
            "participantIdentities": [
                { "participantId": 1, "player": { "gameName": "Test", "tagLine": "1234", "puuid": "p1" } }
            ]
        })
    }

    fn default_game() -> Value {
        make_game(420, "CLASSIC", 1800, vec![make_participant(json!({}))])
    }

    fn snapshot_with(game: Value, tl: Option<&SlimTimeline>) -> MatchSnapshot {
        let g: LcuGame = serde_json::from_value(game).expect("测试对局可解析");
        build_snapshot(&from_lcu(&g, tl, &NameTable::default()))
    }

    fn snapshot(game: Value) -> MatchSnapshot {
        snapshot_with(game, None)
    }

    // ═════ snapshot.spec.ts ═════
    #[test]
    fn should_return_ranked_mode_kind() {
        assert_eq!(snapshot(default_game()).mode_context.kind, ModeKind::Ranked);
    }

    #[test]
    fn should_return_augment_mode_kind_for_cherry() {
        let snap = snapshot(make_game(
            1700,
            "CHERRY",
            1800,
            vec![make_participant(json!({}))],
        ));
        assert_eq!(snap.mode_context.kind, ModeKind::Augment);
        assert!(snap.mode_context.is_team_mode);
    }

    #[test]
    fn should_return_aram_mode_kind_for_450() {
        let snap = snapshot(make_game(
            450,
            "ARAM",
            1800,
            vec![make_participant(json!({}))],
        ));
        assert_eq!(snap.mode_context.kind, ModeKind::Aram);
    }

    #[test]
    fn should_compute_per_minute_metrics() {
        let p = &snapshot(default_game()).players[0];
        // TS toBeCloseTo(x, 0)：|差| < 0.5
        assert!((p.dpm - 25000.0 / 30.0).abs() < 0.5);
        assert!((p.gpm - 12000.0 / 30.0).abs() < 0.5);
        assert!((p.csm - 180.0 / 30.0).abs() < 0.5);
    }

    #[test]
    fn should_handle_zero_duration_safely() {
        let p = &snapshot(make_game(
            420,
            "CLASSIC",
            0,
            vec![make_participant(json!({}))],
        ))
        .players[0];
        assert_eq!(p.dpm, 0.0);
        assert_eq!(p.gpm, 0.0);
    }

    #[test]
    fn should_convert_spell_ids_to_chinese_names() {
        assert_eq!(
            snapshot(default_game()).players[0].summoner_spells,
            vec!["闪现", "惩戒"]
        );
    }

    #[test]
    fn should_pass_through_team_position_lane_role() {
        let p = &snapshot(default_game()).players[0];
        assert_eq!(p.team_position, Jungle);
        assert_eq!(p.lane, "JUNGLE");
        assert_eq!(p.role, "NONE");
    }

    #[test]
    fn should_leave_vision_fields_null_when_lcu_lacks_them() {
        let mut p = make_participant(json!({}));
        let stats = p["stats"].as_object_mut().unwrap();
        stats.remove("visionScore");
        stats.remove("sightWardsBoughtInGame");
        stats.remove("visionWardsBoughtInGame");
        let snap = snapshot(make_game(420, "CLASSIC", 1800, vec![p]));
        assert_eq!(snap.players[0].ward_score, None);
        assert_eq!(snap.players[0].control_wards_placed, None);
        assert_eq!(snap.players[0].vision_wards_bought, None);
    }

    #[test]
    fn should_pass_through_ward_score_when_present() {
        assert_eq!(snapshot(default_game()).players[0].ward_score, Some(25));
    }

    #[test]
    fn should_infer_position_from_spells_when_lcu_lacks_it() {
        let jungler =
            make_participant(json!({ "teamPosition": null, "spell1Id": 11, "spell2Id": 4 }));
        let adc = make_participant(json!({
            "participantId": 2, "teamPosition": null, "championId": 21, "spell1Id": 7, "spell2Id": 4
        }));
        let snap = snapshot(make_game(420, "CLASSIC", 1800, vec![jungler, adc]));
        assert_eq!(snap.players[0].team_position, Jungle);
        assert_eq!(snap.players[1].team_position, Bottom);
    }

    #[test]
    fn should_solve_whole_team_positions_in_laned_mode() {
        let mk = |id: i64, champ: i64, s1: i64, s2: i64, cs: i64, jg: i64| {
            make_participant(json!({
                "participantId": id, "teamPosition": null, "championId": champ,
                "spell1Id": s1, "spell2Id": s2,
                "stats": stats_with(json!({ "totalMinionsKilled": cs, "neutralMinionsKilled": jg }))
            }))
        };
        let team = || {
            vec![
                mk(1, 23, 14, 6, 206, 4),
                mk(2, 104, 11, 4, 32, 164),
                mk(3, 236, 4, 1, 150, 0),
                mk(4, 112, 4, 12, 175, 0),
                mk(5, 147, 4, 14, 50, 0),
            ]
        };
        let blind = snapshot(make_game(430, "CLASSIC", 1800, team()));
        let pos: Vec<TeamPosition> = blind.players.iter().map(|p| p.team_position).collect();
        assert_eq!(pos, vec![Top, Jungle, Bottom, Middle, Utility]);
        let ranked = snapshot(make_game(420, "CLASSIC", 1800, team()));
        let pos: Vec<TeamPosition> = ranked.players.iter().map(|p| p.team_position).collect();
        assert_eq!(pos, vec![Top, Jungle, Middle, Bottom, Utility]);
    }

    #[test]
    fn should_precompute_lane_opponent_diff() {
        let mk = |id: i64, team: i64, s1: i64, cs: i64, jg: i64, gold: i64| {
            make_participant(json!({
                "participantId": id, "teamId": team, "teamPosition": null,
                "spell1Id": s1, "spell2Id": 4,
                "stats": stats_with(json!({
                    "totalMinionsKilled": cs, "neutralMinionsKilled": jg, "goldEarned": gold
                }))
            }))
        };
        let mut participants: Vec<Value> = (1..=5_i64)
            .map(|i| {
                let jg = i == 2;
                mk(
                    i,
                    100,
                    if jg { 11 } else { 14 },
                    if jg { 40 } else { 200 - i * 10 },
                    if jg { 200 } else { 0 },
                    10000 + i,
                )
            })
            .collect();
        participants.extend((6..=10_i64).map(|i| {
            let jg = i == 7;
            mk(
                i,
                200,
                if jg { 11 } else { 14 },
                if jg { 40 } else { 200 - i * 10 },
                if jg { 200 } else { 0 },
                9000 + i,
            )
        }));
        let snap = snapshot(make_game(420, "CLASSIC", 1800, participants));
        let p2 = snap.players.iter().find(|p| p.participant_id == 2).unwrap();
        assert_eq!(p2.team_position, Jungle);
        let vs = p2.vs_lane_opponent.as_ref().expect("有对位");
        assert_eq!(vs.gold_diff, 10002 - 9007);
        assert_eq!(vs.cs_diff, 0);
    }

    #[test]
    fn should_not_give_lane_opponent_without_lanes() {
        let snap = snapshot(make_game(
            450,
            "ARAM",
            1800,
            vec![make_participant(json!({}))],
        ));
        assert_eq!(snap.players[0].vs_lane_opponent, None);
    }

    #[test]
    fn should_keep_real_lcu_team_position_over_exclusion() {
        let mk = |id: i64, champ: i64, tp: Value, cs: i64, jg: i64| {
            make_participant(json!({
                "participantId": id, "teamPosition": tp, "championId": champ,
                "stats": stats_with(json!({ "totalMinionsKilled": cs, "neutralMinionsKilled": jg }))
            }))
        };
        let team = vec![
            mk(1, 23, json!("MIDDLE"), 206, 4),
            mk(2, 104, Value::Null, 32, 164),
            mk(3, 236, Value::Null, 150, 0),
            mk(4, 112, Value::Null, 175, 0),
            mk(5, 147, Value::Null, 50, 0),
        ];
        let snap = snapshot(make_game(420, "CLASSIC", 1800, team));
        assert_eq!(snap.players[0].team_position, Middle);
    }

    #[test]
    fn should_pass_through_multi_kills() {
        let p = make_participant(json!({
            "stats": stats_with(json!({ "doubleKills": 3, "tripleKills": 2, "quadraKills": 1, "pentaKills": 1 }))
        }));
        let snap = snapshot(make_game(420, "CLASSIC", 1800, vec![p]));
        assert_eq!(
            snap.players[0].multi_kills,
            MultiKills {
                double: 3,
                triple: 2,
                quadra: 1,
                penta: 1
            }
        );
    }

    #[test]
    fn should_default_multi_kills_to_zero_when_missing() {
        let mut p = make_participant(json!({}));
        let stats = p["stats"].as_object_mut().unwrap();
        for k in ["doubleKills", "tripleKills", "quadraKills", "pentaKills"] {
            stats.remove(k);
        }
        let snap = snapshot(make_game(420, "CLASSIC", 1800, vec![p]));
        assert_eq!(
            snap.players[0].multi_kills,
            MultiKills {
                double: 0,
                triple: 0,
                quadra: 0,
                penta: 0
            }
        );
    }

    #[test]
    fn should_empty_items_in_augment_mode() {
        let snap = snapshot(make_game(
            2400,
            "ARAM",
            1800,
            vec![make_participant(json!({}))],
        ));
        assert!(snap.players[0].items.is_empty());
    }

    #[test]
    fn should_list_six_items_outside_augment_mode() {
        assert_eq!(
            snapshot(default_game()).players[0].items,
            vec![1001, 1018, 1031, 1037, 1042, 0]
        );
    }

    #[test]
    fn should_default_recent_profile_to_null() {
        // P1 不输出 recentProfile：序列化里该键缺失，按对拍规则 ≡ null
        let v = serde_json::to_value(&snapshot(default_game()).players[0]).unwrap();
        assert!(v["recentProfile"].is_null());
    }

    // ═════ snapshotPositions.spec.ts（回归局 B） ═════
    const TRUTH: [TeamPosition; 10] = [
        Top, Jungle, Middle, Bottom, Utility, Top, Jungle, Middle, Bottom, Utility,
    ];

    fn positions_b(tl: Option<&SlimTimeline>) -> Vec<TeamPosition> {
        let (game, _) = regression_fixture('b');
        let snap = build_snapshot(&from_lcu(&game, tl, &NameTable::default()));
        let mut players = snap.players.clone();
        players.sort_by_key(|p| p.participant_id);
        players.iter().map(|p| p.team_position).collect()
    }

    fn with_positions(slim: &SlimTimeline, f: impl Fn(&SlimParticipant) -> String) -> SlimTimeline {
        let mut out = slim.clone();
        for p in &mut out.participants {
            p.team_position = f(p);
        }
        out
    }

    #[test]
    fn should_infer_slot_positions_without_timeline() {
        assert_eq!(positions_b(None), TRUTH.to_vec());
    }

    #[test]
    fn should_override_all_with_sgp_truth() {
        let (_, slim) = regression_fixture('b');
        assert_eq!(positions_b(Some(&slim)), TRUTH.to_vec());
    }

    #[test]
    fn should_not_override_with_blank_or_invalid_truth() {
        let (_, slim) = regression_fixture('b');
        let blank = with_positions(&slim, |p| {
            if p.participant_id == 9 {
                "NONE".to_string()
            } else {
                String::new()
            }
        });
        assert_eq!(positions_b(Some(&blank)), positions_b(None));
    }

    #[test]
    fn should_prefer_sgp_truth_over_inference() {
        let (_, slim) = regression_fixture('b');
        let swapped = with_positions(&slim, |p| match p.participant_id {
            8 => "BOTTOM".to_string(),
            9 => "MIDDLE".to_string(),
            _ => p.team_position.clone(),
        });
        let pos = positions_b(Some(&swapped));
        assert_eq!((pos[7], pos[8]), (Bottom, Middle));
    }

    // P1-F1：回归局 A 改成队列 400，不给时间线（无 SGP 真值），分路必须来自选秀槽位
    #[test]
    fn should_assign_slot_positions_for_normal_draft_400() {
        let (mut game, _) = regression_fixture('a');
        game.queue_id = 400;
        let snap = build_snapshot(&from_lcu(&game, None, &NameTable::default()));
        assert!(snap.mode_context.has_lanes);
        let mut players = snap.players.clone();
        players.sort_by_key(|p| p.participant_id);
        let pos: Vec<TeamPosition> = players.iter().map(|p| p.team_position).collect();
        assert_eq!(pos, TRUTH.to_vec());
        assert!(players.iter().all(|p| p.vs_lane_opponent.is_some()));
    }

    // ═════ snapshotScoring.spec.ts ═════
    fn with_sgp() -> SlimTimeline {
        let mut tl = make_scoring_timeline();
        tl.participants = vec![SlimParticipant {
            participant_id: 3,
            puuid: "puuid-3".to_string(),
            team_position: String::new(),
            vision_score: Some(55),
            damage_dealt_to_objectives: Some(777),
            time_c_cing_others: Some(42),
        }];
        tl
    }

    #[test]
    fn should_carry_champion_id_objective_damage_and_cc() {
        let snap = snapshot(make_scoring_game());
        assert_eq!(snap.players[2].champion_id, 3);
        assert_eq!(snap.players[2].objective_damage, Some(3000));
        assert_eq!(snap.players[2].cc_seconds, Some(6));
    }

    #[test]
    fn should_prefer_sgp_end_metrics_over_lcu() {
        let snap = snapshot_with(make_scoring_game(), Some(&with_sgp()));
        assert_eq!(snap.players[2].objective_damage, Some(777));
        assert_eq!(snap.players[2].cc_seconds, Some(42));
        assert_eq!(snap.players[2].ward_score, Some(55));
        // 时间线没覆盖到的玩家仍用 LCU
        assert_eq!(snap.players[3].objective_damage, Some(4000));
    }

    #[test]
    fn should_fall_back_to_lcu_without_timeline() {
        let snap = snapshot(make_scoring_game());
        assert_eq!(snap.players[2].objective_damage, Some(3000));
        assert_eq!(snap.players[2].cc_seconds, Some(6));
        assert_eq!(snap.players[2].ward_score, Some(20));
    }

    #[test]
    fn should_be_null_when_neither_source_has_metrics() {
        let mut game = make_scoring_game();
        let stats = game["participants"][2]["stats"].as_object_mut().unwrap();
        stats.remove("damageDealtToObjectives");
        stats.remove("timeCCingOthers");
        stats.remove("visionScore");
        let snap = snapshot_with(game, Some(&make_scoring_timeline()));
        assert_eq!(snap.players[2].objective_damage, None);
        assert_eq!(snap.players[2].cc_seconds, None);
        assert_eq!(snap.players[2].ward_score, None);
    }
}
