use serde::{Deserialize, Serialize};

use crate::lcu::util::http::lcu_get;

#[derive(Serialize, Deserialize, Debug)]
pub struct MatchHistory {
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "beginIndex")]
    pub begin_index: i32,
    #[serde(rename = "endIndex")]
    pub end_index: i32,
    pub games: GamesWrapper,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GamesWrapper {
    pub games: Vec<Game>,
}

#[derive(Serialize, Deserialize, Debug)]
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

#[derive(Serialize, Deserialize, Debug)]
pub struct GameDetail {
    // Define fields for GameDetail here based on its actual structure.
    // For now, it's a placeholder.
    // Example:
    // pub some_field: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ParticipantIdentity {
    pub player: Player,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Player {
    #[serde(rename = "accountId")]
    pub account_id: i64, // Use i64 for account IDs to be safe
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "summonerName")]
    pub summoner_name: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(rename = "tagLine")]
    pub tag_line: String,
    #[serde(rename = "summonerId")]
    pub summoner_id: i64, // Use i64 for summoner IDs to be safe
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Participant {
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
    pub stats: Stats,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Stats {
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

    // Calculated data - if these are derived and not directly in JSON,
    // you might not include them in the struct for deserialization,
    // or make them Option<i32> if they might be missing.
    // However, if they *are* in the JSON, keep them.
    #[serde(rename = "groupRate")]
    pub group_rate: i32,
    #[serde(rename = "goldEarnedRate")]
    pub gold_earned_rate: i32,
    #[serde(rename = "damageDealtToChampionsRate")]
    pub damage_dealt_to_champions_rate: i32,
    #[serde(rename = "damageTakenRate")]
    pub damage_taken_rate: i32,
    #[serde(rename = "healRate")]
    pub heal_rate: i32,
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
}
