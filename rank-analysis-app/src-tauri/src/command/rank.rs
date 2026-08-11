//! # Rank 命令模块
//!
//! 提供段位查询与胜率统计功能。
//!
//! ## 主要功能
//!
//! - **段位查询**: 按召唤师名称或 PUUID 查询排位段位信息
//! - **胜率统计**: 基于近期对局计算特定模式的胜率
//!
//! ## 段位信息包含
//!
//! - 单双排段位（Solo/Duo）
//! - 灵活组排段位（Flex）
//! - 段位中文描述
//! - 胜点、胜场、负场等详细信息
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 查询段位
//! let rank = get_rank_by_name("召唤师名称".to_string()).await?;
//!
//! // 查询胜率
//! let win_rate = get_win_rate_by_name_mode("召唤师名称".to_string(), 420).await?;
//! // 420 是单双排队列 ID
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use moka::future::Cache;

use crate::lcu::api::{match_history::MatchHistory, rank::Rank, summoner::Summoner};

/// 根据召唤师名称获取段位信息（含中文描述）。
///
/// # 参数
///
/// - `name`: 召唤师名称
///
/// # 返回值
///
/// - `Ok(Rank)`: 包含中文描述的段位信息
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 流程
///
/// 1. 通过名称获取召唤师信息
/// 2. 通过 PUUID 获取段位数据
/// 3. 调用 `enrich_cn_info()` 添加中文描述
#[tauri::command]
pub async fn get_rank_by_name(name: String) -> Result<Rank, String> {
    let summoner = Summoner::get_summoner_by_name(&name).await?;
    match Rank::get_rank_by_puuid(&summoner.puuid).await {
        Ok(mut rank) => {
            rank.enrich_cn_info();
            Ok(rank)
        }
        Err(e) => Err(format!("Failed to get rank by puuid: {}", e)),
    }
}

/// 根据 PUUID 获取段位信息（含中文描述）。
///
/// # 参数
///
/// - `puuid`: 召唤师 PUUID
///
/// # 返回值
///
/// - `Ok(Rank)`: 包含中文描述的段位信息
/// - `Err(String)`: 查询失败时的错误信息
#[tauri::command]
pub async fn get_rank_by_puuid(puuid: String) -> Result<Rank, String> {
    match Rank::get_rank_by_puuid(&puuid).await {
        Ok(mut rank) => {
            rank.enrich_cn_info();
            Ok(rank)
        }
        Err(e) => Err(format!("Failed to get rank by puuid: {}", e)),
    }
}

/// 段位缓存：puuid → Rank。
///
/// 战绩详情页一局 10 人、用户反复翻详情，段位在一次客户端会话内几乎不变：
/// 命中缓存不再打 LCU。TTL 30 分钟是防「用户注销换号 / 打了一把重置」这类
/// 罕见变化的上限；失败不缓存（moka `try_get_with` 对 Err 不落缓存），
/// 下次打开还能重试。
static RANK_CACHE: LazyLock<Cache<String, Rank>> = LazyLock::new(|| {
    Cache::builder()
        .time_to_live(Duration::from_secs(30 * 60))
        .max_capacity(500)
        .build()
});

/// 批量按 PUUID 获取段位：单次 IPC 返回多人的段位（缓存命中不击穿 LCU）。
///
/// 详情页 10 人场景替代逐个 `get_rank_by_puuid`（10 次 IPC + 10 次 LCU 往返）。
/// LCU 的 `ranked-stats` 端点本身带短缓存，但我们自己的缓存更长（30 分钟），
/// 且 moka 对同 key 的并发加载自动去重——重复 puuid 只发一次上游请求。
///
/// # 参数
///
/// - `puuids`: 召唤师 PUUID 列表
///
/// # 返回值
///
/// puuid → 段位信息；查询失败/无数据的玩家为 `None`（不因一人失败拖垮整批）
#[tauri::command]
pub async fn get_ranks_by_puuids(puuids: Vec<String>) -> HashMap<String, Option<Rank>> {
    let results = futures::future::join_all(puuids.into_iter().map(|puuid| async move {
        let rank = match RANK_CACHE.get(&puuid) {
            Some(rank) => Some(rank),
            None => RANK_CACHE
                .try_get_with(puuid.clone(), async {
                    Rank::get_rank_by_puuid(&puuid)
                        .await
                        .map(|mut rank| {
                            rank.enrich_cn_info();
                            rank
                        })
                        .map_err(|e| e.to_string())
                })
                .await
                .ok(),
        };
        (puuid, rank)
    }))
    .await;
    results.into_iter().collect()
}

/// 胜率统计数据结构。
///
/// 包含指定模式下的胜负统计和计算后的胜率百分比。
///
/// # 字段说明
///
/// - `wins`: 胜场数
/// - `losses`: 负场数
/// - `win_rate`: 胜率百分比（0-100）
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinRate {
    /// 胜场数
    pub wins: i32,
    /// 负场数
    pub losses: i32,
    /// 胜率百分比（0-100，四舍五入）
    pub win_rate: i32,
}

/// 根据召唤师名称与队列模式获取胜率。
///
/// # 参数
///
/// - `name`: 召唤师名称
/// - `mode`: 队列模式 ID（如 420=单双排, 440=灵活组排）
///
/// # 返回值
///
/// - `Ok(WinRate)`: 胜率统计信息
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 常用队列 ID
///
/// - `420`: 单双排（Ranked Solo/Duo）
/// - `440`: 灵活组排（Ranked Flex）
/// - `450`: 极地大乱斗（ARAM）
/// - `400`: 匹配模式（Normal Draft）
/// - `430`: 匹配模式（Normal Blind）
#[tauri::command]
pub async fn get_win_rate_by_name_mode(name: String, mode: i32) -> Result<WinRate, String> {
    let summoner = Summoner::get_summoner_by_name(&name).await?;
    get_win_rate_by_puuid_mode(summoner.puuid, mode).await
}

/// 根据 PUUID 与队列模式获取胜率（基于近期对局统计）。
///
/// 查询最近 50 场对局中指定模式的胜负记录并计算胜率。
///
/// # 参数
///
/// - `puuid`: 召唤师 PUUID
/// - `mode`: 队列模式 ID
///
/// # 返回值
///
/// - `Ok(WinRate)`: 胜率统计信息
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 计算逻辑
///
/// 1. 获取最近 50 场对局记录
/// 2. 筛选指定队列模式的对局
/// 3. 统计胜负场次
/// 4. 计算胜率百分比（四舍五入到整数）
#[tauri::command]
pub async fn get_win_rate_by_puuid_mode(puuid: String, mode: i32) -> Result<WinRate, String> {
    let match_history = MatchHistory::get_match_history_by_puuid(&puuid, 0, 49).await?;
    let mut total_games = 0;
    let mut win_games = 0;
    let mut loss_games = 0;
    for game in match_history.games.games {
        if game.queue_id == mode {
            total_games += 1;
            if !game.participants.is_empty() && game.participants[0].stats.win {
                win_games += 1;
            } else {
                loss_games += 1;
            }
        }
    }
    Ok(WinRate {
        wins: win_games,
        losses: loss_games,
        win_rate: if total_games > 0 {
            (win_games as f32 / total_games as f32 * 100.0).round() as i32
        } else {
            0
        },
    })
}

/// 计算胜率百分比
///
/// # Arguments
/// * `wins` - 胜利场次
/// * `losses` - 失败场次
///
/// # Returns
/// 胜率百分比，如果没有场次则返回0
pub fn calculate_win_rate(wins: i32, losses: i32) -> f32 {
    let total = wins + losses;
    if total == 0 {
        0.0
    } else {
        (wins as f32 / total as f32 * 100.0).round()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_calculate_win_rate_correctly() {
        assert_eq!(calculate_win_rate(7, 3), 70.0);
    }

    #[test]
    fn should_return_zero_when_no_games() {
        assert_eq!(calculate_win_rate(0, 0), 0.0);
    }

    #[test]
    fn should_return_100_when_all_wins() {
        assert_eq!(calculate_win_rate(10, 0), 100.0);
    }

    #[test]
    fn should_return_0_when_all_losses() {
        assert_eq!(calculate_win_rate(0, 10), 0.0);
    }

    #[test]
    fn should_round_win_rate_correctly() {
        // 2/3 = 0.666... -> 67%
        assert_eq!(calculate_win_rate(2, 1), 67.0);
    }

    #[test]
    fn should_return_50_when_equal_wins_and_losses() {
        assert_eq!(calculate_win_rate(5, 5), 50.0);
    }

    #[test]
    fn should_handle_negative_numbers() {
        // 负数场次应该被正常计算（虽然业务上不合理）
        // -1 / (-1 + 3) = -1 / 2 = -0.5 -> -50%
        assert_eq!(calculate_win_rate(-1, 3), -50.0);
    }

    #[test]
    fn should_create_win_rate_struct_correctly() {
        let win_rate = WinRate {
            wins: 7,
            losses: 3,
            win_rate: 70,
        };
        assert_eq!(win_rate.wins, 7);
        assert_eq!(win_rate.losses, 3);
        assert_eq!(win_rate.win_rate, 70);
    }

    /// 批量接口的缓存复用路径：全部 puuid 已缓存时只回缓存、不触碰 LCU。
    ///
    /// 测试方法：预先向 RANK_CACHE 写入数据，再调批量接口——此时任何「未命中
    /// 才发起上游请求」的实现都不会真的发起请求（请求目标 LCU 进程在测试环境
    /// 不存在，会立刻报错），能拿到全部结果说明全部走了缓存。
    #[tokio::test]
    async fn batch_returns_all_cached_ranks_without_touching_lcu() {
        let mut cached = Rank::default();
        cached.enrich_cn_info();
        RANK_CACHE.insert("p-1".to_string(), cached.clone());
        RANK_CACHE.insert("p-2".to_string(), cached.clone());

        let out = get_ranks_by_puuids(vec!["p-1".to_string(), "p-2".to_string()]).await;

        assert!(out["p-1"].is_some());
        assert!(out["p-2"].is_some());
    }

    /// 未缓存的 puuid：批量接口发起上游请求失败时返回 None 而非整体失败。
    ///
    /// 测试环境没有 LCU 进程，`ranked-stats` 请求必然失败——正好断言「单人不拖
    /// 垮整批、失败不击穿缓存」的语义。缓存的成功路径由上一个用例覆盖。
    #[tokio::test]
    async fn batch_miss_returns_none_instead_of_failing_batch() {
        let out = get_ranks_by_puuids(vec!["no-such-puuid".to_string()]).await;

        assert!(out["no-such-puuid"].is_none());
    }

    /// 重复 puuid 去重：moka 对同 key 并发加载只发一次上游，返回 map 收敛为单个条目。
    #[tokio::test]
    async fn batch_deduplicates_duplicate_puuids_in_output() {
        let out = get_ranks_by_puuids(vec![
            "no-such-puuid".to_string(),
            "no-such-puuid".to_string(),
        ])
        .await;

        assert_eq!(out.len(), 1);
        assert!(out["no-such-puuid"].is_none());
    }
}
