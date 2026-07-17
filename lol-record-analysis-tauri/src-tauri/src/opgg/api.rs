//! OP.GG 内部 API 客户端：响应解析（HTTP 拉取见 `fetch_mode`，Task 3 添加）。

use crate::opgg::data::{normalize_position, ChampionMeta, LaneCounter, OpggSnapshot};
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const BASE_URL: &str = "https://lol-api-champion.op.gg/api/global/champions";
/// ranked 数据取 emerald+ 分段（样本大且贴近排位主流生态）。
const RANKED_TIER_PARAM: &str = "tier=emerald_plus";
/// 同 fandom::api 风格的浏览器 UA——OP.GG 对无 UA 请求可能拒绝。
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
    /// 上一 patch 的排名（OP.GG 白送的跨版本趋势，驱动「版本走强/走弱」徽章）
    rank_prev_patch: Option<i32>,
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

/// 拼接某模式的请求 URL（仅 ranked 需要 tier 参数）。
pub fn mode_url(mode: &str) -> String {
    if mode == "ranked" {
        format!("{}/{}?{}", BASE_URL, mode, RANKED_TIER_PARAM)
    } else {
        format!("{}/{}", BASE_URL, mode)
    }
}

/// 拉取并解析某模式的完整快照。
///
/// # 参数
/// - `mode`: "ranked" | "aram"
///
/// # 错误
/// 网络失败、非 2xx、响应解析失败时返回 Err；调用方负责降级到缓存。
pub async fn fetch_mode(mode: &str) -> Result<OpggSnapshot, String> {
    let url = mode_url(mode);
    log::info!("Fetching OP.GG data: {}", url);

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("OP.GG returned status {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    let snap = parse_snapshot(mode, &body, now)?;
    log::info!(
        "OP.GG {} snapshot: patch {}, {} champions",
        mode,
        snap.patch,
        snap.champions.len()
    );
    Ok(snap)
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
                        rank_prev_patch: tier_data.and_then(|t| t.rank_prev_patch).unwrap_or(0),
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
                    rank_prev_patch: stats
                        .tier_data
                        .as_ref()
                        .and_then(|t| t.rank_prev_patch)
                        .unwrap_or(0),
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
        // 跨版本趋势字段：来自 tier_data.rank_prev_patch
        assert_eq!(garen[0].rank_prev_patch, 1);
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

    #[test]
    fn mode_url_should_add_tier_param_only_for_ranked() {
        assert_eq!(
            mode_url("ranked"),
            "https://lol-api-champion.op.gg/api/global/champions/ranked?tier=emerald_plus"
        );
        assert_eq!(
            mode_url("aram"),
            "https://lol-api-champion.op.gg/api/global/champions/aram"
        );
    }

    /// 真实网络冒烟测试：默认忽略，本机联调时 `cargo test opgg -- --ignored` 手动跑。
    #[tokio::test]
    #[ignore]
    async fn live_fetch_ranked_should_return_snapshot() {
        let snap = fetch_mode("ranked").await.expect("live fetch");
        assert!(!snap.patch.is_empty());
        assert!(snap.champions.len() > 100);
        assert!(!snap.counters.is_empty());
    }
}
