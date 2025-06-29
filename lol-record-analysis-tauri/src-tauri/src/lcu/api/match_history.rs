use crate::lcu::api::model::{Participant, ParticipantIdentity};
use serde::{Deserialize, Serialize};

use crate::lcu::{api::game_detail::GameDetail, util::http::lcu_get};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct MatchHistory {
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "beginIndex")]
    pub begin_index: i32,
    #[serde(rename = "endIndex")]
    pub end_index: i32,
    pub games: GamesWrapper,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct GamesWrapper {
    pub games: Vec<Game>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Game {
    // Note: 'mvp' is marked as "计算信息" (calculated information) in Go,
    // so it might be derived rather than directly from JSON.
    // If it's present in JSON, keep it. If not, consider omitting or making it an Option.
    pub mvp: String,
    #[serde(rename = "gameDetail")]
    pub game_detail: GameDetail, // Assuming GameDetail is another struct you'll define
    #[serde(rename = "gameId")]
    pub game_id: i32,
    #[serde(rename = "gameCreationDate")]
    pub game_creation_date: String, // You might consider using a more specific date/time type
    #[serde(rename = "gameDuration")]
    pub game_duration: i32,
    #[serde(rename = "gameMode")]
    pub game_mode: String,
    #[serde(rename = "gameType")]
    pub game_type: String,
    #[serde(rename = "mapId")]
    pub map_id: i32,
    #[serde(rename = "queueId")]
    pub queue_id: i32,
    #[serde(rename = "queueName")]
    pub queue_name: String,
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "participantIdentities")]
    pub participant_identities: Vec<ParticipantIdentity>,
    pub participants: Vec<Participant>,
}

impl MatchHistory {
    pub async fn get_match_history_by_puuid(
        puuid: &str,
        begin_index: i32,
        end_index: i32,
    ) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/{}/matches?beginIndex={}&endIndex={}",
            puuid, begin_index, end_index
        );
        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }
    pub async fn get_my_match_history(begin_index: i32, end_index: i32) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/me/matches?beginIndex={}&endIndex={}",
            begin_index, end_index
        );
        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }
}
