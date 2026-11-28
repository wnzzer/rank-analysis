//! 关键转折：从逐分钟胜率选出最多 3 个大幅变化，并用窗口内事实拼成短句。

use crate::lcu::api::timeline::SlimEvent;

/// 单分钟变化下限（百分点 / 100）
const MIN_DELTA: f32 = 0.10;
/// 两个转折点最小间隔（分钟）
const MIN_GAP: usize = 2;
/// 最多几个
const MAX_POINTS: usize = 3;
/// 合计击杀 ≥ 此值称「团战」
const TEAMFIGHT_KILLS: u32 = 3;

/// 选转折点。
///
/// # 返回值
/// 下标 i（转折为 `blue[i-1] → blue[i]`），按下标升序。规则：|Δ| ≥ 0.10；
/// 下一分钟反向回吐超过 |Δ|/2 视为快照抖动丢弃；按 |Δ| 降序挑，离已选点 < 2 分钟跳过；最多 3 个。
pub fn select(blue: &[f32]) -> Vec<usize> {
    let mut cand: Vec<(usize, f32)> = (1..blue.len())
        .map(|i| (i, blue[i] - blue[i - 1]))
        .filter(|(i, d)| {
            if d.abs() < MIN_DELTA {
                return false;
            }
            match blue.get(i + 1) {
                Some(next) => {
                    let back = next - blue[*i];
                    !(back.signum() != d.signum() && back.abs() > d.abs() / 2.0)
                }
                None => true,
            }
        })
        .collect();
    // 稳定排序：|Δ| 相同按下标先后
    cand.sort_by(|a, b| b.1.abs().total_cmp(&a.1.abs()));
    let mut picked: Vec<usize> = vec![];
    for (i, _) in cand {
        if picked.len() == MAX_POINTS {
            break;
        }
        if picked.iter().all(|p| p.abs_diff(i) >= MIN_GAP) {
            picked.push(i);
        }
    }
    picked.sort_unstable();
    picked
}

const fn side_cn(blue: bool) -> &'static str {
    if blue {
        "蓝方"
    } else {
        "红方"
    }
}

/// 野怪中文名；不认识的返回 None（不写进句子）
fn monster_cn(t: &str, sub: &str) -> Option<&'static str> {
    Some(match t {
        "DRAGON" if sub == "ELDER_DRAGON" => "远古龙",
        "DRAGON" => "小龙",
        "BARON_NASHOR" => "大龙",
        "RIFTHERALD" => "先锋",
        "HORDE" => "虚空巢虫",
        "ATAKHAN" => "阿塔坎",
        _ => return None,
    })
}

/// (蓝方?, 类别, 次数) 计数表，按首次出现顺序累加
type Tally = Vec<(bool, &'static str, u32)>;

fn bump(v: &mut Tally, blue: bool, name: &'static str) {
    match v.iter_mut().find(|(b, n, _)| *b == blue && *n == name) {
        Some(e) => e.2 += 1,
        None => v.push((blue, name, 1)),
    }
}

/// 窗口 (from_ts, to_ts] 内的事实短句；无击杀 / 建筑 / 资源时为「经济差拉开」。
pub fn describe(events: &[SlimEvent], from_ts: i64, to_ts: i64) -> String {
    let in_win = |ts: i64| ts > from_ts && ts <= to_ts;
    let (mut blue_kills, mut red_kills) = (0u32, 0u32);
    let mut buildings: Tally = vec![];
    let mut monsters: Tally = vec![];
    for e in events.iter().filter(|e| in_win(e.timestamp())) {
        match e {
            SlimEvent::ChampionKill { victim_id, .. } => match victim_id {
                6..=10 => blue_kills += 1,
                1..=5 => red_kills += 1,
                _ => {}
            },
            // team_id = 被推方 → 推掉方是对面
            SlimEvent::BuildingKill {
                team_id,
                building_type,
                ..
            } => {
                let name = match building_type.as_str() {
                    "TOWER_BUILDING" => "塔",
                    "INHIBITOR_BUILDING" => "水晶",
                    _ => continue,
                };
                match team_id {
                    200 => bump(&mut buildings, true, name),
                    100 => bump(&mut buildings, false, name),
                    _ => {}
                }
            }
            SlimEvent::EliteMonsterKill {
                killer_team_id,
                monster_type,
                monster_sub_type,
                ..
            } => {
                if let (Some(name), true) = (
                    monster_cn(monster_type, monster_sub_type),
                    matches!(killer_team_id, 100 | 200),
                ) {
                    bump(&mut monsters, *killer_team_id == 100, name);
                }
            }
            _ => {}
        }
    }
    let mut parts: Vec<String> = vec![];
    if blue_kills + red_kills >= TEAMFIGHT_KILLS {
        parts.push(format!("团战蓝方 {blue_kills} 换 {red_kills}"));
    } else {
        if blue_kills > 0 {
            parts.push(format!("蓝方击杀 {blue_kills}"));
        }
        if red_kills > 0 {
            parts.push(format!("红方击杀 {red_kills}"));
        }
    }
    for (blue, name, n) in buildings {
        parts.push(format!("{}推掉 {n} 座{name}", side_cn(blue)));
    }
    for (blue, name, n) in monsters {
        let times = if n > 1 {
            format!("×{n}")
        } else {
            String::new()
        };
        parts.push(format!("{}拿下{name}{times}", side_cn(blue)));
    }
    if parts.is_empty() {
        "经济差拉开".to_string()
    } else {
        parts.join("，")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kill(ts: i64, killer: i64, victim: i64) -> SlimEvent {
        SlimEvent::ChampionKill {
            timestamp: ts,
            killer_id: killer,
            victim_id: victim,
            assisting: vec![],
            x: 0,
            y: 0,
            bounty: 0,
            shutdown_bounty: 0,
            damage_received: vec![],
        }
    }
    fn monster(ts: i64, team: i64, t: &str, sub: &str) -> SlimEvent {
        SlimEvent::EliteMonsterKill {
            timestamp: ts,
            killer_id: 0,
            killer_team_id: team,
            monster_type: t.into(),
            monster_sub_type: sub.into(),
            x: 0,
            y: 0,
        }
    }
    fn tower(ts: i64, owner: i64) -> SlimEvent {
        SlimEvent::BuildingKill {
            timestamp: ts,
            killer_id: 0,
            team_id: owner,
            building_type: "TOWER_BUILDING".into(),
            tower_type: "OUTER_TURRET".into(),
            lane_type: "MID_LANE".into(),
        }
    }

    #[test]
    fn select_ignores_small_moves() {
        assert!(select(&[0.5, 0.55, 0.62, 0.66]).is_empty());
    }

    #[test]
    fn select_drops_spike_that_reverts_more_than_half() {
        // 0.5→0.7（+0.2）后立刻 0.7→0.52（回吐 0.18 > 0.1）→ 起点那次丢弃；回落那次（−0.18）其后持平 → 保留
        assert_eq!(select(&[0.5, 0.7, 0.52, 0.52, 0.52]), vec![2]);
    }

    #[test]
    fn select_keeps_bigger_of_close_pair_max_three_sorted() {
        let b = [
            0.5, 0.62, 0.80, 0.80, 0.80, 0.65, 0.65, 0.40, 0.40, 0.27, 0.27,
        ];
        // 候选：1(+0.12) 2(+0.18) 5(−0.15) 7(−0.25) 9(−0.13)；按 |Δ| 取 7、2、5（各相距 ≥ 2）；1 离 2 太近、9 超出 3 个
        assert_eq!(select(&b), vec![2, 5, 7]);
    }

    #[test]
    fn describe_teamfight_buildings_and_objectives() {
        let ev = vec![
            kill(61_000, 1, 6),
            kill(62_000, 2, 7),
            kill(63_000, 7, 3),
            kill(64_000, 3, 8),
            kill(65_000, 8, 1),
            tower(70_000, 200),
            tower(80_000, 200),
            monster(90_000, 100, "HORDE", ""),
            monster(91_000, 100, "HORDE", ""),
            monster(92_000, 100, "HORDE", ""),
            monster(100_000, 200, "DRAGON", "ELDER_DRAGON"),
            kill(130_000, 1, 6), // 窗口外
        ];
        assert_eq!(
            describe(&ev, 60_000, 120_000),
            "团战蓝方 3 换 2，蓝方推掉 2 座塔，蓝方拿下虚空巢虫×3，红方拿下远古龙"
        );
    }

    #[test]
    fn describe_small_skirmish_and_empty_window() {
        let ev = vec![
            kill(61_000, 1, 6),
            monster(70_000, 100, "DRAGON", "FIRE_DRAGON"),
        ];
        assert_eq!(describe(&ev, 60_000, 120_000), "蓝方击杀 1，蓝方拿下小龙");
        assert_eq!(describe(&ev, 120_000, 180_000), "经济差拉开");
    }
}
