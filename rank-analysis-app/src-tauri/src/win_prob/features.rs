//! 每分钟局面特征（蓝方 − 红方）。训练与推理共用，改动后必须重训 model.json。

use crate::lcu::api::timeline::{SlimEvent, SlimTimeline};

/// 特征名，顺序即 model.json 的列顺序（加载时逐项比对）
pub const FEATURES: [&str; 16] = [
    "gold",
    "xp",
    "cs",
    "kills",
    "towers",
    "inhibs",
    "plates",
    "dragons",
    "elders",
    "barons",
    "heralds",
    "grubs",
    "atakhan",
    "baron_buff",
    "elder_buff",
    "soul_point",
];

/// 大龙 buff 持续（ms）
const BARON_BUFF_MS: i64 = 180_000;
/// 远古龙 buff 持续（ms）
const ELDER_BUFF_MS: i64 = 150_000;

/// 某一分钟帧的特征
///
/// - `minute`: 帧时间四舍五入到分钟（≥ 1）
/// - `frame_ts`: 帧时间戳（ms），转折文字按它划窗口
/// - `x`: 与 [`FEATURES`] 同序
#[derive(Debug, Clone, PartialEq)]
pub struct MinuteFeatures {
    pub minute: u32,
    pub frame_ts: i64,
    pub x: [f64; 16],
}

/// participantId → 蓝 +1 / 红 −1 / 其他 0
fn side_of_pid(pid: i64) -> f64 {
    match pid {
        1..=5 => 1.0,
        6..=10 => -1.0,
        _ => 0.0,
    }
}

/// teamId → 蓝 +1 / 红 −1 / 其他 0
fn side_of_team(team: i64) -> f64 {
    match team {
        100 => 1.0,
        200 => -1.0,
        _ => 0.0,
    }
}

/// 累计到某时刻的局面（蓝 − 红）
#[derive(Default)]
struct State {
    kills: f64,
    towers: f64,
    inhibs: f64,
    plates: f64,
    dragons: f64,
    elders: f64,
    barons: f64,
    heralds: f64,
    grubs: f64,
    atakhan: f64,
    blue_dragons: u32,
    red_dragons: u32,
    baron_until: [i64; 2],
    elder_until: [i64; 2],
}

impl State {
    fn apply(&mut self, e: &SlimEvent) {
        match e {
            SlimEvent::ChampionKill { victim_id, .. } => self.kills -= side_of_pid(*victim_id),
            // team_id = 被推建筑 / 被打镀层的所属队伍 → 推掉方是对面
            SlimEvent::BuildingKill {
                team_id,
                building_type,
                ..
            } => match building_type.as_str() {
                "TOWER_BUILDING" => self.towers -= side_of_team(*team_id),
                "INHIBITOR_BUILDING" => self.inhibs -= side_of_team(*team_id),
                _ => {}
            },
            SlimEvent::TurretPlateDestroyed { team_id, .. } => {
                self.plates -= side_of_team(*team_id)
            }
            SlimEvent::EliteMonsterKill {
                timestamp,
                killer_team_id,
                monster_type,
                monster_sub_type,
                ..
            } => {
                let s = side_of_team(*killer_team_id);
                let idx = if s > 0.0 { 0 } else { 1 };
                match monster_type.as_str() {
                    "DRAGON" if monster_sub_type == "ELDER_DRAGON" => {
                        self.elders += s;
                        if s != 0.0 {
                            self.elder_until[idx] = timestamp + ELDER_BUFF_MS;
                        }
                    }
                    "DRAGON" => {
                        self.dragons += s;
                        if s > 0.0 {
                            self.blue_dragons += 1
                        } else if s < 0.0 {
                            self.red_dragons += 1
                        }
                    }
                    "BARON_NASHOR" => {
                        self.barons += s;
                        if s != 0.0 {
                            self.baron_until[idx] = timestamp + BARON_BUFF_MS;
                        }
                    }
                    "RIFTHERALD" => self.heralds += s,
                    "HORDE" => self.grubs += s,
                    "ATAKHAN" => self.atakhan += s,
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// 龙魂点：3 条小龙 = 1（听牌），≥ 4 条 = 2
fn soul_point(n: u32) -> f64 {
    match n {
        0..=2 => 0.0,
        3 => 1.0,
        _ => 2.0,
    }
}

/// 有效期内为 1
fn active(until: i64, now: i64) -> f64 {
    if until > now {
        1.0
    } else {
        0.0
    }
}

/// 逐分钟特征。
///
/// # 返回值
/// 按时间升序；第 0 分钟不产出；同一取整分钟的多帧（如终局帧）只保留最后一帧。
/// 任一帧玩家数 ≠ 10 时返回 None（掉线重连 / 数据残缺）。
pub fn minute_features(tl: &SlimTimeline) -> Option<Vec<MinuteFeatures>> {
    let mut state = State::default();
    let mut next_event = 0;
    let mut out: Vec<MinuteFeatures> = Vec::with_capacity(tl.frames.len());
    for f in &tl.frames {
        if f.players.len() != 10 {
            return None;
        }
        while next_event < tl.events.len() && tl.events[next_event].timestamp() <= f.timestamp {
            state.apply(&tl.events[next_event]);
            next_event += 1;
        }
        let minute = (f.timestamp as f64 / 60000.0).round() as u32;
        if minute < 1 {
            continue;
        }
        let (mut gold, mut xp, mut cs) = (0.0, 0.0, 0.0);
        for p in &f.players {
            let s = side_of_pid(p.participant_id);
            gold += s * p.total_gold as f64;
            xp += s * p.xp as f64;
            cs += s * p.cs as f64;
        }
        let now = f.timestamp;
        let row = MinuteFeatures {
            minute,
            frame_ts: now,
            x: [
                gold / 1000.0,
                xp / 1000.0,
                cs / 10.0,
                state.kills,
                state.towers,
                state.inhibs,
                state.plates,
                state.dragons,
                state.elders,
                state.barons,
                state.heralds,
                state.grubs,
                state.atakhan,
                active(state.baron_until[0], now) - active(state.baron_until[1], now),
                active(state.elder_until[0], now) - active(state.elder_until[1], now),
                soul_point(state.blue_dragons) - soul_point(state.red_dragons),
            ],
        };
        if out.last().is_some_and(|r| r.minute == minute) {
            out.pop();
        }
        out.push(row);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::timeline::{
        slim_from_raw, RawDetails, SlimEvent, SlimFrame, SlimPlayerFrame, SlimTimeline,
    };
    use std::collections::{BTreeMap, HashMap};

    const SAMPLE: &str = include_str!("../../tests/fixtures/sgp_details_sample.json");

    fn sample() -> SlimTimeline {
        let raw = serde_json::from_str::<RawDetails>(SAMPLE).expect("fixture 可解析");
        slim_from_raw(raw.json, &HashMap::new())
    }

    /// 10 人、每人同样经济的空帧
    fn frame(ts: i64, blue_gold: i64, red_gold: i64) -> SlimFrame {
        SlimFrame {
            timestamp: ts,
            players: (1..=10)
                .map(|pid| SlimPlayerFrame {
                    participant_id: pid,
                    total_gold: if pid <= 5 { blue_gold } else { red_gold },
                    xp: 0,
                    level: 1,
                    cs: 0,
                    jungle_cs: 0,
                    x: 0,
                    y: 0,
                    damage_to_champions: 0,
                })
                .collect(),
        }
    }

    fn synthetic(events: Vec<SlimEvent>) -> SlimTimeline {
        SlimTimeline {
            game_id: 1,
            frame_interval_ms: 60000,
            participants: vec![],
            frames: (0..=6).map(|m| frame(m * 60000, 500, 500)).collect(),
            events,
            items: BTreeMap::new(),
            win_probability: None,
        }
    }

    fn col(name: &str) -> usize {
        FEATURES.iter().position(|f| *f == name).unwrap()
    }

    #[test]
    fn should_sum_gold_per_side_and_skip_minute_zero() {
        let tl = sample();
        let rows = minute_features(&tl).unwrap();
        assert_eq!(rows[0].minute, 1);
        let last = rows.last().unwrap();
        let f = tl.frames.last().unwrap();
        let diff: i64 = f
            .players
            .iter()
            .map(|p| {
                if p.participant_id <= 5 {
                    p.total_gold
                } else {
                    -p.total_gold
                }
            })
            .sum();
        assert!((last.x[col("gold")] - diff as f64 / 1000.0).abs() < 1e-9);
    }

    #[test]
    fn should_count_kills_by_victim_side_and_plates_by_owner() {
        let tl = sample();
        let last = minute_features(&tl).unwrap().pop().unwrap();
        let (mut blue, mut red) = (0, 0);
        for e in &tl.events {
            if let SlimEvent::ChampionKill {
                victim_id,
                timestamp,
                ..
            } = e
            {
                if *timestamp <= last.frame_ts {
                    if *victim_id >= 6 {
                        blue += 1
                    } else {
                        red += 1
                    }
                }
            }
        }
        assert_eq!(last.x[col("kills")], (blue - red) as f64);
        // fixture：蓝方塔 277300 / 406729 被打镀层、红方塔 366542 被打 → 蓝 − 红 = 1 − 2 = −1
        assert_eq!(last.x[col("plates")], -1.0);
    }

    #[test]
    fn should_track_towers_dragons_and_buffs() {
        let tl = synthetic(vec![
            SlimEvent::BuildingKill {
                timestamp: 90_000,
                killer_id: 1,
                team_id: 200,
                building_type: "TOWER_BUILDING".into(),
                tower_type: "OUTER_TURRET".into(),
                lane_type: "MID_LANE".into(),
            },
            SlimEvent::EliteMonsterKill {
                timestamp: 100_000,
                killer_id: 6,
                killer_team_id: 200,
                monster_type: "DRAGON".into(),
                monster_sub_type: "FIRE_DRAGON".into(),
                x: 0,
                y: 0,
            },
            SlimEvent::EliteMonsterKill {
                timestamp: 110_000,
                killer_id: 1,
                killer_team_id: 100,
                monster_type: "DRAGON".into(),
                monster_sub_type: "ELDER_DRAGON".into(),
                x: 0,
                y: 0,
            },
            SlimEvent::EliteMonsterKill {
                timestamp: 130_000,
                killer_id: 1,
                killer_team_id: 100,
                monster_type: "BARON_NASHOR".into(),
                monster_sub_type: "".into(),
                x: 0,
                y: 0,
            },
        ]);
        let rows = minute_features(&tl).unwrap();
        let m2 = &rows[1]; // 120000
        assert_eq!(m2.x[col("towers")], 1.0);
        assert_eq!(m2.x[col("dragons")], -1.0); // 远古龙不计入小龙
        assert_eq!(m2.x[col("elders")], 1.0);
        assert_eq!(m2.x[col("elder_buff")], 1.0);
        let m3 = &rows[2]; // 180000
        assert_eq!(m3.x[col("barons")], 1.0);
        assert_eq!(m3.x[col("baron_buff")], 1.0);
        let m6 = &rows[5]; // 360000：大龙 buff 130000+180000=310000 已过期，远古 110000+150000 已过期
        assert_eq!(m6.x[col("baron_buff")], 0.0);
        assert_eq!(m6.x[col("elder_buff")], 0.0);
    }

    #[test]
    fn should_return_none_when_a_frame_misses_players() {
        let mut tl = synthetic(vec![]);
        tl.frames[3].players.pop();
        assert!(minute_features(&tl).is_none());
    }

    #[test]
    fn should_keep_last_frame_when_two_round_to_same_minute() {
        let mut tl = synthetic(vec![]);
        tl.frames.push(frame(6 * 60000 + 20_000, 900, 500)); // 6:20 终局帧，取整也是 6
        let rows = minute_features(&tl).unwrap();
        assert_eq!(rows.iter().filter(|r| r.minute == 6).count(), 1);
        assert_eq!(rows.last().unwrap().x[col("gold")], 2.0); // (900-500)*5/1000
    }
}
