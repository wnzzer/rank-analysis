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
}
