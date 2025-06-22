use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetail {
    #[serde(rename = "endOfGameResult")]
    pub end_of_game_result: String,
    #[serde(rename = "participantIdentities")]
    pub participant_identities: Vec<GameDetailParticipantIdentity>, // Renamed to avoid conflict
    pub participants: Vec<GameDetailParticipant>, // Renamed to avoid conflict
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

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetailParticipant {
    #[serde(rename = "championKey")]
    pub champion_key: String,
    #[serde(rename = "participantId")]
    pub participant_id: i32,
    #[serde(rename = "teamId")]
    pub team_id: i32,
    #[serde(rename = "championId")]
    pub champion_id: i32,
    #[serde(rename = "spell1Id")]
    pub spell1_id: i32,

    #[serde(rename = "spell2Id")]
    pub spell2_id: i32,

    pub stats: GameDetailStats, // Renamed to avoid conflict
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetailStats {
    pub win: bool,
    #[serde(rename = "item0")]
    pub item0: i32,
    #[serde(rename = "item1")]
    pub item1: i32,
    #[serde(rename = "item2")]
    pub item2: i32,
    #[serde(rename = "item3")]
    pub item3: i32,
    #[serde(rename = "item4")]
    pub item4: i32,
    #[serde(rename = "item5")]
    pub item5: i32,
    #[serde(rename = "item6")]
    pub item6: i32,

    #[serde(rename = "perkPrimaryStyle")]
    pub perk_primary_style: i32,
    #[serde(rename = "perkSubStyle")]
    pub perk_sub_style: i32,

    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,

    #[serde(rename = "goldEarned")]
    pub gold_earned: i32,
    #[serde(rename = "goldSpent")]
    pub gold_spent: i32,
    #[serde(rename = "totalDamageDealtToChampions")]
    pub total_damage_dealt_to_champions: i32,
    #[serde(rename = "totalDamageDealt")]
    pub total_damage_dealt: i32,
    #[serde(rename = "totalDamageTaken")]
    pub total_damage_taken: i32,
    #[serde(rename = "totalHeal")]
    pub total_heal: i32,
    #[serde(rename = "totalMinionsKilled")]
    pub total_minions_killed: i32,
}

impl GameDetail {
    pub async fn get_game_detail_by_id(game_id: &str) -> Result<Self, String> {
        let uri = format!("lol-match-history/v1/games/{}", game_id);
        let game_detail = crate::lcu::util::http::lcu_get::<Self>(&uri).await?;
        Ok(game_detail)
    }
}
