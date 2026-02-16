//! # Command 模块
//!
//! 暴露给前端的 Tauri 命令（Commands），封装 LCU API 调用与业务逻辑。
//! 子模块：config、fandom、info、match_history、rank、session、user_tag、user_tag_config。

pub mod config;
pub mod fandom;
pub mod info;
pub mod match_history;
pub mod rank;
pub mod session;
pub mod user_tag;
pub mod user_tag_config;

use crate::lcu::api::summoner::Summoner;

/// 根据 PUUID 获取召唤师信息。
#[tauri::command]
pub async fn get_summoner_by_puuid(puuid: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_puuid(&puuid).await
}

/// 根据召唤师名称获取召唤师信息。
#[tauri::command]
pub async fn get_summoner_by_name(name: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_name(&name).await
}

/// 获取当前登录客户端的召唤师信息。
#[tauri::command]
pub async fn get_my_summoner() -> Result<Summoner, String> {
    Summoner::get_my_summoner().await
}
