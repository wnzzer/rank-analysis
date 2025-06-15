use crate::lcu::api::summoner::Summoner;

#[tauri::command]
pub async fn get_summoner(source_type: &str, source_id: &str) -> Result<Summoner, String> {
    let summoner = match source_type {
        "my" => Summoner::get_my_summoner().await?,
        "puuid" => Summoner::get_summoner_by_puuid(source_id)
            .await
            .map_err(|e| e.to_string())?,
        "name" => Summoner::get_summoner_name(source_id)
            .await
            .map_err(|e| e.to_string())?,
        _ => Summoner::get_my_summoner().await?,
    };

    Ok(summoner)
}
