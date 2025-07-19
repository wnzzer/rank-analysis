use crate::constant;
use crate::lcu::api::summoner::Summoner; // Import the Summoner struct from its module
mod match_hostory;
pub mod rank;
mod user_tag;
use crate::config;
use crate::lcu::api::match_history::MatchHistory;

#[tauri::command]
pub async fn put_config(key: String, value: config::Value) -> Result<(), String> {
    config::put_config(key, value).await
}

#[tauri::command]
pub async fn get_config(key: String) -> Result<config::Value, String> {
    config::get_config(&key).await
}

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
pub async fn get_match_history_by_puuid(
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

#[tauri::command]
pub async fn get_platform_name_by_name(name: String) -> Result<String, String> {
    let match_history = match_hostory::get_match_history_by_name(name, 0, 0).await?;
    constant::game::SGP_SERVER_ID_TO_NAME
        .get(match_history.platform_id.as_str())
        .map(|&v| v.to_string())
        .ok_or_else(|| "未找到对应的服务器名称".to_string())
}
#[tauri::command]
pub async fn get_user_tag_by_name(name: String, mode: i32) -> Result<user_tag::UserTag, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    user_tag::get_user_tag_by_puuid(&puuid, mode).await
}
#[tauri::command]
pub async fn get_user_tag_by_puuid(puuid: String, mode: i32) -> Result<user_tag::UserTag, String> {
    user_tag::get_user_tag_by_puuid(&puuid, mode).await
}
