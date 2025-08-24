use crate::constant;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;

#[tauri::command]
pub async fn get_platform_name_by_name(name: String) -> Result<String, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    let match_history = MatchHistory::get_match_history_by_puuid(&puuid, 0, 1).await?;
    constant::game::SGP_SERVER_ID_TO_NAME
        .get(match_history.platform_id.as_str())
        .map(|&v| v.to_string())
        .ok_or_else(|| "未找到对应的服务器名称".to_string())
}
