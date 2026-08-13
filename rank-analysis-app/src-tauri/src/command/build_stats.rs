//! # PUGG 聚合命令
//!
//! `get_build_stats`：基于自有战绩窗口聚合指定英雄的出装/符文统计。
//!
//! 降级链：战绩拉取失败 → Err；样本 < 5 场 → `Ok(None)`（前端显示"暂无推荐"）。
//! 聚合结果按 `puuid:champion_id:mode` 进无 TTL 的内存缓存——战绩窗口本身
//! 60s 由 `match_history` 层控制新鲜度，这里只防同一召唤师重复聚合。

use moka::future::Cache;
use std::sync::Arc;

use crate::lcu::api::match_history::MatchHistory;
use crate::pugg::aggregate::{aggregate_build_stats, BuildStats};

/// 聚合结果缓存：`puuid:champion_id:mode` → BuildStats（无 TTL，容量 500）。
static BUILD_STATS_CACHE: Cache<String, Arc<BuildStats>> =
    Cache::builder().max_capacity(500).build();

/// 缓存键。
fn cache_key(puuid: &str, champion_id: i32, mode: i32) -> String {
    format!("{}:{}:{}", puuid, champion_id, mode)
}

/// 基于自有战绩窗口（0..=49 共 50 场）聚合指定英雄的出装/符文统计。
///
/// # 参数
/// - `puuid`: 被统计召唤师（通常为当前登录玩家）
/// - `champion_id`: 目标英雄
/// - `mode`: queue_id 过滤，0 = 不限制模式
///
/// # 返回值
/// - `Ok(Some(BuildStats))`: 样本 ≥ 5 的聚合结果
/// - `Ok(None)`: 样本不足（<5 场），前端应显示"暂无推荐"
/// - `Err(String)`: 战绩拉取失败（本地客户端未登录等）
#[tauri::command]
pub async fn get_build_stats(
    puuid: String,
    champion_id: i32,
    mode: i32,
) -> Result<Option<BuildStats>, String> {
    let key = cache_key(&puuid, champion_id, mode);
    if let Some(cached) = BUILD_STATS_CACHE.get(&key).await {
        return Ok(Some((*cached).clone()));
    }

    // 复用战绩缓存窗口：首个请求 0..=49 全量，LCU 按 puuid 整包缓存
    let match_history = MatchHistory::get_match_history_by_puuid(&puuid, 0, 49).await?;

    let Some(stats) = aggregate_build_stats(
        &match_history.games.games,
        champion_id,
        &puuid,
        mode,
    ) else {
        return Ok(None);
    };

    // 只缓存达标样本；样本不足不缓存（战绩窗口 60s 刷新，重试成本低）
    BUILD_STATS_CACHE.insert(key, Arc::new(stats.clone())).await;
    Ok(Some(stats))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_distinguishes_combos() {
        assert_eq!(cache_key("a", 86, 0), "a:86:0");
        assert_ne!(cache_key("a", 86, 0), cache_key("a", 86, 450));
        assert_ne!(cache_key("a", 86, 0), cache_key("b", 86, 0));
    }
}