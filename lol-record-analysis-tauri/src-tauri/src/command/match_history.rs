//! # MatchHistory 命令模块
//!
//! 提供对局记录查询：按 PUUID/名称、分页、队列/英雄筛选，以及详情与中文信息增强。

use crate::lcu::api::{
    match_history::{Game, MatchHistory},
    summoner::Summoner,
};

/// 根据 PUUID 与索引范围获取对局记录（原始数据，无详情增强）。
#[tauri::command]
pub async fn get_match_history(
    puuid: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    // This command specifically calls the get_match_history method
    MatchHistory::get_match_history_by_puuid(&puuid, beg_index, end_index).await
}

/// 根据 PUUID 获取对局记录并增强详情与中文信息。
#[tauri::command]
pub async fn get_match_history_by_puuid(
    puuid: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let mut match_history =
        MatchHistory::get_match_history_by_puuid(&puuid, beg_index, end_index).await?;
    match_history.enrich_game_detail().await?;
    match_history.enrich_info_cn()?;
    match_history.calculate()?;
    match_history.beg_index = beg_index;
    match_history.end_index = end_index;
    Ok(match_history)
}

/// 根据召唤师名称获取对局记录（内部转为 PUUID 后调用 get_match_history_by_puuid）。
#[tauri::command]
pub async fn get_match_history_by_name(
    name: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    get_match_history_by_puuid(puuid, beg_index, end_index).await
}

/// 根据名称、索引范围及队列/英雄筛选获取对局记录（最多返回指定条数）。
#[tauri::command]
pub async fn get_filter_match_history_by_name(
    name: String,
    beg_index: i32,
    mut end_index: i32,
    filter_queue_id: i32,
    filter_champion_id: i32,
) -> Result<MatchHistory, String> {
    // 可能是bug，超过49的记录无法查询，目前截断一下
    if end_index > 49 {
        end_index = 49;
    }
    // --- Configuration with named constants for improved readability ---
    const MAX_RESULTS_TO_FIND: usize = 10;
    const PAGE_SIZE: i32 = 50; // Fetch 50 matches per API request.

    // --- State Initialization ---
    let mut result_history = MatchHistory::default();
    let mut current_start_index = beg_index;
    let search_depth_limit = end_index;

    'outer: loop {
        // Stop if the next search would exceed the specified depth limit.
        if current_start_index >= search_depth_limit {
            break;
        }

        let mut current_end_index = current_start_index + PAGE_SIZE - 1;
        if current_end_index > 49 {
            current_end_index = 49;
        }

        // Fetch a "page" of match history from the data source.
        let page =
            get_match_history_by_name(name.clone(), current_start_index, current_end_index).await?;

        // If the API returns no more games, we've reached the end of the user's history.
        if page.games.games.is_empty() {
            break;
        }

        // --- Filter and collect matches from the fetched page ---
        for (i, game) in page.games.games.iter().enumerate() {
            if game_matches_filters(game, filter_queue_id, filter_champion_id) {
                result_history.games.games.push(game.clone());

                // If we've found the desired number of matches, the search is complete.
                if result_history.games.games.len() >= MAX_RESULTS_TO_FIND {
                    // Record the exact index where the search stopped.
                    result_history.end_index = current_start_index + i as i32;
                    break 'outer; // Exit both the inner and outer loops.
                }
            }
        }

        // --- Pagination: Prepare for the next iteration ---
        current_start_index += PAGE_SIZE;
    }

    // --- Finalization ---
    // If the loop terminated without `break 'outer'`, it means we either hit the
    // search depth limit or the end of the match history. In that case, the
    // end_index should be the last index we successfully queried.
    if result_history.end_index == 0 {
        result_history.end_index = current_start_index.min(search_depth_limit) - 1;
    }
    result_history.beg_index = beg_index;

    result_history.enrich_game_detail().await?;
    Ok(result_history)
}

fn game_matches_filters(game: &Game, filter_queue_id: i32, filter_champion_id: i32) -> bool {
    let queue_matches = filter_queue_id <= 0 || game.queue_id == filter_queue_id;
    let champion_matches = filter_champion_id <= 0
        || game
            .participants
            .iter()
            .any(|p| p.champion_id == filter_champion_id);

    queue_matches && champion_matches
}
