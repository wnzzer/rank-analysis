use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to top-level fields
pub struct Session {
    pub game_data: GameData,
    pub phase: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to GameData fields
pub struct GameData {
    pub game_id: i64, // Using i64 for gameId as it can be a large number
    pub is_custom_game: bool,
    pub queue: Queue,
    pub team_one: Vec<OnePlayer>, // Renamed from TeamOne to team_one
    pub team_two: Vec<OnePlayer>, // Renamed from TeamTwo to team_two
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to Queue fields
pub struct Queue {
    #[serde(rename = "type")] // 'type' is a Rust keyword, so explicitly rename
    pub queue_type: String,
    pub id: i32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to OnePlayer fields
pub struct OnePlayer {
    pub champion_id: i32,
    pub puuid: String,
}

impl Session {
    pub async fn get_session() -> Result<Self, String> {
        let uri = "lol-gameflow/v1/session";
        let session: Self = crate::lcu::util::http::lcu_get(uri).await?;
        Ok(session)
    }
}
