//! # LCU 段位 API
//!
//! 对应 `lol-ranked`：按 PUUID 获取排位统计；含单双排与灵活组排队列信息。

use std::sync::LazyLock;

use crate::constant::game;
use moka::future::Cache;
use serde::{Deserialize, Serialize};

/// 段位概览：各队列的段位信息映射（如 RANKED_SOLO_5x5、RANKED_FLEX_SR）。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to 'queueMap'
pub struct Rank {
    pub queue_map: QueueMap,
}

/// 单队列段位信息：段位、 tier、历史最高、定级赛、LP、胜负场等。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to all fields
pub struct QueueInfo {
    // QueueType 表示队列类型，例如 "RANKED_SOLO_5x5"。
    pub queue_type: String,
    // queueTypeCn 是额外的中文描述，我们保持它
    #[serde(default)]
    pub queue_type_cn: String,

    // Division 表示玩家当前段位的分段，例如 "I"、"II"。
    pub division: String,
    pub tier: String,
    #[serde(default)]
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

/// 各队列类型到段位信息的映射。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct QueueMap {
    #[serde(rename = "RANKED_SOLO_5x5")]
    pub ranked_solo_5x5: QueueInfo,
    #[serde(rename = "RANKED_FLEX_SR")]
    pub ranked_flex_sr: QueueInfo,
}

/// 按 puuid 缓存的段位。
static RANK_CACHE: LazyLock<Cache<String, Rank>> = LazyLock::new(|| {
    Cache::builder()
        .expire_after(crate::game_cache::GameScopedExpiry)
        .max_capacity(100)
        .build()
});

/// 清空段位缓存（由 [`crate::game_cache::invalidate_all`] 在换局时调用）。
pub fn invalidate_cache() {
    RANK_CACHE.invalidate_all();
}

impl Rank {
    /// 按 PUUID 获取段位数据（`lol-ranked/v1/ranked-stats/{puuid}`）。
    ///
    /// 带对局级缓存（存活时间见 [`crate::game_cache`]）：选人期 session 每轮重建都要
    /// 取 10 人段位，未缓存时每轮就是 10 个 LCU 请求。
    pub async fn get_rank_by_puuid(puuid: &str) -> Result<Self, String> {
        RANK_CACHE
            .try_get_with(puuid.to_string(), async {
                let uri = format!("lol-ranked/v1/ranked-stats/{}", puuid);
                crate::lcu::util::http::lcu_get::<Self>(&uri).await
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// 为队列类型与 tier 填充中文描述（queue_type_cn、tier_cn）。
    pub fn enrich_cn_info(&mut self) {
        // 为每个队列信息添加中文描述（Option<&str> -> String with default）
        self.queue_map.ranked_solo_5x5.queue_type_cn =
            game::get_queue_type_to_cn(&self.queue_map.ranked_solo_5x5.queue_type)
                .unwrap_or("其他")
                .to_string();
        self.queue_map.ranked_flex_sr.queue_type_cn =
            game::get_queue_type_to_cn(&self.queue_map.ranked_flex_sr.queue_type)
                .unwrap_or("其他")
                .to_string();
        self.queue_map.ranked_solo_5x5.tier_cn =
            game::get_tier_en_to_cn(&self.queue_map.ranked_solo_5x5.tier)
                .unwrap_or("无")
                .to_string();
        self.queue_map.ranked_flex_sr.tier_cn =
            game::get_tier_en_to_cn(&self.queue_map.ranked_flex_sr.tier)
                .unwrap_or("无")
                .to_string();
    }
}
