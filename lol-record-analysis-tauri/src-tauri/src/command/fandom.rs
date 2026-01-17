use crate::fandom::api::fetch_aram_balance_data;
use crate::fandom::data::AramBalanceData;
use crate::state::AppState;
use tauri::State;

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

#[tauri::command]
pub async fn get_aram_balance(
    id: i32,
    state: State<'_, AppState>,
) -> Result<Option<AramBalanceData>, String> {
    Ok(state.fandom_cache.get(&id).await)
}
