use crate::lcu::api::asset;
use crate::state::AppState;
use crate::{config, constant};
use serde::Serialize;

#[tauri::command]
pub async fn put_config(key: String, value: config::Value) -> Result<(), String> {
    config::put_config(key, value).await
}

#[tauri::command]
pub async fn get_config(key: String) -> Result<config::Value, String> {
    config::get_config(&key).await
}

#[tauri::command]
pub async fn get_http_server_port(state: tauri::State<'_, AppState>) -> Result<i32, String> {
    state
        .http_port
        .get()
        .copied()
        .map(|p| p as i32)
        .ok_or_else(|| "http_server_port not set".to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionOption {
    pub label: String,
    pub value: i64,
    pub real_name: String,
    pub nickname: String,
}

#[tauri::command]
pub fn get_champion_options() -> Result<Vec<ChampionOption>, String> {
    let mut options = vec![];
    for (id, item) in asset::CHAMPION_CACHE.read().unwrap().iter() {
        let champion = item.clone();
        let known_alias = constant::game::CHAMPION_MAP
            .get(&(*id as u16))
            .map(|c| c.nickname.to_string())
            .unwrap_or_else(|| champion.alias.clone());

        // 末日人机不加入选项
        if champion.name.contains("末日人机") {
            continue;
        }
        options.push(ChampionOption {
            label: champion.name,
            value: champion.id,
            real_name: champion.description,
            nickname: format!("{} ({})", known_alias, champion.alias),
        });
    }

    Ok(options)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameModeOption {
    pub label: String,
    pub value: i32,
}

#[tauri::command]
pub fn get_game_modes() -> Vec<GameModeOption> {
    let mut options = vec![GameModeOption {
        label: "全部".to_string(),
        value: 0,
    }];

    let mut modes: Vec<GameModeOption> = constant::game::QUEUE_ID_TO_CN
        .entries()
        .filter(|&(k, _)| *k != 0)
        .map(|(k, v)| GameModeOption {
            label: v.to_string(),
            value: *k as i32,
        })
        .collect();

    modes.sort_by_key(|k| k.value);
    options.extend(modes);

    options
}
