//! # LCU 召唤师 API
//!
//! 对应 `lol-summoner` 相关接口：按 PUUID/名称查询召唤师、当前登录召唤师；带缓存。

use std::sync::LazyLock;

use crate::lcu::util::http::lcu_get;
use moka::future::Cache;
use serde::{Deserialize, Serialize};

/// 召唤师基础信息：游戏名、标签、等级、头像、PUUID。
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
    /// 按 PUUID 获取召唤师信息（带缓存）。
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

    /// 按召唤师名称获取召唤师信息（带缓存）。
    pub async fn get_summoner_by_name(name: &str) -> Result<Self, String> {
        let url_encoding = urlencoding::encode(name);
        if let Some(cached) = SUMMONER_CACHE.get(name).await {
            return Ok(cached.clone());
        }
        let uri = format!("lol-summoner/v1/summoners/?name={}", url_encoding);
        let summoner = lcu_get::<Self>(&uri).await?;
        SUMMONER_CACHE
            .insert(name.to_string(), summoner.clone())
            .await;
        Ok(summoner)
    }

    /// 获取当前登录客户端的召唤师信息。
    pub async fn get_my_summoner() -> Result<Self, String> {
        let summoner = lcu_get::<Self>("lol-summoner/v1/current-summoner").await?;
        Ok(summoner)
    }
}
