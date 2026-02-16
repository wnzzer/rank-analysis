//! # LCU 对局会话 API
//!
//! 对应 `lol-gameflow/v1/session`，表示当前对局阶段、队列、双方队伍及选人信息。

use serde::{Deserialize, Serialize};

/// 当前游戏流程会话：阶段与对局数据（队伍、队列等）。
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to top-level fields
pub struct Session {
    pub game_data: GameData,
    pub phase: String,
}

/// 选人阶段中单名玩家的英雄与 PUUID。
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerChampionSelection {
    pub champion_id: i32,
    pub puuid: String,
}

/// 对局数据：对局 ID、是否自定义、队列、选人列表、双方队伍。
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to GameData fields
pub struct GameData {
    pub game_id: i64, // Using i64 for gameId as it can be a large number
    pub is_custom_game: bool,
    pub queue: Queue,
    #[serde(default)]
    pub player_champion_selections: Vec<PlayerChampionSelection>,
    pub team_one: Vec<OnePlayer>, // Renamed from TeamOne to team_one
    pub team_two: Vec<OnePlayer>, // Renamed from TeamTwo to team_two
}

/// 队列类型与 ID（如排位/匹配）。
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to Queue fields
pub struct Queue {
    #[serde(rename = "type")] // 'type' is a Rust keyword, so explicitly rename
    pub queue_type: String,
    pub id: i32,
}

/// 会话中单名玩家：英雄 ID 与 PUUID。
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to OnePlayer fields
pub struct OnePlayer {
    pub champion_id: i32,
    pub puuid: String,
}

impl Session {
    /// 请求 LCU 当前对局会话（`lol-gameflow/v1/session`）。
    pub async fn get_session() -> Result<Self, String> {
        let uri = "lol-gameflow/v1/session";
        let session: Self = crate::lcu::util::http::lcu_get(uri).await?;
        Ok(session)
    }
}
