//! OP.GG 内部 API 客户端：响应解析（HTTP 拉取见 `fetch_mode`，Task 3 添加）。

use crate::opgg::data::{normalize_position, ChampionMeta, LaneCounter, OpggSnapshot};
use serde::Deserialize;
use std::collections::HashMap;

/// OP.GG 原始响应（只解出需要的字段，其余忽略；可空字段全部 Option 容错）。
#[derive(Deserialize)]
struct RawResponse {
    data: Vec<RawChampion>,
    meta: RawMeta,
}

#[derive(Deserialize)]
struct RawMeta {
    version: String,
}

#[derive(Deserialize)]
struct RawChampion {
    id: i32,
    average_stats: Option<RawStats>,
    positions: Option<Vec<RawPosition>>,
}

#[derive(Deserialize)]
struct RawStats {
    win_rate: Option<f64>,
    pick_rate: Option<f64>,
    ban_rate: Option<f64>,
    role_rate: Option<f64>,
    tier: Option<i32>,
    rank: Option<i32>,
    tier_data: Option<RawTierData>,
}

#[derive(Deserialize)]
struct RawTierData {
    tier: Option<i32>,
    rank: Option<i32>,
}

#[derive(Deserialize)]
struct RawPosition {
    name: String,
    stats: Option<RawStats>,
    counters: Option<Vec<RawCounter>>,
}

#[derive(Deserialize)]
struct RawCounter {
    champion_id: i32,
    play: i64,
    win: i64,
}

/// 把 OP.GG 响应体解析为 [`OpggSnapshot`]。
///
/// # 参数
/// - `mode`: "ranked" | "aram"（写入快照，不参与解析分支——分路有无由数据自身决定）
/// - `body`: 响应体 JSON 字符串
/// - `fetched_at`: 拉取时间（unix 秒），由调用方注入以便测试
///
/// # 容错
/// - `positions` 为 null（aram）→ 用 `average_stats` 生成单条 position="" 的记录
/// - `ban_rate`/`tier` 等为 null → 取 0
/// - 单个英雄缺 `average_stats` 且无 positions → 跳过该英雄
pub fn parse_snapshot(mode: &str, body: &str, fetched_at: i64) -> Result<OpggSnapshot, String> {
    let raw: RawResponse =
        serde_json::from_str(body).map_err(|e| format!("OP.GG response parse error: {}", e))?;

    let mut champions: HashMap<i32, Vec<ChampionMeta>> = HashMap::new();
    let mut counters: HashMap<i32, Vec<LaneCounter>> = HashMap::new();

    for champ in &raw.data {
        match &champ.positions {
            Some(positions) if !positions.is_empty() => {
                // 有分路数据（ranked）：每分路一条，role_rate 最高者为主分路
                let main_idx = positions
                    .iter()
                    .enumerate()
                    .max_by(|(_, a), (_, b)| {
                        let ra = a.stats.as_ref().and_then(|s| s.role_rate).unwrap_or(0.0);
                        let rb = b.stats.as_ref().and_then(|s| s.role_rate).unwrap_or(0.0);
                        ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0);

                for (i, pos) in positions.iter().enumerate() {
                    let position = normalize_position(&pos.name);
                    let stats = match &pos.stats {
                        Some(s) => s,
                        None => continue,
                    };
                    let tier_data = stats.tier_data.as_ref();
                    champions.entry(champ.id).or_default().push(ChampionMeta {
                        champion_id: champ.id,
                        position: position.clone(),
                        tier: tier_data.and_then(|t| t.tier).or(stats.tier).unwrap_or(0),
                        rank: tier_data.and_then(|t| t.rank).or(stats.rank).unwrap_or(0),
                        win_rate: stats.win_rate.unwrap_or(0.0),
                        pick_rate: stats.pick_rate.unwrap_or(0.0),
                        ban_rate: stats.ban_rate.unwrap_or(0.0),
                        role_rate: stats.role_rate.unwrap_or(0.0),
                        is_main_position: i == main_idx,
                    });

                    for c in pos.counters.iter().flatten() {
                        if c.play <= 0 {
                            continue;
                        }
                        counters.entry(champ.id).or_default().push(LaneCounter {
                            opponent_id: c.champion_id,
                            position: position.clone(),
                            subject_win_rate: c.win as f64 / c.play as f64,
                            play: c.play,
                        });
                    }
                }
            }
            _ => {
                // 无分路数据（aram）：用 average_stats 生成单条记录
                let stats = match &champ.average_stats {
                    Some(s) => s,
                    None => continue,
                };
                champions.entry(champ.id).or_default().push(ChampionMeta {
                    champion_id: champ.id,
                    position: String::new(),
                    tier: stats.tier.unwrap_or(0),
                    rank: stats.rank.unwrap_or(0),
                    win_rate: stats.win_rate.unwrap_or(0.0),
                    pick_rate: stats.pick_rate.unwrap_or(0.0),
                    ban_rate: stats.ban_rate.unwrap_or(0.0),
                    role_rate: 1.0,
                    is_main_position: true,
                });
            }
        }
    }

    if champions.is_empty() {
        return Err("OP.GG response contained no champion data".to_string());
    }

    Ok(OpggSnapshot {
        mode: mode.to_string(),
        patch: raw.meta.version,
        fetched_at,
        champions,
        counters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RANKED_FIXTURE: &str = include_str!("fixtures/ranked_sample.json");
    const ARAM_FIXTURE: &str = include_str!("fixtures/aram_sample.json");

    #[test]
    fn should_parse_ranked_snapshot_with_positions_and_counters() {
        let snap = parse_snapshot("ranked", RANKED_FIXTURE, 1_752_000_000).unwrap();
        assert_eq!(snap.mode, "ranked");
        assert_eq!(snap.patch, "16.13");
        assert_eq!(snap.fetched_at, 1_752_000_000);

        // 盖伦：单分路 TOP，T1
        let garen = &snap.champions[&86];
        assert_eq!(garen.len(), 1);
        assert_eq!(garen[0].position, "TOP");
        assert_eq!(garen[0].tier, 1);
        assert!((garen[0].win_rate - 0.517991).abs() < 1e-6);
        assert!(garen[0].is_main_position);

        // 盖伦 counters：3 条，win/play 即对位胜率
        let garen_counters = &snap.counters[&86];
        assert_eq!(garen_counters.len(), 3);
        assert_eq!(garen_counters[0].opponent_id, 10);
        assert_eq!(garen_counters[0].position, "TOP");
        assert!((garen_counters[0].subject_win_rate - 2107.0 / 4710.0).abs() < 1e-6);
    }

    #[test]
    fn should_normalize_positions_and_mark_main_by_role_rate() {
        let snap = parse_snapshot("ranked", RANKED_FIXTURE, 0).unwrap();
        let c = &snap.champions[&999];
        assert_eq!(c.len(), 2);
        // OP.GG 命名 → LCU 命名
        let mid = c.iter().find(|m| m.position == "MIDDLE").unwrap();
        let adc = c.iter().find(|m| m.position == "BOTTOM").unwrap();
        // role_rate 最高的是主分路
        assert!(mid.is_main_position);
        assert!(!adc.is_main_position);
        assert_eq!(mid.tier, 2);
    }

    #[test]
    fn should_parse_aram_with_null_positions_and_null_ban_rate() {
        let snap = parse_snapshot("aram", ARAM_FIXTURE, 0).unwrap();
        let c = &snap.champions[&1];
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].position, ""); // 无分路模式
        assert_eq!(c[0].tier, 2);
        assert_eq!(c[0].ban_rate, 0.0); // null → 0.0
        assert!(c[0].is_main_position);
        assert!(snap.counters.is_empty()); // aram 无 counter
    }

    #[test]
    fn should_reject_malformed_body() {
        assert!(parse_snapshot("ranked", "not json", 0).is_err());
        assert!(parse_snapshot("ranked", r#"{"foo": 1}"#, 0).is_err());
    }

    #[test]
    fn should_normalize_opgg_position_names() {
        assert_eq!(crate::opgg::data::normalize_position("MID"), "MIDDLE");
        assert_eq!(crate::opgg::data::normalize_position("ADC"), "BOTTOM");
        assert_eq!(crate::opgg::data::normalize_position("SUPPORT"), "UTILITY");
        assert_eq!(crate::opgg::data::normalize_position("TOP"), "TOP");
        assert_eq!(crate::opgg::data::normalize_position("JUNGLE"), "JUNGLE");
    }
}
