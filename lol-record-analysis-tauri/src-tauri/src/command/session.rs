use crate::command::user_tag::{OneGamePlayer, UserTag};
use crate::constant::game::{QUEUE_ID_TO_CN, QUEUE_TYPE_TO_CN};
use crate::lcu::api::champion_select::get_champion_select_session;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::phase::get_phase;
use crate::lcu::api::rank::Rank;
use crate::lcu::api::session::Session;
use crate::lcu::api::summoner::Summoner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub phase: String,
    #[serde(rename = "type")]
    pub queue_type: String,
    pub type_cn: String,
    pub queue_id: i32,
    pub team_one: Vec<SessionSummoner>,
    pub team_two: Vec<SessionSummoner>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummoner {
    pub champion_id: i32,
    pub champion_key: String,
    pub summoner: Summoner,
    pub match_history: MatchHistory,
    pub user_tag: UserTag,
    pub rank: Rank,
    pub meet_games: Vec<OneGamePlayer>,
    pub pre_group_markers: PreGroupMarker,
    pub is_loading: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreGroupMarker {
    pub name: String,
    #[serde(rename = "type")]
    pub marker_type: String,
}

/// 获取 session 数据，使用事件推送模式
#[tauri::command]
pub async fn get_session_data(app_handle: AppHandle) -> Result<(), String> {
    log::info!("get_session_data called");

    // 在后台线程处理，避免阻塞
    tokio::spawn(async move {
        match process_session_data(app_handle.clone()).await {
            Ok(_) => {
                log::info!("Session data processing completed");
            }
            Err(e) => {
                log::error!("Failed to process session data: {}", e);
                // 发送错误事件
                let _ = app_handle.emit("session-error", e);
            }
        }
    });

    Ok(())
}

async fn process_session_data(app_handle: AppHandle) -> Result<(), String> {
    let my_summoner = Summoner::get_my_summoner().await?;

    // 判断状态，若没有在游戏中，直接返回空数据
    let phase = get_phase().await?;
    let valid_phases = ["ChampSelect", "InProgress", "PreEndOfGame", "EndOfGame"];
    if !valid_phases.contains(&phase.as_str()) {
        log::info!("Not in a valid game phase: {}", phase);
        let empty_data = SessionData::default();
        app_handle
            .emit("session-complete", &empty_data)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut session = Session::get_session().await?;

    // 判断是否在选英雄阶段
    if phase == "ChampSelect" {
        match get_champion_select_session().await {
            Ok(select_session) => {
                // 转换类型：从 champion_select::OnePlayer 到 session::OnePlayer
                session.game_data.team_one = select_session
                    .my_team
                    .into_iter()
                    .map(|p| crate::lcu::api::session::OnePlayer {
                        champion_id: p.champion_id,
                        puuid: p.puuid,
                    })
                    .collect();
                session.game_data.team_two.clear(); // 选英雄阶段看不到对手
            }
            Err(e) => {
                log::warn!("Failed to get champion select session: {}", e);
            }
        }
    }

    let mut session_data = SessionData {
        phase: session.phase.clone(),
        queue_type: session.game_data.queue.queue_type.clone(),
        type_cn: QUEUE_TYPE_TO_CN
            .get(session.game_data.queue.queue_type.as_str())
            .unwrap_or(&"其他")
            .to_string(),
        queue_id: session.game_data.queue.id,
        team_one: Vec::new(),
        team_two: Vec::new(),
    };

    // 确保自己在队伍1
    let need_swap = !session
        .game_data
        .team_one
        .iter()
        .any(|p| p.puuid == my_summoner.puuid);

    if need_swap {
        std::mem::swap(
            &mut session.game_data.team_one,
            &mut session.game_data.team_two,
        );
    }

    let mode = session.game_data.queue.id;

    // 推送基础信息
    push_basic_info(&session, &mut session_data, &app_handle).await?;

    // 处理队伍一
    process_team(
        &session.game_data.team_one,
        &mut session_data.team_one,
        mode,
        &app_handle,
        true, // is_team_one
    )
    .await?;

    // 处理队伍二
    process_team(
        &session.game_data.team_two,
        &mut session_data.team_two,
        mode,
        &app_handle,
        false, // is_team_one
    )
    .await?;

    // 标记预组队
    add_pre_group_markers(&mut session_data);

    // 推送预组队信息
    let mut markers: HashMap<String, PreGroupMarker> = HashMap::new();
    for p in &session_data.team_one {
        if !p.pre_group_markers.name.is_empty() {
            markers.insert(p.summoner.puuid.clone(), p.pre_group_markers.clone());
        }
    }
    for p in &session_data.team_two {
        if !p.pre_group_markers.name.is_empty() {
            markers.insert(p.summoner.puuid.clone(), p.pre_group_markers.clone());
        }
    }

    if !markers.is_empty() {
        app_handle
            .emit("session-pre-group", &markers)
            .map_err(|e| e.to_string())?;
    }

    // 处理遇到过的玩家标签
    insert_meet_gamers_record(&mut session_data, &my_summoner.puuid);

    // 删除 Tag 标记（减少数据量）
    delete_meet_gamers_record(&mut session_data);

    // 发送完成事件
    app_handle
        .emit("session-complete", &session_data)
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn push_basic_info(
    session: &Session,
    session_data: &mut SessionData,
    app_handle: &AppHandle,
) -> Result<(), String> {
    async fn get_basic_team(team: &[crate::lcu::api::session::OnePlayer]) -> Vec<SessionSummoner> {
        let mut result = Vec::new();
        for player in team {
            if player.puuid.is_empty() {
                continue;
            }
            let summoner = Summoner::get_summoner_by_puuid(&player.puuid)
                .await
                .unwrap_or_default();

            result.push(SessionSummoner {
                champion_id: player.champion_id,
                champion_key: format!("champion_{}", player.champion_id),
                summoner,
                match_history: MatchHistory::default(),
                user_tag: UserTag::default(),
                rank: Rank::default(),
                meet_games: Vec::new(),
                pre_group_markers: PreGroupMarker::default(),
                is_loading: true,
            });
        }
        result
    }

    session_data.team_one = get_basic_team(&session.game_data.team_one).await;
    session_data.team_two = get_basic_team(&session.game_data.team_two).await;

    app_handle
        .emit("session-basic-info", &session_data)
        .map_err(|e| e.to_string())?;

    // 清空数据以便后续处理
    session_data.team_one.clear();
    session_data.team_two.clear();

    Ok(())
}

/// 处理队伍的公共函数，每完成一个玩家就推送一次
async fn process_team(
    team: &[crate::lcu::api::session::OnePlayer],
    result: &mut Vec<SessionSummoner>,
    mode: i32,
    app_handle: &AppHandle,
    is_team_one: bool,
) -> Result<(), String> {
    for (index, player) in team.iter().enumerate() {
        // 若没有 puuid，则跳过
        if player.puuid.is_empty() {
            continue;
        }

        log::info!(
            "Processing player {}/{}: {}",
            index + 1,
            team.len(),
            player.puuid
        );

        // 获取召唤师信息
        let summoner = match Summoner::get_summoner_by_puuid(&player.puuid).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to get summoner for {}: {}", player.puuid, e);
                continue;
            }
        };

        // 获取战绩
        // Default to 4 if not configured
        let count = match crate::config::get_config("matchHistoryCount").await {
            Ok(crate::config::Value::Integer(v)) => v as i32,
            Ok(crate::config::Value::String(s)) => s.parse().unwrap_or(4),
            _ => 4,
        };

        let match_history =
            match MatchHistory::get_match_history_by_puuid(&player.puuid, 0, count - 1).await {
                Ok(mut mh) => {
                    mh.enrich_info_cn().ok();
                    mh
                }
                Err(e) => {
                    log::warn!("Failed to get match history for {}: {}", player.puuid, e);
                    MatchHistory::default()
                }
            };

        // 获取用户标签
        let user_tag =
            match crate::command::user_tag::get_user_tag_by_puuid(&player.puuid, mode).await {
                Ok(tag) => tag,
                Err(e) => {
                    log::warn!("Failed to get user tag for {}: {}", player.puuid, e);
                    // 创建一个默认的 UserTag
                    UserTag {
                        recent_data: crate::command::user_tag::RecentData {
                            kda: 0.0,
                            kills: 0.0,
                            deaths: 0.0,
                            assists: 0.0,
                            select_mode: mode,
                            select_mode_cn: QUEUE_ID_TO_CN
                                .get(&(mode as u32))
                                .unwrap_or(&"未知模式")
                                .to_string(),
                            select_wins: 0,
                            select_losses: 0,
                            group_rate: 0,
                            average_gold: 0,
                            gold_rate: 0,
                            average_damage_dealt_to_champions: 0,
                            damage_dealt_to_champions_rate: 0,
                            friend_and_dispute: Default::default(),
                            one_game_players_map: None,
                        },
                        tag: Vec::new(),
                    }
                }
            };

        // 获取段位信息
        let rank = match Rank::get_rank_by_puuid(&player.puuid).await {
            Ok(mut r) => {
                r.enrich_cn_info();
                r
            }
            Err(e) => {
                log::warn!("Failed to get rank for {}: {}", player.puuid, e);
                Rank::default()
            }
        };

        // 构造 SessionSummoner 数据
        let session_summoner = SessionSummoner {
            champion_id: player.champion_id,
            champion_key: format!("champion_{}", player.champion_id),
            summoner: summoner.clone(),
            match_history,
            user_tag,
            rank,
            meet_games: Vec::new(),
            pre_group_markers: PreGroupMarker::default(),
            is_loading: false,
        };

        // 添加到结果队伍
        result.push(session_summoner.clone());

        // 每完成一个玩家就推送一次事件
        let event_name = if is_team_one {
            "session-player-update-team-one"
        } else {
            "session-player-update-team-two"
        };

        #[derive(Serialize)]
        struct PlayerUpdate {
            index: usize,
            total: usize,
            player: SessionSummoner,
            is_team_one: bool,
        }

        let update = PlayerUpdate {
            index,
            total: team.len(),
            player: session_summoner,
            is_team_one,
        };

        if let Err(e) = app_handle.emit(event_name, &update) {
            log::error!("Failed to emit player update event: {}", e);
        } else {
            log::info!("Emitted player update: {} of {}", index + 1, team.len());
        }
    }

    Ok(())
}

/// 标记预组队队友
fn add_pre_group_markers(session_data: &mut SessionData) {
    let friend_threshold = 3;
    let team_min_sum = 2;
    let mut all_maybe_teams: Vec<Vec<String>> = Vec::new();

    // 获取当前对局所有人的 PUUID
    let mut current_game_puuids: HashMap<String, bool> = HashMap::new();
    let team_one_puuids: Vec<String> = session_data
        .team_one
        .iter()
        .map(|s| s.summoner.puuid.clone())
        .collect();
    let team_two_puuids: Vec<String> = session_data
        .team_two
        .iter()
        .map(|s| s.summoner.puuid.clone())
        .collect();

    for puuid in &team_one_puuids {
        current_game_puuids.insert(puuid.clone(), true);
    }
    for puuid in &team_two_puuids {
        current_game_puuids.insert(puuid.clone(), true);
    }

    // 处理 TeamOne
    for session_summoner in &session_data.team_one {
        let mut the_teams = Vec::new();

        if let Some(ref one_game_players_map) =
            session_summoner.user_tag.recent_data.one_game_players_map
        {
            for (puuid, play_record_arr) in one_game_players_map {
                // 如果不在当前对局中，跳过这个玩家的统计
                if !current_game_puuids.contains_key(puuid) {
                    continue;
                }

                let team_count = play_record_arr
                    .iter()
                    .filter(|record| record.is_my_team)
                    .count();

                if team_count >= friend_threshold {
                    the_teams.push(puuid.clone());
                }
            }
        }

        if !the_teams.is_empty() {
            all_maybe_teams.push(the_teams);
        }
    }

    // 处理 TeamTwo
    for session_summoner in &session_data.team_two {
        let mut the_teams = Vec::new();

        if let Some(ref one_game_players_map) =
            session_summoner.user_tag.recent_data.one_game_players_map
        {
            for (puuid, play_record_arr) in one_game_players_map {
                if !current_game_puuids.contains_key(puuid) {
                    continue;
                }

                let team_count = play_record_arr
                    .iter()
                    .filter(|record| record.is_my_team)
                    .count();

                if team_count >= friend_threshold {
                    the_teams.push(puuid.clone());
                }
            }
        }

        if !the_teams.is_empty() {
            all_maybe_teams.push(the_teams);
        }
    }

    // 合并队伍，去除子集
    let merged_teams = remove_subsets(&all_maybe_teams);

    // 标记预组队信息
    let pre_group_maker_consts = [
        PreGroupMarker {
            name: "队伍1".to_string(),
            marker_type: "success".to_string(),
        },
        PreGroupMarker {
            name: "队伍2".to_string(),
            marker_type: "warning".to_string(),
        },
        PreGroupMarker {
            name: "队伍3".to_string(),
            marker_type: "error".to_string(),
        },
        PreGroupMarker {
            name: "队伍4".to_string(),
            marker_type: "info".to_string(),
        },
    ];

    let mut const_index = 0;

    for team in merged_teams {
        let mut marked = false;
        let intersection_team_one = intersection(&team, &team_one_puuids);
        let intersection_team_two = intersection(&team, &team_two_puuids);

        if intersection_team_one.len() >= team_min_sum {
            for session_summoner in &mut session_data.team_one {
                if one_in_arr(&session_summoner.summoner.puuid, &intersection_team_one)
                    && session_summoner.pre_group_markers.name.is_empty()
                {
                    session_summoner.pre_group_markers =
                        pre_group_maker_consts[const_index].clone();
                    marked = true;
                }
            }
        } else if intersection_team_two.len() >= team_min_sum {
            for session_summoner in &mut session_data.team_two {
                if one_in_arr(&session_summoner.summoner.puuid, &intersection_team_two)
                    && session_summoner.pre_group_markers.name.is_empty()
                {
                    session_summoner.pre_group_markers =
                        pre_group_maker_consts[const_index].clone();
                    marked = true;
                }
            }
        }

        if marked {
            const_index += 1;
            if const_index >= pre_group_maker_consts.len() {
                break;
            }
        }
    }
}

/// 插入遇到过的玩家记录
fn insert_meet_gamers_record(session_data: &mut SessionData, my_puuid: &str) {
    // 获取自己的 SessionSummoner 并克隆 one_game_players_map 以避免借用冲突
    let my_one_game_players_map = session_data
        .team_one
        .iter()
        .find(|s| s.summoner.puuid == my_puuid)
        .and_then(|s| s.user_tag.recent_data.one_game_players_map.clone());

    if let Some(my_map) = my_one_game_players_map {
        // 遍历并修改 TeamOne
        for session_summoner in &mut session_data.team_one {
            if session_summoner.summoner.puuid == my_puuid {
                continue;
            }
            if let Some(games) = my_map.get(&session_summoner.summoner.puuid) {
                session_summoner.meet_games = games.clone();
            }
        }

        // 遍历并修改 TeamTwo
        for session_summoner in &mut session_data.team_two {
            if session_summoner.summoner.puuid == my_puuid {
                continue;
            }
            if let Some(games) = my_map.get(&session_summoner.summoner.puuid) {
                session_summoner.meet_games = games.clone();
            }
        }
    }
}

/// 删除 Tag 标记中的 OneGamePlayersMap（减少传输数据量）
fn delete_meet_gamers_record(session_data: &mut SessionData) {
    for session_summoner in &mut session_data.team_one {
        session_summoner.user_tag.recent_data.one_game_players_map = None;
    }
    for session_summoner in &mut session_data.team_two {
        session_summoner.user_tag.recent_data.one_game_players_map = None;
    }
}

/// 去重并保留最大范围的数组
fn remove_subsets(arrays: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut sorted_arrays: Vec<Vec<String>> = arrays.to_vec();
    // 按数组长度排序，确保先处理较大的数组
    sorted_arrays.sort_by_key(|b| std::cmp::Reverse(b.len()));

    let mut result: Vec<Vec<String>> = Vec::new();
    for arr in sorted_arrays {
        // 判断当前数组是否被其他数组包含
        let is_subset_flag = result
            .iter()
            .any(|res_arr: &Vec<String>| is_subset(&arr, res_arr));

        // 如果当前数组没有被包含，就加入结果
        if !is_subset_flag {
            result.push(arr);
        }
    }
    result
}

/// 判断 a 是否是 b 的子集
fn is_subset(a: &[String], b: &[String]) -> bool {
    // 如果a的长度大于等于b的长度，a肯定不可能是b的子集
    if a.len() >= b.len() {
        return false;
    }

    // 使用HashMap存储b中的元素，检查a的元素是否都在b中
    let b_map: HashMap<&String, ()> = b.iter().map(|item| (item, ())).collect();

    a.iter().all(|item| b_map.contains_key(item))
}

/// 取两个数组的交集
fn intersection(arr1: &[String], arr2: &[String]) -> Vec<String> {
    let set: HashMap<&String, ()> = arr1.iter().map(|s| (s, ())).collect();
    arr2.iter()
        .filter(|s| set.contains_key(s))
        .cloned()
        .collect()
}

/// 判断元素是否在数组中
fn one_in_arr(e: &str, arr: &[String]) -> bool {
    arr.iter().any(|elem| elem == e)
}
