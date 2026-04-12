//! # Session 命令模块
//!
//! 提供对局会话数据：拉取 LCU 当前对局/选人阶段信息，合并召唤师、战绩、段位、用户标签等，
//! 通过事件（`session-basic-info`、`session-player-update-*`、`session-complete` 等）推送给前端。
//!
//! ## 主要功能
//!
//! - **会话数据获取**: 获取当前对局或选人阶段的完整信息
//! - **并行数据加载**: 并发获取所有玩家的详细信息
//! - **预组队检测**: 分析历史记录检测预组队玩家
//! - **渐进式推送**: 通过多个事件逐步推送数据，优化前端体验
//!
//! ## 事件流
//!
//! ```text
//! get_session_data()
//!     │
//!     ▼
//! session-basic-info        # 基础信息（玩家列表、英雄等）
//!     │
//!     ├──▶ session-player-update-team-one   # 我方玩家逐个更新
//!     │
//!     └──▶ session-player-update-team-two   # 敌方玩家逐个更新
//!     │
//!     ▼
//! session-pre-group         # 预组队标记
//!     │
//!     ▼
//! session-complete          # 完整数据（最终事件）
//! ```
//!
//! ## 队伍处理逻辑
//!
//! 为了确保前端显示的一致性（我方在左，敌方在右）：
//!
//! 1. 通过当前登录用户的 PUUID 判断所在队伍
//! 2. 如果当前用户在 team_two，交换两队数据
//! 3. 使用 `playerChampionSelections` 补全缺失的玩家信息
//! 4. 按位置排序：TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 前端调用
//! invoke('get_session_data').then(() => {
//!     // 监听事件获取数据
//!     listen('session-basic-info', (event) => { ... });
//!     listen('session-player-update-team-one', (event) => { ... });
//!     listen('session-complete', (event) => { ... });
//! });
//! ```

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

/// 对局会话的完整展示数据，包含阶段、队列、双方队伍及每个玩家的汇总信息。
///
/// # 字段说明
///
/// - `phase`: 当前游戏阶段（如 "ChampSelect", "InProgress"）
/// - `queue_type`: 队列类型代码
/// - `type_cn`: 队列类型中文名称
/// - `queue_id`: 队列 ID
/// - `team_one`: 我方队伍（左侧）
/// - `team_two`: 敌方队伍（右侧）
///
/// # 队伍说明
///
/// `team_one` 始终表示"我方"（当前登录用户所在队伍），`team_two` 表示"敌方"。
/// 后端会根据当前用户的 PUUID 自动交换 LCU 返回的队伍数据。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    /// 当前游戏阶段
    pub phase: String,
    /// 队列类型代码
    #[serde(rename = "type")]
    pub queue_type: String,
    /// 队列类型中文名称
    pub type_cn: String,
    /// 队列 ID
    pub queue_id: i32,
    /// 我方队伍（左侧）
    pub team_one: Vec<SessionSummoner>,
    /// 敌方队伍（右侧）
    pub team_two: Vec<SessionSummoner>,
}

/// 会话中单名玩家的展示数据：英雄、召唤师、战绩、段位、用户标签、预组队标记等。
///
/// # 字段说明
///
/// - `champion_id`: 英雄 ID
/// - `champion_key`: 英雄键名（如 "champion_91"）
/// - `summoner`: 召唤师基本信息
/// - `match_history`: 近期战绩
/// - `user_tag`: 用户标签（KDA、胜率等计算数据）
/// - `rank`: 排位段位信息
/// - `meet_games`: 与当前用户的历史对局记录
/// - `pre_group_markers`: 预组队标记
/// - `is_loading`: 是否仍在加载中
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummoner {
    /// 英雄 ID
    pub champion_id: i32,
    /// 英雄键名
    pub champion_key: String,
    /// 召唤师基本信息
    pub summoner: Summoner,
    /// 近期战绩
    pub match_history: MatchHistory,
    /// 用户标签数据
    pub user_tag: UserTag,
    /// 排位段位信息
    pub rank: Rank,
    /// 与当前用户的历史对局记录
    pub meet_games: Vec<OneGamePlayer>,
    /// 预组队标记
    pub pre_group_markers: PreGroupMarker,
    /// 是否仍在加载中
    pub is_loading: bool,
}

/// 预组队标记，用于标识同一预组队内的成员名称与类型。
///
/// # 字段说明
///
/// - `name`: 队伍名称（如 "队伍1", "队伍2"）
/// - `marker_type`: 标记类型（用于前端样式，如 "success", "warning", "error", "info"）
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreGroupMarker {
    /// 队伍名称
    pub name: String,
    /// 标记类型（用于前端样式）
    #[serde(rename = "type")]
    pub marker_type: String,
}

/// 获取当前对局会话数据（事件推送模式）。
///
/// 这是前端调用的主入口命令。函数立即返回，实际数据处理在后台任务中执行，
/// 通过 Tauri 事件逐步推送结果。
///
/// # 参数
///
/// - `app_handle`: Tauri 应用句柄，用于发送事件
///
/// # 返回值
///
/// - `Ok(())`: 后台任务已启动
/// - `Err(String)`: 启动失败时的错误信息
///
/// # 事件序列
///
/// 1. `session-basic-info`: 基础信息（玩家列表、英雄）
/// 2. `session-player-update-team-one`: 我方玩家逐个更新
/// 3. `session-player-update-team-two`: 敌方玩家逐个更新
/// 4. `session-pre-group`: 预组队标记信息
/// 5. `session-complete`: 完整数据（最终事件）
/// 6. `session-error`: 错误事件（发生错误时）
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

/// 实际处理会话数据：拉取 phase/session、组队、补全玩家信息并依次推送事件。
///
/// 这是内部核心处理函数，负责完整的会话数据获取和事件推送流程。
///
/// # 参数
///
/// - `app_handle`: Tauri 应用句柄
///
/// # 返回值
///
/// - `Ok(())`: 处理完成
/// - `Err(String)`: 处理过程中的错误
///
/// # 处理流程
///
/// 1. 获取当前召唤师信息
/// 2. 检查游戏阶段，若不在有效阶段返回空数据
/// 3. 获取会话数据，选人阶段时补充选人信息
/// 4. 调整队伍顺序（确保我方在左）
/// 5. 补全缺失的玩家信息
/// 6. 按位置排序
/// 7. 推送基础信息
/// 8. 并行获取双方队伍的详细信息
/// 9. 检测预组队
/// 10. 处理历史对局记录
/// 11. 发送完成事件
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
                        selected_position: String::new(),
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

    // 我方始终在左（team_one）、敌方在右（team_two）。通过 LCU 当前召唤师 my_summoner 判断，
    // 若当前用户不在 team_one 则交换 team_one/team_two，避免数据错位。
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

    // LCU 有时某队少返回 1 人（如二队只有 4 个），用 playerChampionSelections 补全为 5 人。 这是因为隐藏了用户名 隐藏战绩是可以看的
    // selections 顺序固定为 [LCU 一队 5 人, LCU 二队 5 人]。若上面做过 need_swap，
    // 则当前 team_one=原 LCU 二队、team_two=原 LCU 一队，补全时需对调取用的区间。
    let selections = &session.game_data.player_champion_selections;
    if selections.len() == 10 {
        let (first_five, second_five) = if need_swap {
            (&selections[5..10], &selections[0..5])
        } else {
            (&selections[0..5], &selections[5..10])
        };
        if session.game_data.team_one.len() < 5 {
            session.game_data.team_one = first_five
                .iter()
                .map(|s| crate::lcu::api::session::OnePlayer {
                    champion_id: s.champion_id,
                    puuid: s.puuid.clone(),
                    selected_position: String::new(), // Default for champion selection
                })
                .collect();
        }
        if session.game_data.team_two.len() < 5 {
            session.game_data.team_two = second_five
                .iter()
                .map(|s| crate::lcu::api::session::OnePlayer {
                    champion_id: s.champion_id,
                    puuid: s.puuid.clone(),
                    selected_position: String::new(),
                })
                .collect();
        }
    }

    // 排序逻辑：根据 selected_position 对队伍进行排序
    // 顺序：TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY, 其他
    fn get_position_weight(pos: &str) -> i32 {
        match pos {
            "TOP" => 1,
            "JUNGLE" => 2,
            "MIDDLE" => 3,
            "BOTTOM" => 4,
            "UTILITY" => 5,
            _ => 99,
        }
    }

    session
        .game_data
        .team_one
        .sort_by_key(|p| get_position_weight(&p.selected_position));
    session
        .game_data
        .team_two
        .sort_by_key(|p| get_position_weight(&p.selected_position));

    let mode = session.game_data.queue.id;

    // 推送基础信息
    push_basic_info(&session, &mut session_data, &app_handle).await?;

    log::info!(
        "正在处理队伍一（我方），人数: {}",
        session.game_data.team_one.len()
    );
    // 并行处理队伍一（我方）
    process_team_parallel(
        &session.game_data.team_one,
        &mut session_data.team_one,
        mode,
        &app_handle,
        true, // is_team_one
    )
    .await?;

    log::info!(
        "正在处理队伍二（敌方），人数: {}",
        session.game_data.team_two.len()
    );
    // 并行处理队伍二（敌方）
    process_team_parallel(
        &session.game_data.team_two,
        &mut session_data.team_two,
        mode,
        &app_handle,
        false, // is_team_one
    )
    .await?;

    // 标记预组队
    add_pre_group_markers(&mut session_data);

    // ... (rest of the function remains same)
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

/// 并发获取基础队伍信息（召唤师名称、英雄等）。
///
/// 这是第一阶段的数据获取，只包含基础信息，用于快速展示。
///
/// # 参数
///
/// - `session`: LCU 会话数据
/// - `session_data`: 输出数据结构
/// - `app_handle`: Tauri 应用句柄
///
/// # 返回值
///
/// - `Ok(())`: 基础信息已推送
/// - `Err(String)`: 处理错误
///
/// # 推送事件
///
/// - `session-basic-info`: 包含基础信息的 SessionData
async fn push_basic_info(
    session: &Session,
    session_data: &mut SessionData,
    app_handle: &AppHandle,
) -> Result<(), String> {
    async fn get_basic_team(team: &[crate::lcu::api::session::OnePlayer]) -> Vec<SessionSummoner> {
        let futures = team.iter().map(|player| async move {
            if player.puuid.is_empty() {
                return SessionSummoner {
                    champion_id: player.champion_id,
                    champion_key: format!("champion_{}", player.champion_id),
                    summoner: Summoner::default(),
                    match_history: MatchHistory::default(),
                    user_tag: UserTag::default(),
                    rank: Rank::default(),
                    meet_games: Vec::new(),
                    pre_group_markers: PreGroupMarker::default(),
                    is_loading: false,
                };
            }
            let summoner = Summoner::get_summoner_by_puuid(&player.puuid)
                .await
                .unwrap_or_default();

            SessionSummoner {
                champion_id: player.champion_id,
                champion_key: format!("champion_{}", player.champion_id),
                summoner,
                match_history: MatchHistory::default(),
                user_tag: UserTag::default(),
                rank: Rank::default(),
                meet_games: Vec::new(),
                pre_group_markers: PreGroupMarker::default(),
                is_loading: true,
            }
        });

        futures::future::join_all(futures).await
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

/// 并行处理队伍的公共函数。
///
/// 并发获取队伍中所有玩家的详细信息（战绩、段位、标签等），并逐个推送更新事件。
///
/// # 参数
///
/// - `team`: LCU 队伍玩家列表
/// - `result`: 输出结果列表
/// - `mode`: 当前队列模式 ID
/// - `app_handle`: Tauri 应用句柄
/// - `is_team_one`: 是否为我方队伍（影响事件名称）
///
/// # 返回值
///
/// - `Ok(())`: 处理完成
/// - `Err(String)`: 处理错误
///
/// # 推送事件
///
/// - `session-player-update-team-one`: 我方玩家更新
/// - `session-player-update-team-two`: 敌方玩家更新
///
/// # 获取数据
///
/// 对每个玩家获取：
/// 1. 召唤师信息
/// 2. 近期战绩（通过配置决定数量）
/// 3. 用户标签（KDA、胜率等计算数据）
/// 4. 排位段位
async fn process_team_parallel(
    team: &[crate::lcu::api::session::OnePlayer],
    result: &mut Vec<SessionSummoner>,
    mode: i32,
    app_handle: &AppHandle,
    is_team_one: bool,
) -> Result<(), String> {
    // 定义获取单个玩家信息的异步任务
    let futures = team.iter().enumerate().map(|(_index, player)| async move {
        // 无 puuid（隐藏战绩）仍推送占位
        if player.puuid.is_empty() {
            log::debug!("索引 {} 的玩家 PUUID 为空，跳过获取", _index);
            return SessionSummoner {
                champion_id: player.champion_id,
                champion_key: format!("champion_{}", player.champion_id),
                summoner: Summoner::default(),
                match_history: MatchHistory::default(),
                user_tag: UserTag::default(),
                rank: Rank::default(),
                meet_games: Vec::new(),
                pre_group_markers: PreGroupMarker::default(),
                is_loading: false,
            };
        }

        // 读取配置（轻量操作，在 join 前执行）
        let count = match crate::config::get_config("matchHistoryCount").await {
            Ok(crate::config::Value::Integer(v)) => v as i32,
            Ok(crate::config::Value::String(s)) => s.parse().unwrap_or(4),
            _ => 4,
        };
        let puuid = player.puuid.clone();

        // 并行获取召唤师信息、战绩、段位
        let (summoner, match_history, rank) = tokio::join!(
            async {
                match Summoner::get_summoner_by_puuid(&puuid).await {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!("Failed to get summoner for {}: {}", puuid, e);
                        Summoner::default()
                    }
                }
            },
            async {
                match MatchHistory::get_match_history_by_puuid(&puuid, 0, count - 1).await {
                    Ok(mut mh) => {
                        mh.enrich_info_cn().ok();
                        mh
                    }
                    Err(e) => {
                        log::warn!("Failed to get match history for {}: {}", puuid, e);
                        MatchHistory::default()
                    }
                }
            },
            async {
                match Rank::get_rank_by_puuid(&puuid).await {
                    Ok(mut r) => {
                        r.enrich_cn_info();
                        r
                    }
                    Err(e) => {
                        log::warn!("Failed to get rank for {}: {}", puuid, e);
                        Rank::default()
                    }
                }
            }
        );

        // 获取用户标签（可能依赖 match_history 数据，顺序执行）
        let user_tag =
            match crate::command::user_tag::get_user_tag_by_puuid(&puuid, mode).await {
                Ok(tag) => tag,
                Err(e) => {
                    log::warn!("Failed to get user tag for {}: {}", puuid, e);
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

        SessionSummoner {
            champion_id: player.champion_id,
            champion_key: format!("champion_{}", player.champion_id),
            summoner: summoner.clone(),
            match_history,
            user_tag,
            rank,
            meet_games: Vec::new(),
            pre_group_markers: PreGroupMarker::default(),
            is_loading: false,
        }
    });

    // 并行执行所有任务
    let fetched_players = futures::future::join_all(futures).await;

    // 将结果添加到 result 并推送事件
    for (index, session_summoner) in fetched_players.into_iter().enumerate() {
        result.push(session_summoner.clone());

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
            // log::info!("Emitted player update: {} of {}", index + 1, team.len());
        }
    }

    Ok(())
}

/// 标记预组队队友。
///
/// 分析每个玩家的历史对局记录，检测可能预组队的玩家群体。
///
/// # 参数
///
/// - `session_data`: 会话数据，将被修改添加预组队标记
///
/// # 检测逻辑
///
/// 1. 遍历每个玩家的 `one_game_players_map`（历史同场玩家）
/// 2. 筛选出也在当前对局中的玩家
/// 3. 统计同队次数（`is_my_team = true`）
/// 4. 同队次数 >= 3 视为可能预组队
/// 5. 合并重叠的队伍（去除子集）
/// 6. 为检测到的预组队分配标记
///
/// # 标记分配
///
/// 最多支持 4 个预组队标记：
/// - 队伍1: success（绿色）
/// - 队伍2: warning（黄色）
/// - 队伍3: error（红色）
/// - 队伍4: info（蓝色）
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

    // 处理 TeamOne（我方）
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

    // 处理 TeamTwo（敌方）
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

/// 插入遇到过的玩家记录。
///
/// 将当前用户与每个玩家的历史对局记录填充到 `meet_games` 字段。
///
/// # 参数
///
/// - `session_data`: 会话数据
/// - `my_puuid`: 当前用户的 PUUID
fn insert_meet_gamers_record(session_data: &mut SessionData, my_puuid: &str) {
    // 获取自己的 SessionSummoner 并克隆 one_game_players_map 以避免借用冲突
    let my_one_game_players_map = session_data
        .team_one
        .iter()
        .find(|s| s.summoner.puuid == my_puuid)
        .and_then(|s| s.user_tag.recent_data.one_game_players_map.clone());

    if let Some(my_map) = my_one_game_players_map {
        // 遍历并修改我方
        for session_summoner in &mut session_data.team_one {
            if session_summoner.summoner.puuid == my_puuid {
                continue;
            }
            if let Some(games) = my_map.get(&session_summoner.summoner.puuid) {
                session_summoner.meet_games = games.clone();
            }
        }

        // 遍历并修改敌方
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

/// 删除 Tag 标记中的 OneGamePlayersMap（减少传输数据量）。
///
/// 在发送最终数据前清理不需要的大字段，减少 IPC 传输开销。
///
/// # 参数
///
/// - `session_data`: 会话数据
fn delete_meet_gamers_record(session_data: &mut SessionData) {
    for session_summoner in &mut session_data.team_one {
        session_summoner.user_tag.recent_data.one_game_players_map = None;
    }
    for session_summoner in &mut session_data.team_two {
        session_summoner.user_tag.recent_data.one_game_players_map = None;
    }
}

/// 去重并保留最大范围的数组。
///
/// 从多个可能重叠的数组中，去除被其他数组完全包含的子集。
///
/// # 参数
///
/// - `arrays`: 输入的数组列表
///
/// # 返回值
///
/// 去重后的数组列表，按长度降序排列
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

/// 判断 a 是否是 b 的子集。
///
/// # 参数
///
/// - `a`: 待检查的数组
/// - `b`: 参考数组
///
/// # 返回值
///
/// - `true`: a 是 b 的真子集（a 的长度严格小于 b 且所有元素都在 b 中）
/// - `false`: a 不是 b 的子集
fn is_subset(a: &[String], b: &[String]) -> bool {
    // 如果a的长度大于等于b的长度，a肯定不可能是b的子集
    if a.len() >= b.len() {
        return false;
    }

    // 使用HashMap存储b中的元素，检查a的元素是否都在b中
    let b_map: HashMap<&String, ()> = b.iter().map(|item| (item, ())).collect();

    a.iter().all(|item| b_map.contains_key(item))
}

/// 取两个数组的交集。
///
/// # 参数
///
/// - `arr1`: 第一个数组
/// - `arr2`: 第二个数组
///
/// # 返回值
///
/// 同时在两个数组中出现的元素列表
fn intersection(arr1: &[String], arr2: &[String]) -> Vec<String> {
    let set: HashMap<&String, ()> = arr1.iter().map(|s| (s, ())).collect();
    arr2.iter()
        .filter(|s| set.contains_key(s))
        .cloned()
        .collect()
}

/// 判断元素是否在数组中。
///
/// # 参数
///
/// - `e`: 待检查的元素
/// - `arr`: 数组
///
/// # 返回值
///
/// - `true`: 元素在数组中
/// - `false`: 元素不在数组中
fn one_in_arr(e: &str, arr: &[String]) -> bool {
    arr.iter().any(|elem| elem == e)
}
