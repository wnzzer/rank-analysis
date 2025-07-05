use std::sync::LazyLock;

use crate::lcu::util::http::lcu_get;
use moka::future::Cache;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summoner {
    pub game_name: String,
    pub tag_line: String,
    pub summoner_level: i32,
    pub profile_icon_id: i32,
    pub puuid: String,
}

static SUMMONER_CACHE: LazyLock<Cache<String, Summoner>> =
    LazyLock::new(|| Cache::builder().max_capacity(500).build());

impl Summoner {
    pub async fn get_summoner_by_puuid(puuid: &str) -> Result<Self, String> {
        if let Some(cached) = SUMMONER_CACHE.get(puuid).await {
            return Ok(cached.clone());
        }

        let uri = format!("lol-summoner/v2/summoners/puuid/{}", puuid);
        let summoner = lcu_get::<Self>(&uri).await?;

        SUMMONER_CACHE
            .insert(puuid.to_string(), summoner.clone())
            .await;
        Ok(summoner)
    }

    pub async fn get_summoner_by_name(name: &str) -> Result<Self, String> {
        if let Some(cached) = SUMMONER_CACHE.get(name).await {
            return Ok(cached.clone());
        }
        let uri = format!("lol-summoner/v1/summoners/?name={}", name);
        let summoner = lcu_get::<Self>(&uri).await?;
        SUMMONER_CACHE
            .insert(name.to_string(), summoner.clone())
            .await;
        Ok(summoner)
    }

    pub async fn get_my_summoner() -> Result<Self, String> {
        let summoner = lcu_get::<Self>("lol-summoner/v1/current-summoner").await?;
        Ok(summoner)
    }
}
