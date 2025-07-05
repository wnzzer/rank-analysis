use std::sync::LazyLock;

use moka::future::Cache;
use serde::{Deserialize, Serialize};

use crate::lcu::api::model::{Participant, ParticipantIdentity};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct GameDetail {
    #[serde(rename = "endOfGameResult")]
    pub end_of_game_result: String,
    #[serde(rename = "participantIdentities")]
    pub participant_identities: Vec<ParticipantIdentity>, // Renamed to avoid conflict
    pub participants: Vec<Participant>, // Renamed to avoid conflict
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetailParticipantIdentity {
    pub player: GameDetailPlayer, // Renamed to avoid conflict
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetailPlayer {
    #[serde(rename = "accountId")]
    pub account_id: i64,
    pub puuid: String,
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "summonerName")]
    pub summoner_name: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(rename = "tagLine")]
    pub tag_line: String,
    #[serde(rename = "summonerId")]
    pub summoner_id: i64,
}
static GAME_DETAIL_CACHE: LazyLock<Cache<i32, GameDetail>> =
    LazyLock::new(|| Cache::builder().max_capacity(500).build());
impl GameDetail {
    pub async fn get_game_detail_by_id(game_id: &i32) -> Result<Self, String> {
        if let Some(cached) = GAME_DETAIL_CACHE.get(game_id).await {
            return Ok(cached);
        }
        let uri = format!("lol-match-history/v1/games/{}", game_id);
        let game_detail = crate::lcu::util::http::lcu_get::<Self>(&uri).await?;
        // 缓存游戏详情
        GAME_DETAIL_CACHE
            .insert(*game_id, game_detail.clone())
            .await;
        Ok(game_detail)
    }
}
