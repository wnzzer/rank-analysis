use crate::lcu::api::summoner::Summoner; // Import the Summoner struct from its module
mod match_hostory;
use crate::lcu::api::match_history::MatchHistory;

#[tauri::command]
pub async fn get_summoner_by_puuid(puuid: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_puuid(&puuid).await
}

#[tauri::command]
pub async fn get_summoner_by_name(name: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_name(&name).await
}

#[tauri::command]
pub async fn get_my_summoner() -> Result<Summoner, String> {
    Summoner::get_my_summoner().await
}

#[tauri::command]
pub async fn get_match_history(
    puuid: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    match_hostory::get_match_history(puuid, begin_index, end_index).await
}

#[tauri::command]
pub async fn get_match_history_by_name(
    name: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    match_hostory::get_match_history_by_puuid(puuid, begin_index, end_index).await
}

#[tauri::command]
pub async fn get_filter_match_history_by_name(
    name: String,
    begin_index: i32,
    end_index_param: i32,
    filter_queue_id: i32,
    filter_champ_id: i32,
) -> Result<MatchHistory, String> {
    match_hostory::get_filter_match_history_by_name(
        name,
        begin_index,
        end_index_param,
        filter_queue_id,
        filter_champ_id,
    )
    .await
}
