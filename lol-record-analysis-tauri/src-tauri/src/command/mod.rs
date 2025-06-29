use crate::lcu::api::summoner::Summoner; // Import the Summoner struct from its module
mod match_hostory;
use crate::lcu::api::match_history::MatchHistory;

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
pub async fn get_match_history(
    puuid: String,
    begin_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    MatchHistory::get_match_history_by_puuid(&puuid, begin_index, end_index).await
}

#[tauri::command]
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
    return Ok(match_hostory);
}

#[tauri::command]
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
    return Ok(match_hostory);
}

#[tauri::command]
pub async fn get_filter_match_history_by_name(
    name: String,
    mut begin_index: i32, // 注意这里是 mut，因为会在循环中修改
    end_index_param: i32, // 使用不同的名称，避免与 Go 代码中的 end_index 混淆，这里是请求的最终结束索引
    filter_queue_id: i32,
    filter_champ_id: i32,
) -> Result<MatchHistory, String> {
    // 1. 获取 PUUID
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;

    let mut filtered_match_history = MatchHistory::default(); // 初始化一个空的 MatchHistory 结构体
    let max_games = 10; // 设定最大筛选结果数，防止无限循环，与Go代码保持一致
    let chunk_size = 50; // LCU通常每批次返回50个

    let mut current_end_index: i32; // 用于当前批次 LCU API 请求的结束索引

    // 循环直到达到请求的 end_index_param 或收集到足够的筛选结果
    while begin_index < end_index_param {
        // 计算当前批次的结束索引
        current_end_index = begin_index + chunk_size - 1; // LCU的end_index是包含的，所以要减1
        if current_end_index >= end_index_param {
            current_end_index = end_index_param;
        }

        let temp_match_history = match MatchHistory::get_match_history_by_puuid(
            &puuid,
            begin_index,
            current_end_index, // 使用计算出的当前批次结束索引
        )
        .await
        {
            Ok(mh) => mh,
            Err(e) => {
                // 在Go代码中，如果API调用失败，会直接返回错误
                // 这里也遵循这个逻辑
                return Err(format!(
                    "获取比赛历史失败 ({} - {}): {}",
                    begin_index, current_end_index, e
                ));
            }
        };

        let mut have_data_in_chunk = false; // 标记当前批次是否找到任何数据 (Go代码中的 haveData)
        let mut game_index_in_chunk = 0; // 用于记录当前批次中遍历到的游戏索引

        for game in temp_match_history.games.games {
            // 进行筛选：如果 filterChampId 和 filterQueueId 都匹配，才添加
            let mut add_game = true;

            if filter_champ_id != 0
                && game.participants.get(0).map(|p| p.champion_id) != Some(filter_champ_id)
            {
                add_game = false;
            }

            if filter_queue_id != 0 && game.queue_id != filter_queue_id {
                add_game = false;
            }

            if add_game {
                filtered_match_history.games.games.push(game);
                have_data_in_chunk = true;
            }

            // 如果筛选的比赛数量超出 maxGames，则提前返回
            if filtered_match_history.games.games.len() >= max_games as usize {
                // Go代码中返回的是 begIndex, begIndex + j
                // 这里的 j 是 tempMatchHistory.Games.Games 的索引
                // 所以我们需要记录当前批次的结束索引和遍历到的游戏索引
                filtered_match_history.begin_index = begin_index;
                filtered_match_history.end_index = begin_index + game_index_in_chunk as i32; // 模拟 Go 的 j
                return Ok(filtered_match_history);
            }
            game_index_in_chunk += 1;
        }

        if !have_data_in_chunk {
            filtered_match_history.begin_index = begin_index;
            filtered_match_history.end_index = current_end_index;
            return Ok(filtered_match_history);
        }

        // 移动到下一个批次的开始索引
        begin_index += chunk_size;
    }

    // 如果循环结束，将最终的 begin_index 和 end_index 设置到结果中
    filtered_match_history.begin_index = begin_index;
    filtered_match_history.end_index = end_index_param;
    Ok(filtered_match_history)
}
