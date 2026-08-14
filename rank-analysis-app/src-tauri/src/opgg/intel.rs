//! # OP.GG 英雄对位情报模块（LeagueAkari 逆向端点）
//!
//! 数据源为 LeagueAkari 逆向发现的 OP.GG 内部端点：
//! `https://lol-api-champion.op.gg/api/{region}/champions/ranked/{champion_id}/{POSITION}?tier={tier}`
//! （v1.1 spec 实证：global/emerald_plus 下返回全量对位列表 50 条 + 协同搭档 50 条）。
//!
//! 与 [`super::api`]（快照管道）并行：快照供既有克制 pill / 段位徽章 / AI prompt 使用，
//! 本模块按需拉取**单英雄单位置**的全量对位数据，供选人期悬浮弹窗（P1）与阵容推荐（P2）。
//!
//! 与快照的区别：
//! - 快照：全量 170+ 英雄 × 每分路 top3，一条请求；本模块：单英雄单位置全量对位，两条请求
//! - 本模块命中链与快照同构（内存 moka → 磁盘 fresh → HTTP → 磁盘 stale 降级 → Err），
//!   TTL 12h 对齐 [`super::cache::TTL_SECS`]（一个 patch 内数据基本不变）

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// API 基地址（region 在路径中）。
const BASE_URL: &str = "https://lol-api-champion.op.gg/api";

/// 与 `super::api::USER_AGENT` 同款浏览器 UA——OP.GG 对无 UA 请求可能拒绝。
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// 对位/协同数据的有效期：12 小时（秒），对齐快照缓存。
pub const TTL_SECS: i64 = 12 * 60 * 60;

/// region 白名单（与 OP.GG 首页区域导航一致）。
pub const VALID_REGIONS: [&str; 19] = [
    "global", "na", "euw", "eune", "kr", "jp", "br", "lan", "las", "oce", "ru", "tr", "sea", "tw",
    "vn", "th", "sg", "me1", "me2",
];

/// tier 白名单：OP.GG 支持的段位分段参数（实测 `ibsg`（铁/青铜/银/金）与
/// `emerald_plus` 均返回有效数据，`ibsgg` 等非法值返回 422）。
pub const VALID_TIERS: [&str; 10] = [
    "ibsg",
    "gold_plus",
    "platinum_plus",
    "emerald_plus",
    "diamond_plus",
    "master",
    "master_plus",
    "grandmaster",
    "challenger",
    "all",
];

/// 位置白名单（OP.GG 命名，大写）。
pub const VALID_POSITIONS: [&str; 5] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

/// 默认区域（样本量最大）。
pub const DEFAULT_REGION: &str = "global";

/// 默认段位分段（样本量大且贴近排位主流生态）。
pub const DEFAULT_TIER: &str = "emerald_plus";

/// 单条对位数据：本英雄（请求位置）面对 `champion_id` 的对位。
///
/// `win_rate` 由 `win / play` 计算（API 只给原始计数），`play <= 0` 的条目解析时跳过。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CounterItem {
    /// 对手英雄 ID
    pub champion_id: i32,
    /// 样本对局数
    pub play: i64,
    /// 胜场数
    pub win: i64,
    /// 对位胜率（0~1，由 win/play 计算）
    pub win_rate: f64,
}

/// 单条协同搭档数据：本英雄（请求位置）与 `synergy_champion_id` 同队的胜率。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SynergyItem {
    /// 搭档英雄 ID
    pub synergy_champion_id: i32,
    /// 搭档位置（OP.GG 命名，如 "SUPPORT"）
    pub synergy_position: String,
    /// 同队胜率（0~1，API 直接给出）
    pub win_rate: f64,
    /// 样本对局数
    pub play: i64,
}

/// 单英雄单位置的对位情报（内存与磁盘缓存的最小单元，命令返回值）。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChampionIntel {
    /// 区域（请求参数，写入缓存供来源标注）
    pub region: String,
    /// 段位分段（请求参数，写入缓存供来源标注）
    pub tier: String,
    /// 拉取时间（unix 秒）
    pub fetched_at: i64,
    /// 是否过期数据（拉取失败降级；`serde(default)` 兼容旧磁盘缓存）
    #[serde(default)]
    pub stale: bool,
    /// 全量对位列表（按 API 顺序）
    pub counters: Vec<CounterItem>,
    /// 协同搭档列表（V1.1 UI 启用，数据层本次交付）
    pub synergies: Vec<SynergyItem>,
}

/// 把 LCU/前端分路命名转成 OP.GG 命名，未知值返回 Err。
///
/// 双兼容：直接传 OP.GG 命名（MID/ADC/SUPPORT）也原样接受。
///
/// # 错误
/// 不在 `TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY`（LCU）或
/// `TOP|JUNGLE|MID|ADC|SUPPORT`（OP.GG）内时 Err，附带合法取值提示。
pub fn lcu_to_opgg_position(lcu: &str) -> Result<&'static str, String> {
    match lcu {
        "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT" => Ok(lcu),
        "MIDDLE" => Ok("MID"),
        "BOTTOM" => Ok("ADC"),
        "UTILITY" => Ok("SUPPORT"),
        other => Err(format!(
            "invalid position: {} (expected TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY)",
            other
        )),
    }
}

/// 校验区域：在白名单内原样返回，非法/缺省回退 [`DEFAULT_REGION`]。
pub fn sanitize_region(raw: Option<&str>) -> &'static str {
    match raw {
        Some(r) => VALID_REGIONS
            .iter()
            .find(|v| **v == r)
            .copied()
            .unwrap_or(DEFAULT_REGION),
        None => DEFAULT_REGION,
    }
}

/// 校验段位：在白名单内原样返回，非法/缺省回退 [`DEFAULT_TIER`]。
pub fn sanitize_tier(raw: Option<&str>) -> &'static str {
    match raw {
        Some(t) => VALID_TIERS
            .iter()
            .find(|v| **v == t)
            .copied()
            .unwrap_or(DEFAULT_TIER),
        None => DEFAULT_TIER,
    }
}

/// 当前 unix 秒；系统时钟异常时返回 0。
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 对位数据是否仍新鲜（`now - fetched_at < TTL_SECS`）。
pub fn is_fresh(intel: &ChampionIntel, now: i64) -> bool {
    now - intel.fetched_at < TTL_SECS
}

// ---------- 原始响应解析 ----------

#[derive(Deserialize)]
struct RawCountersResponse {
    data: RawCountersData,
}

#[derive(Deserialize)]
struct RawCountersData {
    counters: Vec<RawCounter>,
}

#[derive(Deserialize)]
struct RawCounter {
    champion_id: i32,
    play: i64,
    win: i64,
}

#[derive(Deserialize)]
struct RawSynergiesResponse {
    data: Vec<RawSynergy>,
}

#[derive(Deserialize)]
struct RawSynergy {
    synergy_champion_id: i32,
    synergy_position: String,
    win_rate: f64,
    play: i64,
}

/// 把 counters 端点响应体解析为对位列表；`play <= 0` 的条目跳过。
///
/// # 错误
/// 响应不是合法 JSON 或缺少 `data.counters` 时 Err。
pub fn parse_counters(body: &str) -> Result<Vec<CounterItem>, String> {
    let raw: RawCountersResponse =
        serde_json::from_str(body).map_err(|e| format!("OP.GG counters parse error: {}", e))?;
    Ok(raw
        .data
        .counters
        .into_iter()
        .filter(|c| c.play > 0)
        .map(|c| CounterItem {
            champion_id: c.champion_id,
            play: c.play,
            win: c.win,
            win_rate: c.win as f64 / c.play as f64,
        })
        .collect())
}

/// 把 synergies 端点响应体解析为协同列表；`play <= 0` 的条目跳过。
///
/// # 错误
/// 响应不是合法 JSON 或缺少 `data` 时 Err。
pub fn parse_synergies(body: &str) -> Result<Vec<SynergyItem>, String> {
    let raw: RawSynergiesResponse =
        serde_json::from_str(body).map_err(|e| format!("OP.GG synergies parse error: {}", e))?;
    Ok(raw
        .data
        .into_iter()
        .filter(|s| s.play > 0)
        .map(|s| SynergyItem {
            synergy_champion_id: s.synergy_champion_id,
            synergy_position: s.synergy_position,
            win_rate: s.win_rate,
            play: s.play,
        })
        .collect())
}

// ---------- HTTP 拉取 ----------

/// 拼接 counters 端点 URL。
fn counters_url(region: &str, champion_id: i32, position: &str, tier: &str) -> String {
    format!(
        "{}/{}/champions/ranked/{}/{}/{}?tier={}",
        BASE_URL, region, champion_id, position, tier
    )
}

/// 拼接 synergies 端点 URL。
fn synergies_url(region: &str, champion_id: i32, position: &str, tier: &str) -> String {
    format!(
        "{}/{}/champions/ranked/{}/{}/synergies?tier={}",
        BASE_URL, region, champion_id, position, tier
    )
}

/// 拉取并解析单英雄单位置的对位与协同。
///
/// # 参数
/// - `region`: 区域（如 "global"，须已过 [`sanitize_region`]）
/// - `champion_id`: 英雄 ID
/// - `position`: OP.GG 位置命名（如 "TOP"，须已过 [`lcu_to_opgg_position`]）
/// - `tier`: 段位分段（如 "emerald_plus"，须已过 [`sanitize_tier`]）
///
/// # 错误
/// 任一请求网络失败、非 2xx、解析失败时 Err；调用方负责降级到缓存。
pub async fn fetch_champion_intel(
    region: &str,
    champion_id: i32,
    position: &str,
    tier: &str,
) -> Result<(Vec<CounterItem>, Vec<SynergyItem>), String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let counters_body =
        get_text(&client, &counters_url(region, champion_id, position, tier)).await?;
    let counters = parse_counters(&counters_body)?;

    let synergies_body =
        get_text(&client, &synergies_url(region, champion_id, position, tier)).await?;
    let synergies = parse_synergies(&synergies_body)?;

    Ok((counters, synergies))
}

/// GET 请求并返回响应体文本；非 2xx 一律 Err。
async fn get_text(client: &Client, url: &str) -> Result<String, String> {
    log::info!("Fetching OP.GG intel: {}", url);
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("OP.GG intel returned status {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

// ---------- 磁盘缓存 ----------

/// 缓存键（内存 moka 键 + 磁盘文件名）：全部来自白名单枚举，文件名安全。
pub fn cache_key(region: &str, tier: &str, champion_id: i32, position: &str) -> String {
    format!(
        "opgg_intel_{}_{}_{}_{}",
        region, tier, champion_id, position
    )
}

/// 默认缓存文件路径（系统临时目录下的绝对路径）。
pub fn default_path(region: &str, tier: &str, champion_id: i32, position: &str) -> PathBuf {
    crate::paths::cache_file(&format!(
        "{}.json",
        cache_key(region, tier, champion_id, position)
    ))
}

/// 序列化对位情报写入指定路径。
pub fn save_to_path(intel: &ChampionIntel, path: &Path) -> Result<(), String> {
    let json = serde_json::to_string(intel).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write {}: {}", path.display(), e))
}

/// 从指定路径读取对位情报；文件缺失或损坏返回 None（缓存问题不阻塞主流程）。
pub fn load_from_path(path: &Path) -> Option<ChampionIntel> {
    let content = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&content) {
        Ok(intel) => Some(intel),
        Err(e) => {
            log::warn!("OP.GG intel cache corrupt at {}: {}", path.display(), e);
            None
        }
    }
}

// ---------- 降级链编排 ----------

/// 降级链编排的可注入实现（供单测注入假 fetch / 假磁盘）。
///
/// 与 [`ensure_champion_intel`] 行为完全一致，仅把外部效应参数化。
///
/// # 参数
/// - `mem_cache`: 内存缓存（无 TTL，保留最后已知情报供降级）
/// - `key`: 缓存键（region/tier/champion_id/position 拼成，见 [`cache_key`]）
/// - `now`: 当前 unix 秒（新鲜度判定基准）
/// - `fetch`: HTTP 拉取（生产为 [`fetch_champion_intel`]）
/// - `disk_load` / `disk_save`: 磁盘缓存读写（生产为 [`load_from_path`] / [`save_to_path`]）
///
/// # 返回值
/// `(情报, stale)`：stale=true 表示拉取失败、返回的是过期缓存。
pub async fn ensure_intel_impl<F, Fut>(
    mem_cache: &moka::future::Cache<String, Arc<ChampionIntel>>,
    key: &str,
    region: &str,
    tier: &str,
    now: i64,
    fetch: F,
    disk_load: impl Fn(&str) -> Option<ChampionIntel>,
    disk_save: impl Fn(&ChampionIntel) -> Result<(), String>,
) -> Result<(Arc<ChampionIntel>, bool), String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<CounterItem>, Vec<SynergyItem>), String>>,
{
    // 1. 内存 fresh
    if let Some(intel) = mem_cache.get(key).await {
        if is_fresh(&intel, now) {
            return Ok((intel, false));
        }
    }

    // 2. 磁盘 fresh（跨重启复用）
    if let Some(intel) = disk_load(key) {
        if is_fresh(&intel, now) {
            let arc = Arc::new(intel);
            mem_cache.insert(key.to_string(), arc.clone()).await;
            return Ok((arc, false));
        }
    }

    // 3. HTTP 拉取
    match fetch().await {
        Ok((counters, synergies)) => {
            let intel = ChampionIntel {
                region: region.to_string(),
                tier: tier.to_string(),
                fetched_at: now,
                stale: false,
                counters,
                synergies,
            };
            if let Err(e) = disk_save(&intel) {
                log::warn!("OP.GG intel cache save failed: {}", e);
            }
            let arc = Arc::new(intel);
            mem_cache.insert(key.to_string(), arc.clone()).await;
            Ok((arc, false))
        }
        Err(e) => {
            // 4. 过期缓存降级（内存优先，其次磁盘）
            log::warn!(
                "OP.GG intel fetch failed, falling back to stale cache: {}",
                e
            );
            if let Some(intel) = mem_cache.get(key).await {
                return Ok((intel, true));
            }
            if let Some(intel) = disk_load(key) {
                let arc = Arc::new(intel);
                mem_cache.insert(key.to_string(), arc.clone()).await;
                return Ok((arc, true));
            }
            Err(e)
        }
    }
}

/// 获取单英雄单位置对位情报的核心编排（命令层调用）。
///
/// # 参数
/// - `state`: 应用状态（`opgg_intel_cache` 内存缓存）
/// - `region`: 区域（如 "global"）
/// - `champion_id`: 英雄 ID
/// - `position`: OP.GG 位置命名（如 "TOP"）
/// - `tier`: 段位分段（如 "emerald_plus"）
///
/// # 返回值
/// `(情报, stale)`：stale=true 表示拉取失败、返回的是过期缓存。
pub async fn ensure_champion_intel(
    state: &crate::state::AppState,
    region: &str,
    champion_id: i32,
    position: &str,
    tier: &str,
) -> Result<(Arc<ChampionIntel>, bool), String> {
    let key = cache_key(region, tier, champion_id, position);
    let region_owned = region.to_string();
    let position_owned = position.to_string();
    let tier_owned = tier.to_string();
    ensure_intel_impl(
        &state.opgg_intel_cache,
        &key,
        region,
        tier,
        now_secs(),
        move || {
            let region = region_owned.clone();
            let position = position_owned.clone();
            let tier = tier_owned.clone();
            async move { fetch_champion_intel(&region, champion_id, &position, &tier).await }
        },
        |k| load_from_path(&crate::paths::cache_file(&format!("{}.json", k))),
        |i| save_to_path(i, &default_path(&i.region, &i.tier, champion_id, &position)),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    const FIXTURE_COUNTERS: &str = include_str!("fixtures/intel_counters_sample.json");
    const FIXTURE_SYNERGIES: &str = include_str!("fixtures/intel_synergies_sample.json");

    /// 测试基准时刻。
    const NOW: i64 = 2_000_000_000;

    fn intel_at(fetched_at: i64) -> ChampionIntel {
        ChampionIntel {
            region: "global".into(),
            tier: "emerald_plus".into(),
            fetched_at,
            stale: false,
            counters: Vec::new(),
            synergies: Vec::new(),
        }
    }

    fn mem_cache() -> moka::future::Cache<String, Arc<ChampionIntel>> {
        moka::future::Cache::builder().build()
    }

    fn disk_none(_key: &str) -> Option<ChampionIntel> {
        None
    }

    fn disk_save_ok(_intel: &ChampionIntel) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn lcu_to_opgg_should_map_all_lcu_positions() {
        assert_eq!(lcu_to_opgg_position("TOP").unwrap(), "TOP");
        assert_eq!(lcu_to_opgg_position("JUNGLE").unwrap(), "JUNGLE");
        assert_eq!(lcu_to_opgg_position("MIDDLE").unwrap(), "MID");
        assert_eq!(lcu_to_opgg_position("BOTTOM").unwrap(), "ADC");
        assert_eq!(lcu_to_opgg_position("UTILITY").unwrap(), "SUPPORT");
        // OP.GG 命名直接接受（双兼容）
        assert_eq!(lcu_to_opgg_position("MID").unwrap(), "MID");
        assert_eq!(lcu_to_opgg_position("ADC").unwrap(), "ADC");
    }

    #[test]
    fn lcu_to_opgg_should_reject_unknown_position() {
        let err = lcu_to_opgg_position("TOP_LANE").unwrap_err();
        assert!(err.contains("invalid position"));
        assert!(err.contains("expected TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY"));
    }

    #[test]
    fn sanitize_region_should_whitelist_and_fall_back() {
        assert_eq!(sanitize_region(Some("global")), "global");
        assert_eq!(sanitize_region(Some("kr")), "kr");
        assert_eq!(sanitize_region(Some("bogus")), "global");
        assert_eq!(sanitize_region(None), "global");
    }

    #[test]
    fn sanitize_tier_should_whitelist_and_fall_back() {
        assert_eq!(sanitize_tier(Some("emerald_plus")), "emerald_plus");
        assert_eq!(sanitize_tier(Some("ibsg")), "ibsg");
        assert_eq!(sanitize_tier(Some("bogus")), "emerald_plus");
        assert_eq!(sanitize_tier(None), "emerald_plus");
    }

    #[test]
    fn parse_counters_should_compute_win_rate_and_skip_zero_play() {
        let items = parse_counters(FIXTURE_COUNTERS).unwrap();
        // fixture：3 条有效 + 1 条 play=0 被跳过
        assert_eq!(items.len(), 3);
        let first = &items[0];
        assert_eq!(first.champion_id, 10);
        assert_eq!(first.play, 4710);
        assert_eq!(first.win, 2107);
        assert!((first.win_rate - 2107.0 / 4710.0).abs() < 1e-9);
        // 50/50 全胜
        let third = &items[2];
        assert_eq!(third.win_rate, 1.0);
    }

    #[test]
    fn parse_counters_should_reject_malformed_body() {
        assert!(parse_counters("not json").is_err());
        assert!(parse_counters(r#"{"data": {}}"#).is_err());
    }

    #[test]
    fn parse_synergies_should_pass_through_and_skip_zero_play() {
        let items = parse_synergies(FIXTURE_SYNERGIES).unwrap();
        // fixture：2 条有效 + 1 条 play=0 被跳过
        assert_eq!(items.len(), 2);
        let first = &items[0];
        assert_eq!(first.synergy_champion_id, 555);
        assert_eq!(first.synergy_position, "SUPPORT");
        assert_eq!(first.play, 16);
        assert_eq!(first.win_rate, 0.4375);
    }

    #[test]
    fn parse_synergies_should_reject_malformed_body() {
        assert!(parse_synergies("not json").is_err());
        assert!(parse_synergies(r#"{"data": {}}"#).is_err());
    }

    #[test]
    fn cache_key_should_be_parameter_scoped_and_file_safe() {
        let k = cache_key("global", "emerald_plus", 34, "TOP");
        assert_eq!(k, "opgg_intel_global_emerald_plus_34_TOP");
        // 不同参数不得撞键
        assert_ne!(cache_key("kr", "ibsg", 34, "TOP"), k);
        assert_ne!(cache_key("global", "ibsg", 34, "TOP"), k);
        assert_ne!(cache_key("global", "emerald_plus", 35, "TOP"), k);
        assert_ne!(cache_key("global", "emerald_plus", 34, "ADC"), k);
    }

    #[test]
    fn default_path_should_be_absolute_and_scoped() {
        let p = default_path("global", "emerald_plus", 34, "TOP");
        assert!(p.is_absolute());
        assert!(p
            .to_str()
            .unwrap()
            .contains("opgg_intel_global_emerald_plus_34_TOP.json"));
    }

    #[test]
    fn is_fresh_should_judge_by_ttl() {
        assert!(is_fresh(&intel_at(NOW - TTL_SECS + 1), NOW));
        assert!(!is_fresh(&intel_at(NOW - TTL_SECS), NOW));
        assert!(!is_fresh(&intel_at(NOW - TTL_SECS - 1), NOW));
    }

    #[test]
    fn save_and_load_should_round_trip() {
        let path = std::env::temp_dir().join("opgg_intel_test_roundtrip.json");
        let _ = std::fs::remove_file(&path);
        let original = ChampionIntel {
            region: "kr".into(),
            tier: "ibsg".into(),
            fetched_at: NOW,
            stale: false,
            counters: vec![CounterItem {
                champion_id: 63,
                play: 5,
                win: 2,
                win_rate: 0.4,
            }],
            synergies: vec![SynergyItem {
                synergy_champion_id: 555,
                synergy_position: "SUPPORT".into(),
                win_rate: 0.4375,
                play: 16,
            }],
        };
        save_to_path(&original, &path).unwrap();
        let loaded = load_from_path(&path).expect("should load");
        assert_eq!(loaded, original);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_should_return_none_for_missing_or_corrupt_file() {
        let missing = std::env::temp_dir().join("opgg_intel_test_missing.json");
        let _ = std::fs::remove_file(&missing);
        assert!(load_from_path(&missing).is_none());

        let corrupt = std::env::temp_dir().join("opgg_intel_test_corrupt.json");
        std::fs::write(&corrupt, "not json").unwrap();
        assert!(load_from_path(&corrupt).is_none());
        let _ = std::fs::remove_file(&corrupt);
    }

    // ---- ensure_intel_impl（降级链编排）----

    #[tokio::test]
    async fn ensure_should_return_fresh_memory_without_fetching() {
        let cache_map = mem_cache();
        cache_map
            .insert("k".into(), Arc::new(intel_at(NOW - 100)))
            .await;

        let fetch_called = AtomicBool::new(false);
        let (intel, stale) = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || {
                fetch_called.store(true, Ordering::SeqCst);
                async {
                    Err::<(Vec<CounterItem>, Vec<SynergyItem>), String>("should not fetch".into())
                }
            },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(
            !fetch_called.load(Ordering::SeqCst),
            "内存 fresh 不应触发拉取"
        );
        assert!(!stale);
        assert_eq!(intel.fetched_at, NOW - 100);
    }

    #[tokio::test]
    async fn ensure_should_promote_fresh_disk_without_fetching() {
        let cache_map = mem_cache();

        let fetch_called = AtomicBool::new(false);
        let (intel, stale) = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || {
                fetch_called.store(true, Ordering::SeqCst);
                async {
                    Err::<(Vec<CounterItem>, Vec<SynergyItem>), String>("should not fetch".into())
                }
            },
            |_k| Some(intel_at(NOW - 100)),
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(
            !fetch_called.load(Ordering::SeqCst),
            "磁盘 fresh 不应触发拉取"
        );
        assert!(!stale);
        assert_eq!(intel.fetched_at, NOW - 100);
        // 磁盘命中应回填内存，后续查询命令可复用
        let cached = cache_map.get("k").await.expect("磁盘 fresh 应写入内存");
        assert_eq!(cached.fetched_at, NOW - 100);
    }

    #[tokio::test]
    async fn ensure_should_fetch_and_cache_on_success() {
        let cache_map = mem_cache();
        let saved = AtomicBool::new(false);

        let (intel, stale) = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || async { Ok((vec![], vec![])) },
            disk_none,
            |_i| {
                saved.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();

        assert!(!stale);
        assert_eq!(intel.fetched_at, NOW);
        assert_eq!(intel.region, "global");
        assert_eq!(intel.tier, "emerald_plus");
        assert!(saved.load(Ordering::SeqCst), "拉取成功应落盘");
        let cached = cache_map.get("k").await.expect("拉取成功应写入内存");
        assert_eq!(cached.fetched_at, NOW);
    }

    #[tokio::test]
    async fn ensure_should_fall_back_to_stale_memory_on_fetch_failure() {
        let cache_map = mem_cache();
        cache_map
            .insert("k".into(), Arc::new(intel_at(NOW - TTL_SECS - 100)))
            .await;

        let (intel, stale) = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || async { Err::<(Vec<CounterItem>, Vec<SynergyItem>), String>("network down".into()) },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(stale, "拉取失败回退过期内存应标 stale");
        assert_eq!(intel.fetched_at, NOW - TTL_SECS - 100);
    }

    #[tokio::test]
    async fn ensure_should_fall_back_to_stale_disk_on_fetch_failure() {
        let cache_map = mem_cache();

        let (intel, stale) = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || async { Err::<(Vec<CounterItem>, Vec<SynergyItem>), String>("network down".into()) },
            |_k| Some(intel_at(NOW - TTL_SECS - 100)),
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(stale, "拉取失败回退过期磁盘应标 stale");
        assert_eq!(intel.fetched_at, NOW - TTL_SECS - 100);
        assert!(cache_map.get("k").await.is_some(), "降级结果应写入内存");
    }

    #[tokio::test]
    async fn ensure_should_err_when_fetch_fails_and_no_cache_anywhere() {
        let cache_map = mem_cache();

        let err = ensure_intel_impl(
            &cache_map,
            "k",
            "global",
            "emerald_plus",
            NOW,
            || async { Err::<(Vec<CounterItem>, Vec<SynergyItem>), String>("network down".into()) },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap_err();

        assert_eq!(err, "network down");
    }

    #[tokio::test]
    async fn ensure_should_keep_region_and_tier_in_fetched_intel() {
        let cache_map = mem_cache();

        let (intel, _stale) = ensure_intel_impl(
            &cache_map,
            "k2",
            "kr",
            "ibsg",
            NOW,
            || async { Ok((vec![], vec![])) },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap();

        assert_eq!(intel.region, "kr");
        assert_eq!(intel.tier, "ibsg");
    }

    /// 真实网络冒烟测试：默认忽略，本机联调时 `cargo test intel -- --ignored` 手动跑。
    #[tokio::test]
    #[ignore]
    async fn live_fetch_should_return_counters_and_synergies() {
        let (counters, synergies) = fetch_champion_intel("global", 34, "TOP", "emerald_plus")
            .await
            .expect("live fetch");
        assert!(!counters.is_empty(), "global emerald_plus 对位应有数据");
        assert!(!synergies.is_empty(), "协同应有数据");
    }
}
