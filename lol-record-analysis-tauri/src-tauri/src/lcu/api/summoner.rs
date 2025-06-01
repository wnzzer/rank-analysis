use crate::lcu::util::http::lcu_get;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summoner {
    pub game_name: String,
    pub tag_line: String,
    pub summoner_level: i32,
    pub profile_icon_id: i32,
    pub puuid: String,
}

impl Summoner {
    pub async fn new_by_puuid(puuid: &str) -> Result<Self, String> {
        let uri = format!("lol-summoner/v2/summoners/puuid/{}", puuid);
        let summoner = lcu_get::<Self>(&uri).await?;
        Ok(summoner)
    }

    pub async fn new_by_name(name: &str) -> Result<Self, String> {
        // 注意：这里假设你需要将 name 作为查询参数传递，例如 ?name=
        // 请根据实际 LCU API 的要求调整 URI 格式
        let uri = format!("lol-summoner/v1/summoners/?name={}", name);
        let summoner = lcu_get::<Self>(&uri).await?;
        Ok(summoner)
    }

    pub async fn get_my_summoner() -> Result<Self, String> {
        let summoner = lcu_get::<Self>("lol-summoner/v1/current-summoner").await?;
        Ok(summoner)
    }
}
