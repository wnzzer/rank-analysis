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

    /// 天梯分：段位在隐藏分分数轴上的值（见 `hidden_mmr::axis`），未定级为 None。
    #[serde(default)]
    pub ladder_score: Option<i32>,
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

/// 使指定 puuid 的段位缓存失效（结算写入新记录后，让后续读取拿到最新段位）。
pub async fn invalidate_cache_for(puuid: &str) {
    RANK_CACHE.invalidate(puuid).await;
}

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
            .try_get_with(puuid.to_string(), Self::fetch_uncached(puuid))
            .await
            .map_err(|e| e.to_string())
    }

    /// 绕过缓存直接向 LCU 取段位。
    ///
    /// 隐藏分采集的对局前 / 结算后快照必须读到实时数据：走缓存可能拿到赛前的旧段位，
    /// 导致前后快照相同、本局被误丢。
    pub async fn fetch_uncached(puuid: &str) -> Result<Self, String> {
        let uri = format!("lol-ranked/v1/ranked-stats/{}", puuid);
        crate::lcu::util::http::lcu_get::<Self>(&uri).await
    }

    /// 为队列类型与 tier 填充中文描述（queue_type_cn、tier_cn），并计算天梯分（ladder_score）。
    ///
    /// 定级赛中或未定级时天梯分为 None。
    pub fn enrich_cn_info(&mut self) {
        for q in [
            &mut self.queue_map.ranked_solo_5x5,
            &mut self.queue_map.ranked_flex_sr,
        ] {
            q.ladder_score = if q.is_provisional {
                None
            } else {
                crate::hidden_mmr::axis::to_score(&q.tier, &q.division, q.league_points)
            };
        }
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

/// 最近一次 LP 变化通知（`lol-ranked/v1/current-lp-change-notification`）。
///
/// 2026-11-06 国服实测可用：结算后返回本局 `leaguePointsDelta`，`gameId` 与结算页一致。
/// 注意通知里的 `wins/losses` 与段位接口对不上，这里刻意不收录。
#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct LpChangeNotification {
    pub game_id: i64,
    pub queue_type: String,
    /// 本局 LP 加减分
    pub league_points_delta: i32,
    /// 变化后的段位
    pub tier: String,
    pub division: String,
    pub league_points: i32,
    /// 变化原因，对局结算为 `"GAME_END"`
    pub change_reason: String,
    pub afk_lp_penalty_amount: i32,
    pub was_afk_or_leaver: bool,
    /// 输局时消耗的安慰分（少扣分），大于 0 说明本局扣分被人为减免
    pub consolation_lp_used: i32,
    pub provisional_games_remaining: i32,
}

impl LpChangeNotification {
    /// 拉取最近一次 LP 变化通知；还没有通知时 LCU 返回错误。
    pub async fn get() -> Result<Self, String> {
        crate::lcu::util::http::lcu_get("lol-ranked/v1/current-lp-change-notification").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rank_with(tier: &str, division: &str, lp: i32, provisional: bool) -> Rank {
        let mut rank = Rank::default();
        rank.queue_map.ranked_solo_5x5 = QueueInfo {
            queue_type: "RANKED_SOLO_5x5".into(),
            tier: tier.into(),
            division: division.into(),
            league_points: lp,
            is_provisional: provisional,
            ..Default::default()
        };
        rank.enrich_cn_info();
        rank
    }

    #[test]
    fn should_fill_ladder_score_for_diamond_ii() {
        let rank = rank_with("DIAMOND", "II", 40, false);
        assert_eq!(rank.queue_map.ranked_solo_5x5.ladder_score, Some(2640));
    }

    #[test]
    fn should_leave_ladder_score_none_when_unranked() {
        let rank = rank_with("", "NA", 0, false);
        assert_eq!(rank.queue_map.ranked_solo_5x5.ladder_score, None);
        assert_eq!(rank.queue_map.ranked_flex_sr.ladder_score, None);
    }

    #[test]
    fn should_leave_ladder_score_none_when_provisional() {
        let rank = rank_with("DIAMOND", "II", 40, true);
        assert_eq!(rank.queue_map.ranked_solo_5x5.ladder_score, None);
    }

    #[test]
    fn should_serialize_ladder_score_as_camel_case() {
        let rank = rank_with("DIAMOND", "II", 40, false);
        let json = serde_json::to_string(&rank.queue_map.ranked_solo_5x5).unwrap();
        assert!(json.contains("\"ladderScore\":2640"), "{json}");
    }
}
