//! # SGP（Service Gateway Proxy）跨区 API
//!
//! 腾讯 SGP 网关是 League 客户端与后端通信的私有 HTTP API。本地 LCU 只能查
//! **当前登录大区**的战绩；要查任意大区（艾欧尼亚/黑色玫瑰/联盟各区…）须直连
//! 目标大区的 SGP 主机。
//!
//! ## 鉴权与路由（均已真机验证，2026-07 TJ100 活客户端）
//! - **token**：本地 LCU `entitlements/v1/token` 的 `accessToken`（用于 match-history）。
//!   token 跨区通用——同一 token 打别的大区主机也被接受（200）。
//! - **主机**：按目标大区 `platformId` 映射（[`crate::constant::game::get_sgp_host`]），
//!   端口 21019，正常公网 TLS。
//! - **当前大区**：`riotclient/region-locale` 只给 `"TENCENT"`，具体 platformId（如
//!   `TJ100`）须从一条战绩的 `platformId` 取。
//!
//! ## 说明
//! 战绩接口 `match-history-query/.../SUMMARY` 返回 **match-v5 扁平结构**（与本地 LCU
//! 的 match-v4 `Game` 结构不同），此模块先返回原始 `serde_json::Value`，映射到前端
//! 消费的结构由上层完成/后续补齐（需对照真实响应，避免盲猜字段）。

use crate::lcu::api::game_detail::GameDetail;
use crate::lcu::api::match_history::{Game, GamesWrapper, MatchHistory};
use crate::lcu::api::model::{
    Participant, ParticipantIdentity, ParticipantTimeline, Perks, Player, Stats,
};
use crate::lcu::api::rank::{QueueInfo, QueueMap, Rank};
use crate::lcu::api::sgp_league_servers;
use crate::lcu::api::summoner::Summoner;
use crate::lcu::util::http::{lcu_get, riot_client_get};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;
use std::time::Duration;

/// SGP 单局详情缓存(无 TTL,局数据不可变;max 500 防爆)。
/// key = `{platform_id}:{game_id}` —— 天然跨源独立,不与 LCU 的 GAME_DETAIL_CACHE 混用。
static SGP_DETAIL_CACHE: LazyLock<Cache<String, SgpGameDetailResponse>> =
    LazyLock::new(|| Cache::builder().max_capacity(500).build());

/// SGP 战绩概要缓存(60s TTL 防串区,key 带 platform_id)。
/// key = `{platform_id}:{puuid}:{start}:{count}`。
static SGP_SUMMARY_CACHE: LazyLock<Cache<String, Value>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(1000)
        .time_to_live(Duration::from_secs(60))
        .build()
});

/// 从本地 LCU 取 SGP 鉴权用的 `accessToken`（`entitlements/v1/token`）。
///
/// 该 token 用于 `match-history-query`，且跨大区通用（已验证）。token 会轮换，
/// 每次请求前重新获取，401 场景由上层重取兜底。
pub async fn get_entitlements_access_token() -> Result<String, String> {
    #[derive(Deserialize)]
    struct EntitlementsToken {
        #[serde(rename = "accessToken", default)]
        access_token: String,
    }
    let t = lcu_get::<EntitlementsToken>("entitlements/v1/token").await?;
    if t.access_token.is_empty() {
        return Err("entitlements accessToken 为空（客户端未就绪？）".to_string());
    }
    Ok(t.access_token)
}

/// 从本地 LCU 取 SGP 会话 token（`lol-league-session/v1/league-session-token`）。
///
/// 该 token 供会话系端点（`leagues-ledge` 段位等）使用，与 entitlements token 分流
/// （对齐 LeagueAkari 的双 token 模型）。响应为裸 JSON 字符串。token 会轮换，
/// 每次请求前重新获取。
pub async fn get_league_session_token() -> Result<String, String> {
    let t = lcu_get::<String>("lol-league-session/v1/league-session-token").await?;
    if t.trim().is_empty() {
        return Err("league-session token 为空（客户端未就绪？）".to_string());
    }
    Ok(t)
}

// ─────────────────────────── 段位 rankedStats ───────────────────────────

/// SGP `leagues-ledge` rankedStats 响应（与 LCU `lol-ranked` 同构，字段缺失 default 容错）。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpRankedStats {
    pub queues: Vec<SgpRankedQueue>,
}

/// rankedStats 中的单个队列段位。tier 缺失 = 未定级；大师及以上无 `rank` 分段。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpRankedQueue {
    pub queue_type: Option<String>,
    pub tier: Option<String>,
    pub rank: Option<String>,
    pub league_points: Option<i32>,
    pub wins: Option<i32>,
    pub losses: Option<i32>,
    pub provisional_games_remaining: Option<i32>,
    pub highest_tier: Option<String>,
    pub highest_rank: Option<String>,
}

/// SGP 段位缓存（30min TTL，对齐 `command/rank.rs` 的 `RANK_CACHE` 语义：
/// 段位一次会话内几乎不变；max 500 防爆）。
/// key = `{platform_id}:{puuid}` —— 带大区防串区。
static SGP_RANKED_CACHE: LazyLock<Cache<String, SgpRankedStats>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(500)
        .time_to_live(Duration::from_secs(30 * 60))
        .build()
});

/// SGP 错误是否为「玩家/大区无记录」（404）——未定级时返回空结构而非报错。
fn is_sgp_not_found(err: &str) -> bool {
    err.contains("非 2xx（404）")
}

/// 错误是否可能源于「主机映射过期」（P1-3 刷新触发条件）：
/// - 401：token 每次现取，不会过期——401 说明旧 host 拒绝新 token（映射过期）
/// - 5xx：上游主机抖动/迁移中，换映射后重试合理
/// - 网络/TLS：旧 host 已下线时表现为连接失败
/// 其余（404 无记录、反序列化失败等）不刷新。
fn is_host_refreshable(err: &str) -> bool {
    err.contains("SGP 非 2xx（401")
        || err.contains("SGP 非 2xx（5")
        || err.contains("SGP 请求失败（网络/TLS）")
}

/// 带主机映射自愈的 SGP GET（P1-3 加固）：
/// `sgp_get` 内置 3 次指数退避重试后仍失败（401/5xx/网络），则强制刷新
/// league-servers 映射（无视 2h 节流）并用新主机重试一次。token 每次现取，
/// 无需在请求层处理 token 轮换。数据通道经 [`crate::lcu::api::sgp_gateway`]
/// 接口（P1-4 DI），业务层不直接依赖 HTTP/静态表。
async fn sgp_get_resilient<T: serde::de::DeserializeOwned>(
    platform_id: &str,
    uri: &str,
    token: &str,
    common: bool,
) -> Result<T, String> {
    let gw = crate::lcu::api::sgp_gateway::gateway();
    let host = gw.resolve_host(platform_id, common).await.ok_or_else(|| {
        if common {
            format!("未知大区 {platform_id}，无对应 SGP common 主机")
        } else {
            format!("未知大区 {platform_id}，无对应 SGP 主机")
        }
    })?;
    match gw.request(host, uri, token).await {
        Ok(body) => serde_json::from_str::<T>(&body).map_err(|e| format!("SGP 反序列化失败: {e}")),
        Err(err) if is_host_refreshable(&err) => {
            log::warn!("SGP 请求失败，刷新主机映射后重试一次: {err}");
            sgp_league_servers::force_refresh().await;
            match gw.resolve_host(platform_id, common).await {
                Some(new_host) => match gw.request(&new_host, uri, token).await {
                    Ok(body) => serde_json::from_str::<T>(&body)
                        .map_err(|e| format!("SGP 反序列化失败: {e}")),
                    Err(retry_err) => Err(retry_err),
                },
                None => Err(err),
            }
        }
        Err(err) => Err(err),
    }
}

/// 拉取指定大区某玩家的段位（`leagues-ledge/v2/rankedStats`）。
///
/// # 参数
/// - `platform_id`: 目标大区（如 `HN10` / `NA1`），映射为 SGP common 主机。
/// - `puuid`: 目标玩家 PUUID（全局唯一，跨区一致）。
///
/// 用 **league-session token**（非战绩用的 entitlements token），走 common 主机
/// （腾讯区与战绩同主机；国际区为 `{region}-red.lol.sgp.pvp.net`）。
/// 404（未定级/该大区无记录）返回空结构，前端自然显示「无段位」。
pub async fn fetch_ranked_stats(platform_id: &str, puuid: &str) -> Result<SgpRankedStats, String> {
    let key = format!("{platform_id}:{puuid}");
    if let Some(cached) = SGP_RANKED_CACHE.get(&key).await {
        return Ok(cached);
    }
    let token = get_league_session_token().await?;
    let uri = format!("leagues-ledge/v2/rankedStats/puuid/{}", puuid);
    match sgp_get_resilient::<SgpRankedStats>(platform_id, &uri, &token, true).await {
        Ok(stats) => {
            SGP_RANKED_CACHE.insert(key, stats.clone()).await;
            Ok(stats)
        }
        Err(e) if is_sgp_not_found(&e) => Ok(SgpRankedStats::default()),
        Err(e) => Err(e),
    }
}

/// SGP rankedStats → 本项目 `Rank`（`queueMap` 结构）。
///
/// 只取单双排/灵活两个队列（前端消费面），其余队列忽略；缺失字段按未定级处理
/// （tier 空串，前端 `hasRealTier` 判空显示「无段位」）；大师以上无分段时
/// division 置 "NA"（对齐 LCU 未定级惯例，高段位展示走胜点不读分段）。
pub fn map_sgp_ranked_stats_to_rank(stats: &SgpRankedStats) -> Rank {
    let mut rank = Rank {
        queue_map: QueueMap {
            ranked_solo_5x5: QueueInfo::default(),
            ranked_flex_sr: QueueInfo::default(),
        },
    };
    for q in &stats.queues {
        let Some(queue_type) = q.queue_type.as_deref() else {
            continue;
        };
        let info = match queue_type {
            "RANKED_SOLO_5x5" => &mut rank.queue_map.ranked_solo_5x5,
            "RANKED_FLEX_SR" => &mut rank.queue_map.ranked_flex_sr,
            _ => continue,
        };
        info.queue_type = queue_type.to_string();
        info.tier = q.tier.clone().unwrap_or_default();
        info.division = q.rank.clone().unwrap_or_else(|| "NA".to_string());
        info.highest_tier = q.highest_tier.clone().unwrap_or_default();
        info.highest_division = q.highest_rank.clone().unwrap_or_default();
        info.is_provisional = q.provisional_games_remaining.unwrap_or(0) > 0;
        info.league_points = q.league_points.unwrap_or(0);
        info.wins = q.wins.unwrap_or(0);
        info.losses = q.losses.unwrap_or(0);
    }
    rank.enrich_cn_info();
    rank
}

/// 当前登录客户端所在大区的 `platformId`（如 `TJ100` / `HN1`）。
///
/// `riotclient/region-locale` 只返回 `region="TENCENT"`，拿不到具体大区，故从当前
/// 召唤师的一条战绩里取 `platformId`（等价现有 `get_platform_name_by_name` 的做法）。
/// 账号无任何对局时无法确定，返回错误。
pub async fn get_current_platform_id() -> Result<String, String> {
    let me = Summoner::get_my_summoner().await?;
    let mh = MatchHistory::get_match_history_by_puuid(&me.puuid, 0, 0).await?;
    if mh.platform_id.is_empty() {
        return Err("无法确定当前大区（该账号可能没有对局记录）".to_string());
    }
    Ok(mh.platform_id)
}

/// 拉取指定大区某玩家的战绩概要（原始 SGP JSON）。
///
/// # 参数
/// - `platform_id`: 目标大区（如 `HN10`）；映射为 SGP 主机。
/// - `puuid`: 目标玩家 PUUID（全局唯一，跨区一致）。
/// - `start` / `count`: 分页起点与条数。
///
/// 返回原始 `Value`（`{ games: [{ metadata, json }] }`）。字段结构见模块说明。
///
/// 60s TTL 缓存：翻页/重复查询不重打网络；key 带 platform_id 防串区。
pub async fn fetch_match_history_summary(
    platform_id: &str,
    puuid: &str,
    start: i32,
    count: i32,
) -> Result<serde_json::Value, String> {
    let key = format!("{platform_id}:{puuid}:{start}:{count}");
    if let Some(cached) = SGP_SUMMARY_CACHE.get(&key).await {
        return Ok(cached);
    }
    let token = get_entitlements_access_token().await?;
    let uri = format!(
        "match-history-query/v1/products/lol/player/{}/SUMMARY?startIndex={}&count={}",
        puuid, start, count
    );
    let raw = sgp_get_resilient::<Value>(platform_id, &uri, &token, false).await?;
    SGP_SUMMARY_CACHE.insert(key, raw.clone()).await;
    Ok(raw)
}

// ─────────────────────────── 单局详情 DETAILS ───────────────────────────

/// 单局详情响应中的单个参与者帧统计（每分钟一条，SGP 独有伤害/坐标）。
///
/// 字段缺失一律 default：腾讯响应随版本演进，宁可 null 不可 panic。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFrameParticipantStats {
    pub current_gold: i32,
    pub total_gold: i32,
    pub gold_per_second: i32,
    pub level: i32,
    pub xp: i32,
    pub minions_killed: i32,
    pub jungle_minions_killed: i32,
    /// 地图坐标（SGP 独有；LCU 源为 0，调用方据此降级）
    pub position: Option<SgpFramePosition>,
    /// 伤害统计（SGP 独有）
    pub damage_stats: Option<SgpFrameDamageStats>,
    /// 时间(分钟)内对敌人造成的控制时间
    pub time_enemy_spent_controlled: Option<f64>,
    /// 攻击/法强等核心属性(可选)
    pub champion_stats: Option<SgpFrameChampionStats>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFramePosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFrameDamageStats {
    pub magic_damage_done: Option<f64>,
    pub magic_damage_done_to_champions: Option<f64>,
    pub physical_damage_done: Option<f64>,
    pub physical_damage_done_to_champions: Option<f64>,
    pub true_damage_done: Option<f64>,
    pub true_damage_done_to_champions: Option<f64>,
    pub total_damage_done: Option<f64>,
    pub total_damage_done_to_champions: Option<f64>,
    pub total_damage_taken: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFrameChampionStats {
    pub attack_damage: Option<f64>,
    pub attack_speed: Option<f64>,
    pub armor: Option<f64>,
    pub magic_resist: Option<f64>,
    pub health: Option<f64>,
    pub health_max: Option<f64>,
    pub movement_speed: Option<f64>,
    pub power: Option<f64>,
}

/// 击杀事件里的伤害明细（谁打了谁、各来源物理/魔法/真实）。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpDamageDetail {
    pub basic: Option<bool>,
    pub magic_damage: Option<i32>,
    pub name: Option<String>,
    pub participant_id: Option<i32>,
    pub physical_damage: Option<i32>,
    pub spell_name: Option<String>,
    pub spell_slot: Option<i32>,
    pub true_damage: Option<i32>,
    /// 来源类型：TOWER / MINION / MONSTER / OTHER
    pub r#type: Option<String>,
}

/// 单局详情里的一条帧事件。///
/// 事件类型参考 Akari `DetailedGameEventType`(DETAILS 端点):击杀/特殊击杀(一血/多杀/团灭)/
/// 建筑/精英怪/塔皮/装备买/卖/撤销/技能加点/插眼/游戏结束。字段缺失 default 容错。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFrameEvent {
    pub r#type: Option<String>,
    pub timestamp: Option<i64>,
    pub participant_id: Option<i32>,
    pub killer_id: Option<i32>,
    pub victim_id: Option<i32>,
    pub assisting_participant_ids: Option<Vec<i32>>,
    pub position: Option<SgpFramePosition>,
    pub kill_type: Option<String>,
    pub multi_kill_length: Option<i32>,
    pub lane_type: Option<String>,
    pub tower_type: Option<String>,
    pub building_type: Option<String>,
    pub team_id: Option<i32>,
    pub monster_type: Option<String>,
    pub monster_sub_type: Option<String>,
    pub level_up_type: Option<String>,
    pub skill_slot: Option<i32>,
    pub item_id: Option<i32>,
    pub after_id: Option<i32>,
    pub before_id: Option<i32>,
    pub ward_type: Option<String>,
    /// CHAMPION_KILL 事件的伤害明细(SGP 独有)
    pub victim_damage_dealt: Option<Vec<SgpDamageDetail>>,
    pub victim_damage_received: Option<Vec<SgpDamageDetail>>,
    pub victim_teamfight_damage_dealt: Option<Vec<SgpDamageDetail>>,
    pub victim_teamfight_damage_received: Option<Vec<SgpDamageDetail>>,
    pub game_end_result: Option<String>,
}

/// 单局详情的一条帧(约每分钟一条)。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpFrame {
    pub timestamp: Option<i64>,
    pub events: Vec<SgpFrameEvent>,
    /// participantId → 该分钟的统计
    pub participant_frames: std::collections::HashMap<i32, SgpFrameParticipantStats>,
}

/// DETAILS 响应的 `json` 体。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpGameDetail {
    pub end_of_game_result: Option<String>,
    pub frame_interval: Option<i64>,
    pub frames: Vec<SgpFrame>,
    /// SGP 的 DETAILS participants 只给 `{ participantId, puuid }`,身份对齐靠 SUMMARY
    pub participants: Vec<SgpDetailParticipant>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpDetailParticipant {
    pub participant_id: Option<i32>,
    pub puuid: Option<String>,
}

/// DETAILS 响应整体: `{ metadata, json }`。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpGameDetailResponse {
    pub metadata: Option<Value>,
    pub json: Option<SgpGameDetail>,
}

/// 拉取指定大区某局对局的详情(帧数据/事件流/伤害明细)。
///
/// # 参数
/// - `platform_id`: 目标大区(如 `HN10`),映射为 SGP 主机。
/// - `game_id`: 对局 ID(SGP 路径格式为 `{platform_id}_{game_id}`,如 `HN10_8537174104`)。
///
/// 返回类型化结构(serde 全字段 default 容错)。身份/汇总字段在 SUMMARY 里,本端点只出帧。
///
/// 无 TTL 缓存(局数据不可变,max 500):详情页重复展开零网络。
pub async fn fetch_match_detail(
    platform_id: &str,
    game_id: i64,
) -> Result<SgpGameDetailResponse, String> {
    let key = format!("{platform_id}:{game_id}");
    if let Some(cached) = SGP_DETAIL_CACHE.get(&key).await {
        return Ok(cached);
    }
    let token = get_entitlements_access_token().await?;
    let uri = format!(
        "match-history-query/v1/products/lol/{}_{}/DETAILS",
        platform_id, game_id
    );
    let raw = sgp_get_resilient::<SgpGameDetailResponse>(platform_id, &uri, &token, false).await?;
    SGP_DETAIL_CACHE.insert(key, raw.clone()).await;
    Ok(raw)
}

// ─────────────────────────── name#TAG → puuid ───────────────────────────
/// 拆分 `名字#TAG`。全区查询必须带 TAG（SGP alias 查询需要 gameName+tagLine）。
fn split_riot_id(name: &str) -> Result<(String, String), String> {
    match name.rsplit_once('#') {
        Some((g, t)) if !g.trim().is_empty() && !t.trim().is_empty() => {
            Ok((g.trim().to_string(), t.trim().to_string()))
        }
        _ => Err("跨区查询需要完整的「名字#TAG」格式".to_string()),
    }
}

/// `name#TAG → 全局 puuid`（走 **Riot Client** 端口的 RSO alias 查询，非 LCU 端口）。
///
/// puuid 全局唯一、跨区一致，拿到后即可查任意大区。RC 认证由
/// [`crate::lcu::util::token::get_riot_client_auth`] 从 LCU 命令行提取。
pub async fn resolve_puuid_by_riot_id(game_name: &str, tag_line: &str) -> Result<String, String> {
    let (token, port) = crate::lcu::util::token::get_riot_client_auth()?;
    let uri = format!(
        "player-account/aliases/v1/lookup?gameName={}&tagLine={}",
        urlencoding::encode(game_name),
        urlencoding::encode(tag_line),
    );
    // 返回形如 [{ "puuid": "...", "alias": { "game_name": ..., "tag_line": ... } }]
    let arr: Value = riot_client_get(&port, &token, &uri).await?;
    arr.as_array()
        .and_then(|a| {
            a.iter()
                .find_map(|e| e.get("puuid").and_then(Value::as_str))
        })
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("未找到玩家 {}#{}", game_name, tag_line))
}

// ─────────────────────────── SGP → Game 映射 ───────────────────────────

/// epoch 毫秒 → ISO8601 UTC 字符串（如 `2021-01-01T00:00:00.000Z`）。
///
/// SGP 的 `gameCreation` 是毫秒时间戳，而现有 `Game.game_creation_date` 是 ISO 字符串
/// （前端按 `new Date(str)` 解析）。无 chrono 依赖，用 Howard Hinnant 的历法算法手算。
fn epoch_ms_to_iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        millis
    )
}

/// 自 1970-01-01 起的天数 → (年, 月, 日)。Howard Hinnant `civil_from_days`。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn i32_at(v: &Value, key: &str) -> i32 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0) as i32
}

/// 扁平 SGP participant → LCU `Participant`（含从 perks.styles 回填符文）。
fn map_participant(p: &Value) -> Participant {
    // Stats 需要的扁平字段（item0-6/kills/goldEarned/totalHeal/...）SGP 同名存在，
    // 直接反序列化；perkPrimaryStyle/perkSubStyle 已加 default，随后回填。
    let mut stats: Stats = serde_json::from_value(p.clone()).unwrap_or_default();
    if let Some(styles) = p.pointer("/perks/styles").and_then(Value::as_array) {
        stats.perk_primary_style = styles
            .first()
            .and_then(|s| s.get("style"))
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;
        stats.perk_sub_style = styles
            .get(1)
            .and_then(|s| s.get("style"))
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;
        stats.perk0 = styles
            .first()
            .and_then(|s| s.pointer("/selections/0/perk"))
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;
    }
    Participant {
        participant_id: i32_at(p, "participantId"),
        team_id: i32_at(p, "teamId"),
        champion_id: i32_at(p, "championId"),
        spell1_id: i32_at(p, "spell1Id"),
        spell2_id: i32_at(p, "spell2Id"),
        // 完整符文页透传（match-v5 的 perks 与 LCU 同构）；解析失败按 None 降级
        perks: p
            .get("perks")
            .and_then(|v| serde_json::from_value::<Perks>(v.clone()).ok()),
        // 分路透传（match-v5 的 timeline.lane/role；缺失或解析失败按 None 降级）
        timeline: p
            .get("timeline")
            .and_then(|v| serde_json::from_value::<ParticipantTimeline>(v.clone()).ok()),
        stats,
    }
}

/// 扁平 SGP participant → `ParticipantIdentity`（SGP 无 participantIdentities，需自拼）。
fn map_identity(p: &Value, platform_id: &str) -> ParticipantIdentity {
    let s = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let game_name = s("riotIdGameName");
    ParticipantIdentity {
        player: Player {
            account_id: 0, // SGP 不提供 accountId
            platform_id: platform_id.to_string(),
            summoner_name: if game_name.is_empty() {
                s("summonerName")
            } else {
                game_name.clone()
            },
            game_name,
            tag_line: s("riotIdTagline"),
            summoner_id: p.get("summonerId").and_then(Value::as_i64).unwrap_or(0),
            puuid: s("puuid"),
        },
    }
}

/// 原始 SGP 响应 → 现有 `MatchHistory`（前端 RecordCard 等原样复用）。
///
/// 关键：`game.participants[0]` / `participant_identities[0]` 置为被查玩家（前端以
/// [0] 为「我」）；全 10 人放进 `game_detail`（TeamAvatarGroup 用 + `calculate` 算占比）。
/// 随后本地跑 `enrich_info_cn`（队列中文名）与 `calculate`（占比/MVP），**不触任何 LCU**。
pub fn map_sgp_to_match_history(raw: &Value, platform_id: &str, my_puuid: &str) -> MatchHistory {
    let mut games: Vec<Game> = Vec::new();

    if let Some(arr) = raw.get("games").and_then(Value::as_array) {
        for g in arr {
            let Some(json) = g.get("json") else { continue };
            let sgp_ps = json
                .get("participants")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let all_participants: Vec<Participant> = sgp_ps.iter().map(map_participant).collect();
            let all_identities: Vec<ParticipantIdentity> = sgp_ps
                .iter()
                .map(|p| map_identity(p, platform_id))
                .collect();
            let me_idx = sgp_ps
                .iter()
                .position(|p| p.get("puuid").and_then(Value::as_str) == Some(my_puuid))
                .unwrap_or(0);

            let iso = epoch_ms_to_iso(
                json.get("gameCreation")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            );
            let game_duration = i32_at(json, "gameDuration");
            let game_mode = json
                .get("gameMode")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let game_type = json
                .get("gameType")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let map_id = i32_at(json, "mapId");
            let queue_id = i32_at(json, "queueId");
            let plat = json
                .get("platformId")
                .and_then(Value::as_str)
                .unwrap_or(platform_id)
                .to_string();

            let game_detail = GameDetail {
                end_of_game_result: json
                    .get("endOfGameResult")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                participant_identities: all_identities.clone(),
                participants: all_participants.clone(),
                game_creation_date: iso.clone(),
                game_duration,
                game_mode: game_mode.clone(),
                game_type: game_type.clone(),
                map_id,
                queue_id,
                platform_id: plat.clone(),
                // SGP 未必提供 gameVersion；缺失时留空，回放可用性判定会据此放行
                // 而不是武断禁用（见 command::replay::judge_availability）。
                game_version: json
                    .get("gameVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            };

            games.push(Game {
                mvp: String::new(),
                queue_name: String::new(),
                game_detail,
                game_id: json.get("gameId").and_then(Value::as_i64).unwrap_or(0),
                game_creation_date: iso,
                game_duration,
                game_mode,
                game_type,
                map_id,
                queue_id,
                platform_id: plat,
                participant_identities: vec![all_identities
                    .get(me_idx)
                    .cloned()
                    .unwrap_or_default()],
                participants: vec![all_participants.get(me_idx).cloned().unwrap_or_default()],
            });
        }
    }

    let mut mh = MatchHistory {
        platform_id: platform_id.to_string(),
        beg_index: 0,
        end_index: 0,
        games: GamesWrapper { games },
    };
    let _ = mh.enrich_info_cn(); // 队列中文名
    let _ = mh.calculate(); // 占比 / MVP（SGP 已含全 10 人，无需 LCU 详情）
    mh
}

/// 全区按 `名字#TAG` 查战绩：解析 puuid（RC）→ 拉 SGP → 映射为 `MatchHistory`。
///
/// 这是「全区搜索」的对外主入口。段位/标签不跨区，故只出战绩列表。
pub async fn get_match_history_by_name(
    region: &str,
    name: &str,
    beg_index: i32,
    count: i32,
) -> Result<MatchHistory, String> {
    let (game_name, tag_line) = split_riot_id(name)?;
    let puuid = resolve_puuid_by_riot_id(&game_name, &tag_line).await?;
    let raw = fetch_match_history_summary(region, &puuid, beg_index, count).await?;
    let mut mh = map_sgp_to_match_history(&raw, region, &puuid);
    mh.beg_index = beg_index;
    mh.end_index = beg_index + count.max(1) - 1;
    Ok(mh)
}

/// 跨区按「名字#TAG」查玩家段位：解析 puuid（RC）→ SGP rankedStats → 映射 `Rank`。
///
/// 这是「跨区段位」的对外主入口（玩家条/详情页共用同一映射）。
pub async fn get_rank_by_name(region: &str, name: &str) -> Result<Rank, String> {
    let (game_name, tag_line) = split_riot_id(name)?;
    let puuid = resolve_puuid_by_riot_id(&game_name, &tag_line).await?;
    let stats = fetch_ranked_stats(region, &puuid).await?;
    Ok(map_sgp_ranked_stats_to_rank(&stats))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_ms_to_iso_known_values() {
        assert_eq!(epoch_ms_to_iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            epoch_ms_to_iso(1_609_459_200_000),
            "2021-01-01T00:00:00.000Z"
        );
        assert_eq!(
            epoch_ms_to_iso(1_609_459_200_123),
            "2021-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn split_riot_id_requires_tag() {
        assert_eq!(
            split_riot_id("名字#1234").unwrap(),
            ("名字".into(), "1234".into())
        );
        assert!(split_riot_id("名字").is_err());
        assert!(split_riot_id("名字#").is_err());
    }

    // 用 from_str 解析原始 JSON 字符串（避免深层 json! 宏触发递归展开上限）。
    const SAMPLE_JSON: &str = r#"{ "games": [ { "json": {
        "gameId": 300907904093, "gameCreation": 1609459200000,
        "gameDuration": 1800, "gameMode": "CLASSIC", "gameType": "MATCHED_GAME",
        "mapId": 11, "queueId": 420, "platformId": "TJ100",
        "endOfGameResult": "GameComplete",
        "participants": [
            { "participantId": 1, "teamId": 100, "championId": 897, "spell1Id": 14, "spell2Id": 4,
              "win": true, "kills": 8, "deaths": 2, "assists": 5,
              "item0": 1011, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 3364,
              "goldEarned": 13200, "goldSpent": 13000,
              "totalDamageDealtToChampions": 28660, "totalDamageDealt": 100000,
              "totalDamageTaken": 47327, "totalHeal": 8485,
              "totalMinionsKilled": 167, "neutralMinionsKilled": 0,
              "puuid": "me-puuid", "riotIdGameName": "我", "riotIdTagline": "1234",
              "summonerName": "我", "summonerId": 111,
              "perks": { "statPerks": { "defense": 5008, "flex": 5008, "offense": 5008 },
                "styles": [ { "style": 8100, "selections": [ { "perk": 8112 }, { "perk": 9111 }, { "perk": 9112 } ] },
                            { "style": 8000, "selections": [ { "perk": 8275 }, { "perk": 8347 } ] } ] } },
            { "participantId": 2, "teamId": 100, "championId": 200, "spell1Id": 4, "spell2Id": 7,
              "win": true, "kills": 3, "deaths": 5, "assists": 10,
              "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
              "goldEarned": 8000, "goldSpent": 7000,
              "totalDamageDealtToChampions": 12000, "totalDamageDealt": 50000,
              "totalDamageTaken": 20000, "totalHeal": 3000,
              "totalMinionsKilled": 20, "neutralMinionsKilled": 100,
              "puuid": "other", "riotIdGameName": "队友", "riotIdTagline": "5678",
              "summonerName": "队友", "summonerId": 222,
              "perks": { "statPerks": { "defense": 5001, "flex": 5002, "offense": 5003 },
                "styles": [ { "style": 8200, "selections": [ { "perk": 8214 }, { "perk": 9211 }, { "perk": 9212 } ] },
                            { "style": 8400, "selections": [ { "perk": 8473 }, { "perk": 8453 } ] } ] } }
        ],
        "teams": [ { "teamId": 100, "win": true } ]
    } } ] }"#;

    fn sample_raw() -> Value {
        serde_json::from_str(SAMPLE_JSON).unwrap()
    }

    #[test]
    fn map_puts_queried_player_first_and_fills_stats() {
        let mh = map_sgp_to_match_history(&sample_raw(), "TJ100", "me-puuid");
        assert_eq!(mh.platform_id, "TJ100");
        assert_eq!(mh.games.games.len(), 1);
        let g = &mh.games.games[0];

        // participants[0] = 被查玩家（我）
        assert_eq!(g.participants.len(), 1);
        assert_eq!(g.participants[0].champion_id, 897);
        assert_eq!(g.participants[0].spell1_id, 14);
        assert_eq!(g.participants[0].stats.kills, 8);
        assert!(g.participants[0].stats.win);
        // 符文从 perks.styles 回填
        assert_eq!(g.participants[0].stats.perk_primary_style, 8100);
        assert_eq!(g.participants[0].stats.perk_sub_style, 8000);
        assert_eq!(g.participants[0].stats.perk0, 8112);
        // 完整符文页透传：game_detail 的 participants 带 perks（styles 全量 + statPerks）
        let perks = g.game_detail.participants[0].perks.as_ref().unwrap();
        assert_eq!(perks.styles.len(), 2);
        assert_eq!(perks.styles[0].style, 8100);
        assert_eq!(perks.styles[0].selections.len(), 3);
        assert_eq!(perks.styles[1].selections.len(), 2);
        assert_eq!(perks.stat_perks.as_ref().unwrap().offense, 5008);
        // 身份[0] = 我
        assert_eq!(g.participant_identities[0].player.game_name, "我");
        assert_eq!(g.participant_identities[0].player.tag_line, "1234");

        // 全 10 人（此样本 2 人）进 game_detail
        assert_eq!(g.game_detail.participants.len(), 2);
        assert_eq!(g.game_detail.end_of_game_result, "GameComplete");

        // 元信息
        assert_eq!(g.game_id, 300907904093);
        assert_eq!(g.queue_id, 420);
        assert_eq!(g.game_creation_date, "2021-01-01T00:00:00.000Z");
        // enrich_info_cn 填了中文队列名（420=单双排）
        assert_eq!(g.queue_name, "单双排");
        // calculate 跑过：占比被算出（我 gold 13200 / 队伍 21200 ≈ 62%）
        assert!(g.participants[0].stats.gold_earned_rate > 0);
    }

    #[test]
    fn map_selects_correct_player_by_puuid() {
        // 以 "other" 视角查：participants[0] 应是队友（champion 200）
        let mh = map_sgp_to_match_history(&sample_raw(), "TJ100", "other");
        assert_eq!(mh.games.games[0].participants[0].champion_id, 200);
    }

    // ── DETAILS 解析容错 ──

    #[test]
    fn parse_sgp_detail_response_full() {
        let raw = r#"{
          "metadata": { "dataVersion": "2.4" },
          "json": {
            "endOfGameResult": "GameComplete",
            "frameInterval": 60000,
            "participants": [
              { "participantId": 1, "puuid": "me-puuid" },
              { "participantId": 2, "puuid": "other-puuid" }
            ],
            "frames": [
              {
                "timestamp": 60000,
                "events": [
                  {
                    "type": "CHAMPION_KILL",
                    "timestamp": 60000,
                    "killerId": 1,
                    "victimId": 2,
                    "assistingParticipantIds": [3],
                    "position": { "x": 5000, "y": 5000 },
                    "victimDamageReceived": [
                      { "name": "伤害来源", "participantId": 1, "physicalDamage": 100, "magicDamage": 50, "trueDamage": 10, "type": "OTHER" }
                    ]
                  },
                  { "type": "SKILL_LEVEL_UP", "participantId": 1, "skillSlot": 0, "levelUpType": "NORMAL" },
                  { "type": "ITEM_PURCHASED", "participantId": 1, "itemId": 3153 }
                ],
                "participantFrames": {
                  "1": {
                    "currentGold": 1000, "totalGold": 1500, "goldPerSecond": 8, "level": 5, "xp": 900,
                    "minionsKilled": 40, "jungleMinionsKilled": 2,
                    "position": { "x": 5100, "y": 5100 },
                    "damageStats": { "totalDamageDoneToChampions": 1200, "totalDamageTaken": 800 },
                    "timeEnemySpentControlled": 3.5
                  }
                }
              }
            ]
          }
        }"#;
        let resp: SgpGameDetailResponse = serde_json::from_str(raw).unwrap();
        let json = resp.json.expect("json 非空");
        assert_eq!(json.end_of_game_result.as_deref(), Some("GameComplete"));
        assert_eq!(json.frame_interval, Some(60000));
        assert_eq!(json.participants.len(), 2);
        assert_eq!(json.participants[1].puuid.as_deref(), Some("other-puuid"));

        let frame = &json.frames[0];
        assert_eq!(frame.timestamp, Some(60000));
        // 事件:击杀(带伤害明细)、技能加点、装备购买
        assert_eq!(frame.events.len(), 3);
        let kill = &frame.events[0];
        assert_eq!(kill.r#type.as_deref(), Some("CHAMPION_KILL"));
        assert_eq!(kill.killer_id, Some(1));
        assert_eq!(kill.position.as_ref().map(|p| p.x), Some(5000));
        let received = kill.victim_damage_received.as_ref().unwrap();
        assert_eq!(received[0].physical_damage, Some(100));
        assert_eq!(received[0].r#type.as_deref(), Some("OTHER"));

        // 帧统计:金/CS/坐标/伤害
        let ps = frame
            .participant_frames
            .get(&1)
            .expect("有 participantId=1");
        assert_eq!(ps.total_gold, 1500);
        assert_eq!(ps.minions_killed, 40);
        assert_eq!(ps.position.as_ref().map(|p| p.y), Some(5100));
        let ds = ps.damage_stats.as_ref().expect("SGP 独有伤害字段");
        assert_eq!(ds.total_damage_done_to_champions, Some(1200.0));
        assert_eq!(ps.time_enemy_spent_controlled, Some(3.5));
    }

    #[test]
    fn parse_sgp_detail_response_tolerant_of_missing_fields() {
        // 帧缺 damageStats/position、事件缺字段时不得 panic,全部 default
        let raw = r#"{ "json": { "frames": [ { "events": [ { "type": "GAME_END" } ] } ] } }"#;
        let resp: SgpGameDetailResponse = serde_json::from_str(raw).unwrap();
        let json = resp.json.unwrap();
        assert!(json.end_of_game_result.is_none());
        assert_eq!(json.frames.len(), 1);
        assert!(json.frames[0].participant_frames.is_empty());
        assert_eq!(json.frames[0].events[0].r#type.as_deref(), Some("GAME_END"));
        assert!(json.frames[0].events[0].victim_damage_received.is_none());
    }

    #[test]
    fn parse_sgp_detail_response_unknown_fields_ignored() {
        // 腾讯新增未知字段(如新事件类型)不得破坏解析
        let raw = r#"{ "json": { "frames": [ { "timestamp": 0, "events": [ { "type": "NEW_FANCY_EVENT", "futureField": 42 } ] } ] } }"#;
        let resp: SgpGameDetailResponse = serde_json::from_str(raw).unwrap();
        let ev = &resp.json.unwrap().frames[0].events[0];
        assert_eq!(ev.r#type.as_deref(), Some("NEW_FANCY_EVENT"));
        // 未来字段被忽略
        assert_eq!(ev.item_id, None);
    }

    // ── SGP 缓存(F3-1)──

    #[tokio::test]
    async fn detail_cache_hits_after_fetch() {
        // 直接验证缓存层:插入后可取回(网络层 mock 由上层测试覆盖,这里只测缓存行为)
        let entry = SgpGameDetailResponse {
            metadata: None,
            json: Some(SgpGameDetail {
                end_of_game_result: Some("GameComplete".into()),
                frame_interval: Some(60000),
                frames: vec![],
                participants: vec![],
            }),
        };
        SGP_DETAIL_CACHE
            .insert("TJ100:42".into(), entry.clone())
            .await;
        let got = SGP_DETAIL_CACHE.get(&"TJ100:42".to_string()).await;
        assert!(got.is_some());
        assert_eq!(
            got.unwrap().json.unwrap().end_of_game_result.as_deref(),
            Some("GameComplete")
        );
        // 不同 key(跨区)不串
        assert!(SGP_DETAIL_CACHE.get(&"HN10:42".to_string()).await.is_none());
    }

    #[tokio::test]
    async fn detail_cache_key_includes_platform() {
        SGP_DETAIL_CACHE
            .insert("TJ100:7".into(), SgpGameDetailResponse::default())
            .await;
        // 同 gameId 不同大区:key 不同 → 未命中(防串区)
        assert!(SGP_DETAIL_CACHE.get(&"HN10:7".to_string()).await.is_none());
    }

    // ── rankedStats → Rank 映射（F1：段位直查）──

    /// 用 from_str 解析（避免深层 json! 宏），构造完整双队列 rankedStats 样本。
    const RANKED_SAMPLE: &str = r#"{
        "queues": [
            { "queueType": "RANKED_SOLO_5x5", "tier": "GOLD", "rank": "II", "leaguePoints": 45,
              "wins": 12, "losses": 8, "provisionalGamesRemaining": 0,
              "highestTier": "PLATINUM", "highestRank": "III" },
            { "queueType": "RANKED_FLEX_SR", "tier": "DIAMOND", "rank": "IV", "leaguePoints": 3,
              "wins": 40, "losses": 20, "provisionalGamesRemaining": 0,
              "highestTier": "DIAMOND", "highestRank": "II" }
        ]
    }"#;

    #[test]
    fn map_ranked_stats_maps_both_queues_with_cn() {
        let stats: SgpRankedStats = serde_json::from_str(RANKED_SAMPLE).unwrap();
        let rank = map_sgp_ranked_stats_to_rank(&stats);
        let solo = &rank.queue_map.ranked_solo_5x5;
        assert_eq!(solo.tier, "GOLD");
        assert_eq!(solo.tier_cn, "荣耀黄金");
        assert_eq!(solo.division, "II");
        assert_eq!(solo.league_points, 45);
        assert_eq!(solo.wins, 12);
        assert_eq!(solo.losses, 8);
        assert_eq!(solo.highest_tier, "PLATINUM");
        assert_eq!(solo.queue_type_cn, "单双排");
        assert!(!solo.is_provisional);
        let flex = &rank.queue_map.ranked_flex_sr;
        assert_eq!(flex.tier, "DIAMOND");
        assert_eq!(flex.tier_cn, "璀璨钻石");
        assert_eq!(flex.division, "IV");
        assert_eq!(flex.queue_type_cn, "灵活组排");
    }

    #[test]
    fn map_ranked_stats_unranked_defaults_to_empty() {
        // 未定级：queues 里没有该队列 / 缺 tier → 空串（前端 hasRealTier 判空显示「无段位」）
        let stats: SgpRankedStats = serde_json::from_str(r#"{ "queues": [] }"#).unwrap();
        let rank = map_sgp_ranked_stats_to_rank(&stats);
        assert_eq!(rank.queue_map.ranked_solo_5x5.tier, "");
        assert_eq!(rank.queue_map.ranked_solo_5x5.tier_cn, "无");
        assert_eq!(rank.queue_map.ranked_flex_sr.tier, "");
    }

    #[test]
    fn map_ranked_stats_master_has_no_division() {
        // 大师及以上没有 rank 分段 → division 落 "NA"（展示走胜点，不读分段）
        let stats: SgpRankedStats = serde_json::from_str(
            r#"{ "queues": [ { "queueType": "RANKED_SOLO_5x5", "tier": "MASTER",
                "leaguePoints": 234, "wins": 90, "losses": 70 } ] }"#,
        )
        .unwrap();
        let rank = map_sgp_ranked_stats_to_rank(&stats);
        let solo = &rank.queue_map.ranked_solo_5x5;
        assert_eq!(solo.tier, "MASTER");
        assert_eq!(solo.division, "NA");
        assert_eq!(solo.league_points, 234);
    }

    #[test]
    fn map_ranked_stats_provisional_detection() {
        // 定级赛中（provisionalGamesRemaining > 0）→ is_provisional
        let stats: SgpRankedStats = serde_json::from_str(
            r#"{ "queues": [ { "queueType": "RANKED_SOLO_5x5", "tier": "SILVER", "rank": "I",
                "provisionalGamesRemaining": 3, "wins": 0, "losses": 0 } ] }"#,
        )
        .unwrap();
        let rank = map_sgp_ranked_stats_to_rank(&stats);
        assert!(rank.queue_map.ranked_solo_5x5.is_provisional);
        assert_eq!(rank.queue_map.ranked_solo_5x5.tier_cn, "不屈白银");
    }

    #[test]
    fn map_ranked_stats_ignores_unknown_queues() {
        // 非双排队列（如 TFT/斗魂）不进入 queueMap，也不 panic
        let stats: SgpRankedStats = serde_json::from_str(
            r#"{ "queues": [ { "queueType": "RANKED_TFT", "tier": "GOLD" } ] }"#,
        )
        .unwrap();
        let rank = map_sgp_ranked_stats_to_rank(&stats);
        assert_eq!(rank.queue_map.ranked_solo_5x5.tier, "");
        assert_eq!(rank.queue_map.ranked_flex_sr.tier, "");
    }

    #[test]
    fn sgp_not_found_matches_404_error_text() {
        assert!(is_sgp_not_found("SGP 非 2xx（404）: 404 Not Found"));
        assert!(!is_sgp_not_found("SGP 非 2xx（401）: unauthorized"));
        assert!(!is_sgp_not_found("SGP 请求失败（网络/TLS）: timeout"));
    }
}
