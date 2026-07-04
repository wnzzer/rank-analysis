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

use crate::constant;
use crate::lcu::api::game_detail::GameDetail;
use crate::lcu::api::match_history::{Game, GamesWrapper, MatchHistory};
use crate::lcu::api::model::{Participant, ParticipantIdentity, Player, Stats};
use crate::lcu::api::summoner::Summoner;
use crate::lcu::util::http::{lcu_get, riot_client_get, sgp_get};
use serde::Deserialize;
use serde_json::Value;

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
pub async fn fetch_match_history_summary(
    platform_id: &str,
    puuid: &str,
    start: i32,
    count: i32,
) -> Result<serde_json::Value, String> {
    let host = constant::game::get_sgp_host(platform_id)
        .ok_or_else(|| format!("未知大区 {}，无对应 SGP 主机", platform_id))?;
    let token = get_entitlements_access_token().await?;
    let uri = format!(
        "match-history-query/v1/products/lol/player/{}/SUMMARY?startIndex={}&count={}",
        puuid, start, count
    );
    sgp_get::<Value>(host, &uri, &token).await
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
              "perks": { "styles": [ { "style": 8100, "selections": [ { "perk": 8112 } ] }, { "style": 8000 } ] } },
            { "participantId": 2, "teamId": 100, "championId": 200, "spell1Id": 4, "spell2Id": 7,
              "win": true, "kills": 3, "deaths": 5, "assists": 10,
              "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
              "goldEarned": 8000, "goldSpent": 7000,
              "totalDamageDealtToChampions": 12000, "totalDamageDealt": 50000,
              "totalDamageTaken": 20000, "totalHeal": 3000,
              "totalMinionsKilled": 20, "neutralMinionsKilled": 100,
              "puuid": "other", "riotIdGameName": "队友", "riotIdTagline": "5678",
              "summonerName": "队友", "summonerId": 222,
              "perks": { "styles": [ { "style": 8200, "selections": [ { "perk": 8214 } ] }, { "style": 8400 } ] } }
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
}
