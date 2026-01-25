pub mod config;
pub mod fandom;
pub mod info;
pub mod match_history;
pub mod rank;
pub mod session;
pub mod user_tag;
pub mod user_tag_config;

use crate::lcu::api::summoner::Summoner;

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
