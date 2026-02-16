//! # Rank 命令模块
//!
//! 提供段位查询与胜率统计：按名称或 PUUID 查 Rank，按名称/PUUID+模式查胜率。

use serde::{Deserialize, Serialize};

use crate::lcu::api::{match_history::MatchHistory, rank::Rank, summoner::Summoner};

/// 根据召唤师名称获取段位信息（含中文描述）。
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

/// 胜率统计：胜场、负场、胜率百分比。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinRate {
    pub wins: i32,
    pub losses: i32,
    pub win_rate: i32,
}

/// 根据召唤师名称与队列模式获取胜率。
#[tauri::command]
pub async fn get_win_rate_by_name_mode(name: String, mode: i32) -> Result<WinRate, String> {
    let summoner = Summoner::get_summoner_by_name(&name).await?;
    get_win_rate_by_puuid_mode(summoner.puuid, mode).await
}

/// 根据 PUUID 与队列模式获取胜率（基于近期对局统计）。
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
