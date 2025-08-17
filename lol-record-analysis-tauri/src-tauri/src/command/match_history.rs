use crate::lcu::api::{match_history::MatchHistory, summoner::Summoner};

#[tauri::command]
pub async fn get_match_history(
    puuid: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    // This command specifically calls the get_match_history method
    MatchHistory::get_match_history_by_puuid(&puuid, beg_index, end_index).await
}

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

#[tauri::command]
pub async fn get_match_history_by_name(
    name: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    get_match_history_by_puuid(puuid, beg_index, end_index).await
}

#[tauri::command]
pub async fn get_filter_match_history_by_name(
    name: String,
    mut beg_index: i32,
    end_index_param: i32,
    filter_queue_id: i32,
    filter_champ_id: i32,
) -> Result<MatchHistory, String> {

    let mut res_match_history = MatchHistory::default();
    let mut end_index = beg_index + 49; // 每次获取 50 条数据

    loop {
        let match_history =
            get_match_history_by_name(name.clone(), beg_index, end_index).await?;
        if !have_record(&match_history, filter_champ_id, filter_queue_id) {
            break;
        }

        for game in match_history.games.games {
            if (filter_queue_id == 0 || game.queue_id == filter_queue_id)
                && (filter_champ_id == 0
                    || game
                        .participants
                        .iter()
                        .any(|p| p.champion_id == filter_champ_id))
            {
                res_match_history.games.games.push(game);
            }
        }

        if res_match_history.games.games.len() >= end_index_param as usize {
            break; // 达到请求的结束索引
        }

        beg_index += 50;
        end_index += 50;
    }
    res_match_history.enrich_game_detail().await?;
    res_match_history.beg_index = beg_index;
    res_match_history.end_index = end_index;
    Ok(res_match_history)
}

fn have_record(match_history: &MatchHistory, filter_champ_id: i32, filter_queue_id: i32) -> bool {
    match_history.games.games.iter().any(|game| {
        // 队列ID为0时不过滤，否则要求相等
        let queue_ok = filter_queue_id == 0 || game.queue_id == filter_queue_id;
        // 英雄ID为0时不过滤，否则要求有任意参与者相等
        let champ_ok = filter_champ_id == 0
            || game
                .participants
                .iter()
                .any(|p| p.champion_id == filter_champ_id);
        queue_ok && champ_ok
    })
}
