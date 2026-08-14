//! # Live Client Data API（对局中实时数据）
//!
//! LCU 的 `liveclientdata` 与主 API 是**两个独立服务**：
//! - 主 LCU API：`https://riot:{token}@127.0.0.1:{port}`（需认证，见 util/http.rs）
//! - Live Client：`http://127.0.0.1:2999`（纯 HTTP、无鉴权、仅对局内可用）
//!
//! 本模块轮询 `liveclientdata/allgamedata` 并降级成结构化子集：
//! 双方玩家（英雄/等级/击杀死亡/补刀/装备/经济）+ 事件流（击杀/大小龙/塔）。
//! 「不在对局中」（连接被拒）是正常状态，返回 `Ok(None)`；解析失败才是错误。

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;

const LIVE_CLIENT_BASE: &str = "http://127.0.0.1:2999";
const LIVE_CLIENT_TIMEOUT: Duration = Duration::from_secs(3);

static LIVE_CLIENT: OnceLock<Client> = OnceLock::new();

fn live_client() -> &'static Client {
    LIVE_CLIENT.get_or_init(|| {
        Client::builder()
            // 本地服务，必须绕过代理（与 util/http.rs 同理，防加速器劫持）
            .no_proxy()
            .timeout(LIVE_CLIENT_TIMEOUT)
            .build()
            .expect("failed to build live client http client")
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveScore {
    pub assists: u32,
    pub creep_score: u32,
    pub deaths: u32,
    pub kills: u32,
    pub ward_score: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LiveItem {
    /// liveclientdata 的 key 是 PascalCase `itemID`，与其余字段的 camelCase 不一致
    #[serde(rename = "itemID")]
    pub item_id: u32,
    #[serde(rename = "itemCount")]
    pub item_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveGold {
    pub total: u32,
}

/// 单名玩家实时快照。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePlayer {
    /// 英雄显示名（如 "Ahri"）；与 championKey 不完全一致（如 "MonkeyKing"），
    /// 需要英雄 id 时由前端用召唤师名关联 sessionData 再查 id。
    pub champion_name: String,
    /// LCU 分路标识（NONE/TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）
    pub position: String,
    /// "ORDER" / "CHAOS"
    pub team: String,
    pub is_dead: bool,
    pub summoner_name: String,
    pub level: u32,
    pub items: Vec<LiveItem>,
    pub scores: LiveScore,
    pub gold: LiveGold,
}

/// 事件流条目（allgamedata.events）。
///
/// 事件块整体是 PascalCase（EventID/EventName/EventTime/...），与 players 的
/// camelCase 不同源，必须逐字段 rename。按 EventName 区分：ChampionKill（击杀/
/// 死亡）、DragonKill（含 DragonType）、BaronKill、TurretKilled（含 TowerName）、
/// GameStart 等。可选字段缺失时归一为 None。
#[derive(Debug, Clone, Deserialize)]
pub struct LiveEvent {
    #[serde(rename = "EventName")]
    pub event_name: String,
    #[serde(rename = "EventTime")]
    pub event_time: f64,
    #[serde(rename = "KillerName")]
    pub killer_name: String,
    #[serde(rename = "VictimName")]
    pub victim_name: String,
    #[serde(rename = "DragonType")]
    pub dragon_type: Option<String>,
    #[serde(rename = "TowerName")]
    pub tower_name: Option<String>,
    /// 部分事件类型（GameStart 等）不带 Assisters 字段，缺省空列表
    #[serde(rename = "Assisters", default)]
    pub assisters: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveGameData {
    pub game_mode: String,
    pub game_time: f64,
}

/// 全量实时快照（allgamedata 的结构化子集）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveGameSnapshot {
    pub game_time: f64,
    pub players: Vec<LivePlayer>,
    pub events: Vec<LiveEvent>,
    pub game_data: LiveGameData,
}

/// 获取对局中实时快照。
///
/// # 返回值
/// - `Ok(Some(snapshot))`: 对局中且数据解析成功
/// - `Ok(None)`: 不在对局中（连接被拒 / 非 2xx）——正常状态，不是错误
/// - `Err(String)`: 200 响应但解析失败（数据结构异常，应上报）
pub async fn get_live_game_snapshot() -> Result<Option<LiveGameSnapshot>, String> {
    let url = format!("{LIVE_CLIENT_BASE}/liveclientdata/allgamedata");
    let resp = match live_client().get(&url).send().await {
        Ok(r) => r,
        // 连接失败/超时 = 未在对局中（Live Client 只在游戏内监听）
        Err(_) => return Ok(None),
    };
    if !resp.status().is_success() {
        return Ok(None);
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取 liveclientdata 失败: {e}"))?;
    serde_json::from_str::<LiveGameSnapshot>(&body)
        .map(Some)
        .map_err(|e| format!("liveclientdata 反序列化失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 复现 allgamedata 的 camelCase 字段：确认 rename_all 映射正确。
    const SAMPLE: &str = r#"{
      "gameTime": 623.5,
      "gameData": { "gameMode": "CLASSIC", "gameTime": 623.5 },
      "players": [{
        "championName": "Ahri", "position": "MIDDLE", "team": "ORDER",
        "isDead": false, "summonerName": "midlaner", "level": 13,
        "items": [{"itemID": 3157, "itemCount": 1}],
        "scores": { "assists": 4, "creepScore": 178, "deaths": 1, "kills": 6, "wardScore": 12 },
        "gold": { "total": 11050 }
      }],
      "events": [{
        "EventID": 1, "EventName": "ChampionKill", "EventTime": 601.0,
        "KillerName": "midlaner", "VictimName": "toplaner",
        "Assisters": ["jgler"], "DragonType": null, "TowerName": null
      }]
    }"#;

    #[test]
    fn parses_allgamedata_camelcase_sample() {
        let snapshot: LiveGameSnapshot = serde_json::from_str(SAMPLE).expect("解析失败");
        assert_eq!(snapshot.game_time, 623.5);
        assert_eq!(snapshot.game_data.game_mode, "CLASSIC");

        let p = &snapshot.players[0];
        assert_eq!(p.champion_name, "Ahri");
        assert_eq!(p.position, "MIDDLE");
        assert_eq!(p.team, "ORDER");
        assert!(!p.is_dead);
        assert_eq!(p.items[0].item_id, 3157);
        assert_eq!(p.scores.kills, 6);
        assert_eq!(p.gold.total, 11050);

        let e = &snapshot.events[0];
        assert_eq!(e.event_name, "ChampionKill");
        assert_eq!(e.killer_name, "midlaner");
        assert_eq!(e.victim_name, "toplaner");
        assert_eq!(e.assisters, vec!["jgler"]);
        // 可选字段缺失/为 null → None
        assert!(e.dragon_type.is_none());
        assert!(e.tower_name.is_none());
    }

    #[test]
    fn optional_event_fields_absent_stay_none() {
        // 不带 DragonType/TowerName/Assisters 的事件也应解析成功
        let json = r#"{
          "gameTime": 1.0, "gameData": { "gameMode": "ARAM", "gameTime": 1.0 },
          "players": [], "events": [{
            "EventID": 2, "EventName": "GameStart", "EventTime": 0.0,
            "KillerName": "", "VictimName": ""
          }]
        }"#;
        let snapshot: LiveGameSnapshot = serde_json::from_str(json).expect("解析失败");
        let e = &snapshot.events[0];
        assert!(e.dragon_type.is_none());
        assert!(e.tower_name.is_none());
        assert!(e.assisters.is_empty());
    }
}
