//! # 对位 / 位置职责的确定性事实（TS `src/services/ai/shared/laneFacts.ts`）
//!
//! 模型自己找对位、做减法常算错，也常拿「辅助伤害低」当罪状：差值与「相对本位置常见区间的高低」
//! 在这里预先算好。差值取整与 TS 一样走 `Number(x.toFixed(d))`（[`js_fixed_num`]）。

use serde::{Deserialize, Serialize};

use super::js::js_fixed_num;
use super::position::TeamPosition;

/// 判定所需的玩家字段（快照玩家行的子集，TS `LaneFactPlayer`）
#[derive(Debug, Clone, PartialEq)]
pub struct LaneFactPlayer {
    pub participant_id: i64,
    pub team_id: i64,
    pub name: String,
    pub champion: String,
    pub team_position: TeamPosition,
    pub kills: i64,
    pub deaths: i64,
    pub kda: f64,
    pub gold: i64,
    pub cs: i64,
    pub damage_share: f64,
    pub gold_share: f64,
    pub kill_participation: f64,
    pub damage_taken_share: f64,
    pub csm: f64,
}

/// 本人 − 同分路敌方对位的差值（正数 = 本人领先；TS `VsLaneOpponent`）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VsLaneOpponent {
    pub opponent_name: String,
    pub opponent_champion: String,
    pub gold_diff: i64,
    pub cs_diff: i64,
    pub kda_diff: f64,
    pub kills_diff: i64,
    pub deaths_diff: i64,
    pub damage_share_diff: f64,
}

/// 相对本位置常见区间的高低
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BenchmarkLevel {
    High,
    Normal,
    Low,
}

/// 五项指标各自的高低（TS `RoleBenchmark`）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoleBenchmark {
    pub damage_share: BenchmarkLevel,
    pub gold_share: BenchmarkLevel,
    pub kill_participation: BenchmarkLevel,
    pub damage_taken_share: BenchmarkLevel,
    pub csm: BenchmarkLevel,
}

/// 某位置各指标的常见区间 `(下沿, 上沿)`（TS `ROLE_BENCHMARKS`，经验区间，刻意放宽）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BenchmarkRanges {
    pub damage_share: (f64, f64),
    pub gold_share: (f64, f64),
    pub kill_participation: (f64, f64),
    pub damage_taken_share: (f64, f64),
    pub csm: (f64, f64),
}

/// 位置 → 常见区间；`Unknown` 无基准
pub fn role_benchmark_ranges(position: TeamPosition) -> Option<BenchmarkRanges> {
    let ranges = match position {
        TeamPosition::Top => BenchmarkRanges {
            damage_share: (18.0, 30.0),
            gold_share: (19.0, 25.0),
            kill_participation: (35.0, 65.0),
            damage_taken_share: (20.0, 34.0),
            csm: (6.0, 9.0),
        },
        TeamPosition::Jungle => BenchmarkRanges {
            damage_share: (13.0, 24.0),
            gold_share: (17.0, 23.0),
            kill_participation: (50.0, 80.0),
            damage_taken_share: (18.0, 32.0),
            csm: (4.3, 6.8),
        },
        TeamPosition::Middle => BenchmarkRanges {
            damage_share: (22.0, 34.0),
            gold_share: (19.0, 25.0),
            kill_participation: (45.0, 75.0),
            damage_taken_share: (12.0, 24.0),
            csm: (6.5, 9.5),
        },
        TeamPosition::Bottom => BenchmarkRanges {
            damage_share: (22.0, 34.0),
            gold_share: (22.0, 28.0),
            kill_participation: (45.0, 75.0),
            damage_taken_share: (10.0, 22.0),
            csm: (7.0, 10.0),
        },
        TeamPosition::Utility => BenchmarkRanges {
            damage_share: (5.0, 15.0),
            gold_share: (10.0, 16.0),
            kill_participation: (55.0, 85.0),
            damage_taken_share: (12.0, 26.0),
            csm: (0.0, 2.5),
        },
        TeamPosition::Unknown => return None,
    };
    Some(ranges)
}

fn level(value: f64, (lo, hi): (f64, f64)) -> BenchmarkLevel {
    if value < lo {
        BenchmarkLevel::Low
    } else if value > hi {
        BenchmarkLevel::High
    } else {
        BenchmarkLevel::Normal
    }
}

/// 找同分路敌方对位并算差值（TS `computeVsLaneOpponent`）
///
/// # 参数
/// - `player`: 目标玩家
/// - `players`: 本局全部玩家（按快照顺序；取第一个敌方同位者，与 TS `find` 一致）
///
/// # 返回
/// 分路未知或对面缺同位玩家时为 `None`
pub fn compute_vs_lane_opponent(
    player: &LaneFactPlayer,
    players: &[LaneFactPlayer],
) -> Option<VsLaneOpponent> {
    if player.team_position == TeamPosition::Unknown {
        return None;
    }
    let opp = players
        .iter()
        .find(|p| p.team_id != player.team_id && p.team_position == player.team_position)?;
    Some(VsLaneOpponent {
        opponent_name: opp.name.clone(),
        opponent_champion: opp.champion.clone(),
        gold_diff: player.gold - opp.gold,
        cs_diff: player.cs - opp.cs,
        kda_diff: js_fixed_num(player.kda - opp.kda, 2),
        kills_diff: player.kills - opp.kills,
        deaths_diff: player.deaths - opp.deaths,
        damage_share_diff: js_fixed_num(player.damage_share - opp.damage_share, 1),
    })
}

/// 相对本位置常见区间的高低（TS `computeRoleBenchmark`；TS 生产代码未调用，仅单测，原样移植）
pub fn compute_role_benchmark(player: &LaneFactPlayer) -> Option<RoleBenchmark> {
    let r = role_benchmark_ranges(player.team_position)?;
    Some(RoleBenchmark {
        damage_share: level(player.damage_share, r.damage_share),
        gold_share: level(player.gold_share, r.gold_share),
        kill_participation: level(player.kill_participation, r.kill_participation),
        damage_taken_share: level(player.damage_taken_share, r.damage_taken_share),
        csm: level(player.csm, r.csm),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TS `player()`：默认下路、5/5、kda 2 等
    fn player(participant_id: i64, team_id: i64) -> LaneFactPlayer {
        LaneFactPlayer {
            participant_id,
            team_id,
            name: format!("玩家{participant_id}"),
            champion: "英雄".to_string(),
            team_position: TeamPosition::Bottom,
            kills: 5,
            deaths: 5,
            kda: 2.0,
            gold: 12000,
            cs: 200,
            damage_share: 25.0,
            gold_share: 24.0,
            kill_participation: 60.0,
            damage_taken_share: 15.0,
            csm: 8.0,
        }
    }

    #[test]
    fn should_diff_against_same_position_enemy() {
        let me = LaneFactPlayer {
            gold: 16800,
            cs: 290,
            kda: 7.5,
            kills: 12,
            deaths: 2,
            damage_share: 32.5,
            ..player(4, 100)
        };
        let opp = LaneFactPlayer {
            champion: "韦鲁斯".to_string(),
            gold: 9800,
            cs: 200,
            kda: 0.88,
            kills: 2,
            deaths: 8,
            damage_share: 20.3,
            ..player(9, 200)
        };
        let ally = LaneFactPlayer {
            team_position: TeamPosition::Utility,
            ..player(5, 100)
        };
        let all = vec![me.clone(), opp, ally];
        assert_eq!(
            compute_vs_lane_opponent(&me, &all),
            Some(VsLaneOpponent {
                opponent_name: "玩家9".to_string(),
                opponent_champion: "韦鲁斯".to_string(),
                gold_diff: 7000,
                cs_diff: 90,
                kda_diff: 6.62,
                kills_diff: 10,
                deaths_diff: -6,
                damage_share_diff: 12.2,
            })
        );
    }

    #[test]
    fn should_return_none_without_lane_or_opponent() {
        let me = LaneFactPlayer {
            team_position: TeamPosition::Unknown,
            ..player(1, 100)
        };
        let enemy_unknown = LaneFactPlayer {
            team_position: TeamPosition::Unknown,
            ..player(6, 200)
        };
        assert_eq!(
            compute_vs_lane_opponent(&me, &[me.clone(), enemy_unknown]),
            None
        );

        let top = LaneFactPlayer {
            team_position: TeamPosition::Top,
            ..player(1, 100)
        };
        let enemy_jungle = LaneFactPlayer {
            team_position: TeamPosition::Jungle,
            ..player(6, 200)
        };
        assert_eq!(
            compute_vs_lane_opponent(&top, &[top.clone(), enemy_jungle]),
            None
        );
    }

    #[test]
    fn should_treat_low_support_damage_as_normal_but_flag_adc() {
        let sup = compute_role_benchmark(&LaneFactPlayer {
            team_position: TeamPosition::Utility,
            damage_share: 8.0,
            gold_share: 13.0,
            csm: 1.2,
            ..player(5, 100)
        })
        .expect("辅助有基准");
        assert_eq!(sup.damage_share, BenchmarkLevel::Normal);
        assert_eq!(sup.gold_share, BenchmarkLevel::Normal);
        assert_eq!(sup.csm, BenchmarkLevel::Normal);

        let adc = compute_role_benchmark(&LaneFactPlayer {
            team_position: TeamPosition::Bottom,
            damage_share: 8.0,
            ..player(4, 100)
        })
        .expect("下路有基准");
        assert_eq!(adc.damage_share, BenchmarkLevel::Low);
    }

    #[test]
    fn should_flag_values_above_role_range() {
        let mid = compute_role_benchmark(&LaneFactPlayer {
            team_position: TeamPosition::Middle,
            damage_share: 36.8,
            ..player(3, 100)
        })
        .expect("中路有基准");
        assert_eq!(mid.damage_share, BenchmarkLevel::High);
    }

    #[test]
    fn should_return_none_benchmark_for_unknown_position() {
        assert_eq!(
            compute_role_benchmark(&LaneFactPlayer {
                team_position: TeamPosition::Unknown,
                ..player(1, 100)
            }),
            None
        );
    }
}
