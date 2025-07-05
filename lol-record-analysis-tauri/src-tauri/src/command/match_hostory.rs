use crate::lcu::api::{match_history::MatchHistory, summoner::Summoner};
pub async fn get_match_history(
    puuid: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    // This command specifically calls the get_match_history method
    MatchHistory::get_match_history_by_puuid(&puuid, begin_index, end_index).await
}

pub async fn get_match_history_by_puuid(
    puuid: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    MatchHistory::get_match_history_by_puuid(&puuid, begin_index, end_index).await
}

pub async fn get_match_history_by_name(
    name: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    let mut match_hostory =
        MatchHistory::get_match_history_by_puuid(&puuid, begin_index, end_index).await?;
    match_hostory.begin_index = begin_index;
    match_hostory.end_index = end_index;
    Ok(match_hostory)
}

pub async fn get_filter_match_history_by_name(
    name: String,
    mut begin_index: i32,
    end_index_param: i32,
    filter_queue_id: i32,
    filter_champ_id: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;

    let mut res_match_history = MatchHistory::default();
    let mut end_index = begin_index + 49; // 每次获取 50 条数据

    loop {
        let match_history =
            MatchHistory::get_match_history_by_puuid(&puuid, begin_index, end_index).await?;
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

        begin_index += 50;
        end_index += 50;
    }

    res_match_history.begin_index = begin_index;
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
