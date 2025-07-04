use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to 'queueMap'
pub struct Rank {
    pub queue_map: QueueMap,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to all fields
pub struct QueueInfo {
    // QueueType 表示队列类型，例如 "RANKED_SOLO_5x5"。
    pub queue_type: String,
    // queueTypeCn 是额外的中文描述，我们保持它
    pub queue_type_cn: String,

    // Division 表示玩家当前段位的分段，例如 "I"、"II"。
    pub division: String,
    pub tier: String,
    pub tier_cn: String,

    // HighestDivision 表示玩家历史最高的分段。
    pub highest_division: String,

    // HighestTier 表示玩家历史最高的段位，例如 "Diamond"、"Master"。
    pub highest_tier: String,

    // IsProvisional 表示该队列是否处于定级赛阶段。
    pub is_provisional: bool,

    // LeaguePoints 表示玩家当前的段位点数（LP）。
    pub league_points: i32,

    // Losses 表示玩家在该队列的失败场次。
    pub losses: i32,

    // Wins 表示玩家在该队列的胜利场次。
    pub wins: i32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct QueueMap {
    #[serde(rename = "RANKED_SOLO_5x5")]
    pub ranked_solo_5x5: QueueInfo,
    #[serde(rename = "RANKED_FLEX_SR")]
    pub ranked_flex_sr: QueueInfo,
}

impl Rank {
    pub async fn get_rank_by_puuid(puuid: &str) -> Result<Self, String> {
        let uri = format!("lol-ranked/v1/ranked-stats/{}", puuid);
        let rank: Self = crate::lcu::util::http::lcu_get(&uri).await?;
        Ok(rank)
    }
}
