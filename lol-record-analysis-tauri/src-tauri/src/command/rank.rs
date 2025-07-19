use serde::{Deserialize, Serialize};

use crate::lcu::api::{match_history::MatchHistory, rank::Rank, summoner::Summoner};

#[tauri::command]
pub async fn get_rank_by_name(name: String) -> Result<Rank, String> {
    let summoner = Summoner::get_summoner_by_name(&name).await?;
    let rank = Rank::get_rank_by_puuid(&summoner.puuid).await?;
    Ok(rank)
}

#[tauri::command]
pub async fn get_rank_by_puuid(puuid: String) -> Result<Rank, String> {
    Rank::get_rank_by_puuid(&puuid).await
}

#[derive(Serialize, Deserialize)]
pub struct WinRate {
    pub win: i32,
    pub lose: i32,
    pub win_rate: f32,
}
#[tauri::command]
pub async fn get_win_rate_by_name_mode(name: String, mode: i32) -> Result<WinRate, String> {
    let summoner = Summoner::get_summoner_by_name(&name).await?;
    get_win_rate_by_puuid_mode(summoner.puuid, mode).await
}

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
        win: win_games,
        lose: loss_games,
        win_rate: if total_games > 0 {
            win_games as f32 / total_games as f32
        } else {
            0.0
        },
    })
}
