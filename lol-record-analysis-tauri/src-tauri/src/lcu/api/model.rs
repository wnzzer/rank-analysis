use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
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
    #[serde(rename = "puuid", default)]
    pub puuid: String,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
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

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
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
    #[serde(rename = "groupRate", default)]
    pub group_rate: i32,
    #[serde(rename = "goldEarnedRate", default)]
    pub gold_earned_rate: i32,
    #[serde(rename = "damageDealtToChampionsRate", default)]
    pub damage_dealt_to_champions_rate: i32,
    #[serde(rename = "damageTakenRate", default)]
    pub damage_taken_rate: i32,
    #[serde(rename = "healRate", default)]
    pub heal_rate: i32,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct ParticipantIdentity {
    pub player: Player,
}
