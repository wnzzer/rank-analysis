//! # Fandom 命令模块
//!
//! 与 Fandom 外部数据对接：更新大乱斗平衡数据、按英雄 ID 查询平衡信息。

use crate::fandom::api::fetch_aram_balance_data;
use crate::fandom::data::AramBalanceData;
use crate::state::AppState;
use tauri::State;

/// 从 Fandom 拉取大乱斗平衡数据并写入应用缓存。
#[tauri::command]
pub async fn update_fandom_data(state: State<'_, AppState>) -> Result<String, String> {
    match fetch_aram_balance_data().await {
        Ok(data) => {
            for (id, balance) in data {
                state.fandom_cache.insert(id, balance).await;
            }
            Ok("Fandom data updated successfully".to_string())
        }
        Err(e) => Err(format!("Failed to update fandom data: {}", e)),
    }
}

/// 根据英雄 ID 从缓存获取大乱斗平衡数据。
#[tauri::command]
pub async fn get_aram_balance(
    id: i32,
    state: State<'_, AppState>,
) -> Result<Option<AramBalanceData>, String> {
    Ok(state.fandom_cache.get(&id).await)
}
