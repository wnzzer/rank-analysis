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
//!     ▼
//! session-player-update     # 各小队玩家逐个更新（payload 含 subteamId 字段）
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
//!     listen('session-player-update', (event) => { /* payload: { subteamId, index, total, player } */ });
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
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

/// Session 任务全局序列号——**只允许最新任务推送事件**。
///
/// WebSocket 监听器（`lcu::listener`）在 gameflow / 选人等事件上频繁触发
/// [`get_session_data`]，每次都 spawn 一个并发任务。上一局结束（EndOfGame）
/// 触发的任务要拉全部 10 人的战绩/段位、耗时数秒；紧接着新开一局的选人任务
/// 很轻、先完成。若不做序列化，**旧局的慢任务会晚到并把上一局敌方数据覆盖回
/// 前端**（表现为：新开一局时对局页仍显示上一局的敌方）。因此每个任务领取
/// 递增序列号，推送前校验自己仍是最新——被更新任务超越的旧任务全部静默作废。
static SESSION_TASK_SEQ: AtomicU64 = AtomicU64::new(0);

/// 领取一个新的 session 任务序列号（使计数器 +1 并返回新值）。
fn begin_session_task(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::SeqCst) + 1
}

/// 判断 `seq` 是否仍是最新任务（期间无更新任务领号）。
fn is_latest_task(counter: &AtomicU64, seq: u64) -> bool {
    counter.load(Ordering::SeqCst) == seq
}

/// 对局会话的完整展示数据，包含阶段、队列、所有小队及每个玩家的汇总信息。
///
/// # 字段说明
///
/// - `phase`: 当前游戏阶段（如 "ChampSelect", "InProgress"）
/// - `queue_type`: 队列类型代码
/// - `type_cn`: 队列类型中文名称
/// - `queue_id`: 队列 ID
/// - `game_mode`: LCU 给的 gameMode（如 "CLASSIC" / "CHERRY"）
/// - `is_multi_team`: 是否多小队模式（CHERRY 等 N 队混战）
/// - `my_subteam_id`: 当前用户所在的 subteamId（CLASSIC: 1=team_one；CHERRY: 1~8）
/// - `subteams`: 所有小队，CLASSIC 长度 2，CHERRY 长度 1~8
/// - `cherry_subteams_pending`: CHERRY 模式下当前分队是否仍是占位数据（EOG 端点尚未返回权威 subteamId）。
///   true 表示前端应继续轮询直到该端点 ready。CLASSIC 模式恒为 false。
/// - `champ_select`: 选人阶段的结构化视图（会话级阶段 + 双方已 ban 列表）。
///   仅 `phase == "ChampSelect"` 时为 `Some`，其余阶段为 `None` 且不序列化该字段。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub phase: String,
    #[serde(rename = "type")]
    pub queue_type: String,
    pub type_cn: String,
    pub queue_id: i32,
    pub game_mode: String,
    pub is_multi_team: bool,
    pub my_subteam_id: i32,
    pub subteams: Vec<Subteam>,
    #[serde(default)]
    pub cherry_subteams_pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub champ_select: Option<crate::lcu::api::champion_select::ChampSelectView>,
}

/// 一个小队的展示数据：编号 + 玩家列表。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subteam {
    /// 小队 ID（CLASSIC: 1=我方、2=敌方；CHERRY: 1~8）
    pub subteam_id: i32,
    /// 小队成员
    pub players: Vec<SessionSummoner>,
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
    /// 选人状态："none"|"intent"|"picking"|"locked"；非选人阶段为空字符串
    #[serde(default)]
    pub pick_state: String,
    /// 本局官方分配分路（LCU 小写命名，如 "middle"）；仅选人期我方有值，
    /// 供 AI 选人分析拼对线关系用——缺了它模型只能靠猜，会猜出前后矛盾的分路。
    #[serde(default)]
    pub assigned_position: String,
}

/// 预组队标记，用于标识同一预组队内的成员名称与类型。
///
/// # 字段说明
///
/// - `name`: 预组队组名（如 "队伍1", "队伍2"；与对局页两侧「队伍 1 / 队伍 2」列标题
///   同词但含义不同——前端徽章上有 tooltip 说明这是预组队分组，跟敌我阵营无关）
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
/// 2. `session-player-update`: 各小队玩家逐个更新（payload 含 `subteamId` 字段）
/// 3. `session-pre-group`: 预组队标记信息
/// 4. `session-complete`: 完整数据（最终事件）
/// 5. `session-error`: 错误事件（发生错误时）
#[tauri::command]
pub async fn get_session_data(app_handle: AppHandle) -> Result<(), String> {
    log::info!("get_session_data called");

    // 领取序列号：一旦有更新的调用进来，本任务的所有推送将被作废（防旧局数据晚到覆盖）。
    let seq = begin_session_task(&SESSION_TASK_SEQ);

    // 在后台线程处理，避免阻塞
    tokio::spawn(async move {
        match process_session_data(app_handle.clone(), seq).await {
            Ok(_) => {
                log::info!("Session data processing completed (seq {})", seq);
            }
            Err(e) => {
                log::error!("Failed to process session data: {}", e);
                // 发送错误事件（旧任务的错误同样不打扰前端）
                if is_latest_task(&SESSION_TASK_SEQ, seq) {
                    let _ = app_handle.emit("session-error", e);
                }
            }
        }
    });

    Ok(())
}

/// 选人会话玩家 → gameflow 形状的 `session::OnePlayer`。
///
/// - `selected_position` 刻意留空——保持 LCU my_team/their_team 的原始顺序
///   （=客户端选人界面的排列）。进入对局后 gameflow 数据才带 position 做分路排序。
///   sort_by_key 是稳定排序，全部 weight 99 时原序保留。
/// - `assigned_position` 原样透传（我方有值、敌方 LCU 恒为空），供 AI 分析拼对线关系。
fn champ_select_to_one_player(
    p: &crate::lcu::api::champion_select::OnePlayer,
    pick_states: &std::collections::HashMap<i32, String>,
) -> crate::lcu::api::session::OnePlayer {
    crate::lcu::api::session::OnePlayer {
        champion_id: crate::lcu::api::champion_select::display_champion_id(p),
        puuid: p.puuid.clone(),
        selected_position: String::new(),
        team_participant_id: 0,
        pick_state: pick_states
            .get(&p.cell_id)
            .cloned()
            .unwrap_or_else(|| "none".to_string()),
        assigned_position: p.assigned_position.clone(),
    }
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
async fn process_session_data(app_handle: AppHandle, seq: u64) -> Result<(), String> {
    let my_summoner = Summoner::get_my_summoner().await?;

    let phase = get_phase().await?;
    let valid_phases = ["ChampSelect", "InProgress", "PreEndOfGame", "EndOfGame"];
    if !valid_phases.contains(&phase.as_str()) {
        log::info!("Not in a valid game phase: {}", phase);
        if !is_latest_task(&SESSION_TASK_SEQ, seq) {
            return Ok(());
        }
        let empty_data = SessionData::default();
        app_handle
            .emit("session-complete", &empty_data)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut session = Session::get_session().await?;

    // 选人阶段的结构化视图（会话级阶段 + 双方已 ban 列表），随后写入 session_data.champ_select；
    // 非选人阶段 / 拉取失败时保持 None。
    let mut champ_select_view: Option<crate::lcu::api::champion_select::ChampSelectView> = None;

    if phase == "ChampSelect" {
        match get_champion_select_session().await {
            Ok(select_session) => {
                let (view, pick_states) =
                    crate::lcu::api::champion_select::derive_champ_select_view(&select_session);
                champ_select_view = Some(view);
                let to_one_player = |p: &crate::lcu::api::champion_select::OnePlayer| {
                    champ_select_to_one_player(p, &pick_states)
                };
                session.game_data.team_one =
                    select_session.my_team.iter().map(to_one_player).collect();
                // 敌方：champ-select 会话的 theirTeam 是本局权威数据（championId 随锁定
                // 逐个可见；排位下 puuid 匿名为空，仅展示英雄不展示身份）。
                // 旧局 selections 残留的防回填守卫（in_champ_select）保持不变。
                session.game_data.team_two = select_session
                    .their_team
                    .iter()
                    .map(to_one_player)
                    .collect();
            }
            Err(e) => {
                log::warn!("Failed to get champion select session: {}", e);
            }
        }
    }

    let game_mode = session.game_data.queue.game_mode.clone();
    let is_multi_team = game_mode == "CHERRY";

    let mut session_data = SessionData {
        phase: session.phase.clone(),
        queue_type: session.game_data.queue.queue_type.clone(),
        type_cn: QUEUE_TYPE_TO_CN
            .get(session.game_data.queue.queue_type.as_str())
            .unwrap_or(&"其他")
            .to_string(),
        queue_id: session.game_data.queue.id,
        game_mode: game_mode.clone(),
        is_multi_team,
        my_subteam_id: 0,
        subteams: Vec::new(),
        cherry_subteams_pending: false,
        champ_select: champ_select_view,
    };

    if is_multi_team {
        build_cherry_subteams(&mut session, &mut session_data, &my_summoner.puuid).await?;
    } else {
        build_classic_subteams(&mut session, &mut session_data, &my_summoner.puuid);
    }

    let mode = session.game_data.queue.id;

    push_basic_info(&mut session_data, &app_handle, seq).await?;

    for subteam_idx in 0..session_data.subteams.len() {
        // 已有更新任务在跑：本任务是旧局/旧快照，放弃剩余重活（每人战绩/段位拉取）。
        if !is_latest_task(&SESSION_TASK_SEQ, seq) {
            log::info!("Session task {} superseded, aborting", seq);
            return Ok(());
        }
        let subteam_id = session_data.subteams[subteam_idx].subteam_id;
        let players_meta: Vec<crate::lcu::api::session::OnePlayer> = session_data.subteams
            [subteam_idx]
            .players
            .iter()
            .map(|p| crate::lcu::api::session::OnePlayer {
                champion_id: p.champion_id,
                puuid: p.summoner.puuid.clone(),
                selected_position: String::new(),
                team_participant_id: 0,
                pick_state: p.pick_state.clone(),
                assigned_position: p.assigned_position.clone(),
            })
            .collect();

        let mut filled: Vec<SessionSummoner> = Vec::with_capacity(players_meta.len());
        process_subteam_parallel(
            &players_meta,
            &mut filled,
            mode,
            &app_handle,
            subteam_id,
            seq,
        )
        .await?;
        session_data.subteams[subteam_idx].players = filled;
    }

    if !is_multi_team {
        add_pre_group_markers(&mut session_data);
    }

    let mut markers: HashMap<String, PreGroupMarker> = HashMap::new();
    for subteam in &session_data.subteams {
        for p in &subteam.players {
            if !p.pre_group_markers.name.is_empty() {
                markers.insert(p.summoner.puuid.clone(), p.pre_group_markers.clone());
            }
        }
    }

    if !markers.is_empty() && is_latest_task(&SESSION_TASK_SEQ, seq) {
        app_handle
            .emit("session-pre-group", &markers)
            .map_err(|e| e.to_string())?;
    }

    insert_meet_gamers_record(&mut session_data, &my_summoner.puuid);
    delete_meet_gamers_record(&mut session_data);

    // 最终校验：期间若有更新任务领号（如已进入下一局），本快照作废，
    // 避免旧局的完整数据（含上一局敌方）晚到覆盖前端。
    if !is_latest_task(&SESSION_TASK_SEQ, seq) {
        log::info!("Session task {} superseded, dropping final emit", seq);
        return Ok(());
    }
    app_handle
        .emit("session-complete", &session_data)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// CLASSIC（5v5 等）模式分组：保留原有 swap + selections 补全 + 位置排序逻辑，最后包成 subteams[2]。
fn build_classic_subteams(session: &mut Session, session_data: &mut SessionData, my_puuid: &str) {
    let need_swap = !session
        .game_data
        .team_one
        .iter()
        .any(|p| p.puuid == *my_puuid);

    if need_swap {
        std::mem::swap(
            &mut session.game_data.team_one,
            &mut session.game_data.team_two,
        );
    }

    let selections = &session.game_data.player_champion_selections;
    // 选人阶段绝不用 selections 回填：新选人早期 gameflow session 常残留
    // **上一局**的 playerChampionSelections（10 条，可能包含自己），会把上一局
    // 敌方灌回刚被清空的 team_two——表现为"第二局选人时对面还是上一局的人、
    // 我同时出现在两边"。我方来自 champ-select session（权威），敌方在选人
    // 阶段本就不可见，应保持为空。selections 回填仅服务于 InProgress 起始段
    // gameflow 队伍数据不全的场景。
    let in_champ_select = session.phase == "ChampSelect";
    if selections.len() == 10 && !in_champ_select {
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
                    selected_position: String::new(),
                    team_participant_id: 0,
                    pick_state: String::new(),
                    assigned_position: String::new(),
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
                    team_participant_id: 0,
                    pick_state: String::new(),
                    assigned_position: String::new(),
                })
                .collect();
        }
    }

    fn position_weight(pos: &str) -> i32 {
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
        .sort_by_key(|p| position_weight(&p.selected_position));
    session
        .game_data
        .team_two
        .sort_by_key(|p| position_weight(&p.selected_position));

    let make_placeholder = |team: &[crate::lcu::api::session::OnePlayer]| -> Vec<SessionSummoner> {
        team.iter()
            .map(|p| SessionSummoner {
                champion_id: p.champion_id,
                champion_key: format!("champion_{}", p.champion_id),
                summoner: Summoner {
                    puuid: p.puuid.clone(),
                    ..Default::default()
                },
                pick_state: p.pick_state.clone(),
                // 本局分路两源合一：选人期来自 champ-select 的 assignedPosition（小写），
                // InProgress 起 gameflow 只有 selectedPosition（大写）——空则回填，
                // 大小写由前端统一 toUpperCase 归一。
                assigned_position: if p.assigned_position.is_empty() {
                    p.selected_position.clone()
                } else {
                    p.assigned_position.clone()
                },
                ..Default::default()
            })
            .collect()
    };

    session_data.subteams = vec![
        Subteam {
            subteam_id: 1,
            players: make_placeholder(&session.game_data.team_one),
        },
        Subteam {
            subteam_id: 2,
            players: make_placeholder(&session.game_data.team_two),
        },
    ];
    session_data.my_subteam_id = 1;
}

/// CHERRY/斗魂分支：优先用 EOG 实时端点拿权威 1~8 小队号，否则回退到 lobby tpid。
///
/// **数据来源优先级**：
/// 1. `lol-end-of-game/v1/gameclient-eog-stats-block` —— InProgress / PreEndOfGame /
///    EndOfGame 阶段返回 16 个玩家的 `puuid + subteamId(1~8)`，权威配对。
/// 2. fallback: `gameflow/session.teamOne` 的 `teamParticipantId` —— champ-select /
///    lobby 阶段或 EOG 端点不可用时使用，按 tpid 分组（可能稀疏，单人对会显示已离开）。
async fn build_cherry_subteams(
    session: &mut Session,
    session_data: &mut SessionData,
    my_puuid: &str,
) -> Result<(), String> {
    let mut all_players: Vec<crate::lcu::api::session::OnePlayer> = Vec::new();
    all_players.append(&mut session.game_data.team_one);
    all_players.append(&mut session.game_data.team_two);

    if all_players.is_empty() {
        all_players = session
            .game_data
            .player_champion_selections
            .iter()
            .map(|s| crate::lcu::api::session::OnePlayer {
                champion_id: s.champion_id,
                puuid: s.puuid.clone(),
                selected_position: String::new(),
                team_participant_id: 0,
                pick_state: String::new(),
                assigned_position: String::new(),
            })
            .collect();
    }

    // 尝试拉 EOG 实时端点拿权威 puuid → subteamId 映射
    let eog_subteam_map: Option<std::collections::HashMap<String, i32>> =
        match crate::lcu::api::eog_stats::EogStatsBlock::get().await {
            Ok(eog) => {
                let map: std::collections::HashMap<String, i32> = eog
                    .stats_block
                    .players
                    .into_iter()
                    .filter(|p| !p.puuid.is_empty() && p.subteam_id > 0)
                    .map(|p| (p.puuid, p.subteam_id))
                    .collect();
                if map.is_empty() {
                    None
                } else {
                    log::info!(
                        "[CHERRY] EOG endpoint available, {} authoritative subteam mappings",
                        map.len()
                    );
                    Some(map)
                }
            }
            Err(e) => {
                log::warn!(
                    "[CHERRY] EOG endpoint unavailable, fallback to teamParticipantId: {}",
                    e
                );
                None
            }
        };

    let used_eog = eog_subteam_map.is_some();

    use std::collections::BTreeMap;
    let mut grouped: BTreeMap<i32, Vec<crate::lcu::api::session::OnePlayer>> = BTreeMap::new();
    for p in all_players {
        // 优先用 EOG 的权威 subteamId；缺失时回退到 tpid
        let key = eog_subteam_map
            .as_ref()
            .and_then(|m| m.get(&p.puuid).copied())
            .unwrap_or(p.team_participant_id);
        grouped.entry(key).or_default().push(p);
    }

    // 排序：我方先（false < true），其它按原 key 升序
    let mut entries: Vec<(i32, Vec<crate::lcu::api::session::OnePlayer>)> =
        grouped.into_iter().collect();
    entries.sort_by_key(|(key, group)| {
        let is_other = !group.iter().any(|p| p.puuid == *my_puuid);
        (is_other, *key)
    });

    let to_summoner = |p: &crate::lcu::api::session::OnePlayer| SessionSummoner {
        champion_id: p.champion_id,
        champion_key: format!("champion_{}", p.champion_id),
        summoner: Summoner {
            puuid: p.puuid.clone(),
            ..Default::default()
        },
        pick_state: p.pick_state.clone(),
        // 同 build_classic_subteams：空则回填 gameflow 的 selectedPosition
        assigned_position: if p.assigned_position.is_empty() {
            p.selected_position.clone()
        } else {
            p.assigned_position.clone()
        },
        ..Default::default()
    };

    let mut subteams: Vec<Subteam> = Vec::with_capacity(entries.len());
    let mut my_subteam_id = 0;
    for (i, (orig_key, group)) in entries.into_iter().enumerate() {
        // EOG 可用 → 保留权威 key（与游戏内"队伍 X"一致）；
        // EOG 不可用 → 重映射 1..N（避免稀疏 tpid 显示成"队伍 13"）。
        let subteam_id = if used_eog { orig_key } else { (i as i32) + 1 };
        if group.iter().any(|p| p.puuid == *my_puuid) {
            my_subteam_id = subteam_id;
        }
        subteams.push(Subteam {
            subteam_id,
            players: group.iter().map(to_summoner).collect(),
        });
    }

    session_data.subteams = subteams;
    session_data.my_subteam_id = my_subteam_id;
    // EOG 没返回权威 subteamId 时，当前数据是 tpid 兜底（在新斗魂下 tpid 噪音很大），
    // 标记 pending 让前端持续轮询直到 EOG ready。
    session_data.cherry_subteams_pending = !used_eog;
    Ok(())
}

async fn push_basic_info(
    session_data: &mut SessionData,
    app_handle: &AppHandle,
    seq: u64,
) -> Result<(), String> {
    async fn fill_team(team: &mut Vec<SessionSummoner>) {
        let futures = team.iter().map(|placeholder| {
            let puuid = placeholder.summoner.puuid.clone();
            let champion_id = placeholder.champion_id;
            let pick_state = placeholder.pick_state.clone();
            let assigned_position = placeholder.assigned_position.clone();
            async move {
                if puuid.is_empty() {
                    return SessionSummoner {
                        champion_id,
                        champion_key: format!("champion_{}", champion_id),
                        is_loading: false,
                        pick_state,
                        assigned_position,
                        ..Default::default()
                    };
                }
                let summoner = Summoner::get_summoner_by_puuid(&puuid)
                    .await
                    .unwrap_or_default();
                SessionSummoner {
                    champion_id,
                    champion_key: format!("champion_{}", champion_id),
                    summoner,
                    is_loading: true,
                    pick_state,
                    assigned_position,
                    ..Default::default()
                }
            }
        });
        *team = futures::future::join_all(futures).await;
    }

    for subteam in &mut session_data.subteams {
        fill_team(&mut subteam.players).await;
    }

    // 旧任务的基础信息不再推送（防旧局快照晚到覆盖）。
    if !is_latest_task(&SESSION_TASK_SEQ, seq) {
        return Ok(());
    }
    app_handle
        .emit("session-basic-info", &session_data)
        .map_err(|e| e.to_string())?;

    // 不要在这里清空 subteams.players——后续 process_subteam_parallel 会用
    // 当前 placeholder（championId / puuid）来构造每个小队的 meta 列表，最后整体覆盖。
    Ok(())
}

async fn process_subteam_parallel(
    players: &[crate::lcu::api::session::OnePlayer],
    result: &mut Vec<SessionSummoner>,
    mode: i32,
    app_handle: &AppHandle,
    subteam_id: i32,
    seq: u64,
) -> Result<(), String> {
    #[derive(Serialize)]
    struct PlayerUpdate {
        #[serde(rename = "subteamId")]
        subteam_id: i32,
        index: usize,
        total: usize,
        player: SessionSummoner,
    }

    let total = players.len();

    let futures = players
        .iter()
        .enumerate()
        .map(|(index, player)| async move {
            if player.puuid.is_empty() {
                return SessionSummoner {
                    champion_id: player.champion_id,
                    champion_key: format!("champion_{}", player.champion_id),
                    is_loading: false,
                    pick_state: player.pick_state.clone(),
                    assigned_position: player.assigned_position.clone(),
                    ..Default::default()
                };
            }

            let count = crate::config::get_config("matchHistoryCount")
                .await
                .ok()
                .as_ref()
                .and_then(crate::config::extract_int)
                .map(|n| n as i32)
                .unwrap_or(4);
            let puuid = player.puuid.clone();
            let champion_id = Some(player.champion_id).filter(|&id| id > 0);

            let (summoner, match_history, rank) =
                tokio::join!(
                    async {
                        Summoner::get_summoner_by_puuid(&puuid)
                            .await
                            .unwrap_or_default()
                    },
                    async {
                        // 必须走缓存路径（miss 时固定拉满 0-49 再切片），不能裸拉 0..count-1：
                        // LCU 按 puuid 整包缓存战绩，冷 puuid 的**首个请求区间会钉死它缓存的
                        // 场数**，之后 begIndex/endIndex 被忽略、永远整包返回。若这里先发小区间
                        // 请求，战绩页/标签计算从此只能拿到 count 场（真机实测复现）。
                        let mut result =
                            match MatchHistory::get_match_history_by_puuid(&puuid, 0, count - 1)
                                .await
                            {
                                Ok(mut mh) => {
                                    mh.enrich_info_cn().ok();
                                    mh
                                }
                                Err(_) => MatchHistory::default(),
                            };
                        // 玩家总场数不足时会落到直连分支，LCU 可能无视区间整包返回，兜底截断
                        if result.games.games.len() > count as usize {
                            result.games.games.truncate(count as usize);
                        }
                        result
                    },
                    async {
                        match Rank::get_rank_by_puuid(&puuid).await {
                            Ok(mut r) => {
                                r.enrich_cn_info();
                                r
                            }
                            Err(_) => Rank::default(),
                        }
                    }
                );

            // 先推送基础数据（无 user_tag），让 UI 尽早渲染玩家战绩卡片
            if is_latest_task(&SESSION_TASK_SEQ, seq) {
                let basic = SessionSummoner {
                    champion_id: player.champion_id,
                    champion_key: format!("champion_{}", player.champion_id),
                    summoner: summoner.clone(),
                    match_history: match_history.clone(),
                    user_tag: UserTag::default(),
                    rank: rank.clone(),
                    meet_games: Vec::new(),
                    pre_group_markers: PreGroupMarker::default(),
                    is_loading: false,
                    pick_state: player.pick_state.clone(),
                    assigned_position: player.assigned_position.clone(),
                };
                let update = PlayerUpdate {
                    subteam_id,
                    index,
                    total,
                    player: basic,
                };
                if let Err(e) = app_handle.emit("session-player-update", &update) {
                    log::error!("Failed to emit player update event: {}", e);
                }
            }

            let user_tag =
                crate::command::user_tag::get_user_tag_by_puuid(&puuid, mode, champion_id)
                    .await
                    .unwrap_or_else(|_| UserTag {
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
                    });

            SessionSummoner {
                champion_id: player.champion_id,
                champion_key: format!("champion_{}", player.champion_id),
                summoner,
                match_history,
                user_tag,
                rank,
                meet_games: Vec::new(),
                pre_group_markers: PreGroupMarker::default(),
                is_loading: false,
                pick_state: player.pick_state.clone(),
                assigned_position: player.assigned_position.clone(),
            }
        });

    let fetched_players = futures::future::join_all(futures).await;

    // 数据仍写回 result（供调用方组装最终快照），但旧任务不再逐个推送给前端。
    let emit_allowed = is_latest_task(&SESSION_TASK_SEQ, seq);

    for (index, session_summoner) in fetched_players.into_iter().enumerate() {
        result.push(session_summoner.clone());

        if !emit_allowed {
            continue;
        }

        let update = PlayerUpdate {
            subteam_id,
            index,
            total: players.len(),
            player: session_summoner,
        };

        if let Err(e) = app_handle.emit("session-player-update", &update) {
            log::error!("Failed to emit player update event: {}", e);
        }
    }

    Ok(())
}

fn add_pre_group_markers(session_data: &mut SessionData) {
    let friend_threshold = 3;
    let team_min_sum = 2;
    let mut all_maybe_teams: Vec<Vec<String>> = Vec::new();

    let mut current_game_puuids: HashMap<String, bool> = HashMap::new();
    let subteam_puuids: Vec<Vec<String>> = session_data
        .subteams
        .iter()
        .map(|s| s.players.iter().map(|p| p.summoner.puuid.clone()).collect())
        .collect();

    for puuids in &subteam_puuids {
        for puuid in puuids {
            current_game_puuids.insert(puuid.clone(), true);
        }
    }

    for subteam in &session_data.subteams {
        for session_summoner in &subteam.players {
            let mut the_teams = Vec::new();
            if let Some(ref one_game_players_map) =
                session_summoner.user_tag.recent_data.one_game_players_map
            {
                for (puuid, play_record_arr) in one_game_players_map {
                    if !current_game_puuids.contains_key(puuid) {
                        continue;
                    }
                    let team_count = play_record_arr.iter().filter(|r| r.is_my_team).count();
                    if team_count >= friend_threshold {
                        the_teams.push(puuid.clone());
                    }
                }
            }
            if !the_teams.is_empty() {
                all_maybe_teams.push(the_teams);
            }
        }
    }

    let merged_teams = remove_subsets(&all_maybe_teams);

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
        for (subteam_idx, st_puuids) in subteam_puuids.iter().enumerate() {
            let inter = intersection(&team, st_puuids);
            if inter.len() >= team_min_sum {
                for s in &mut session_data.subteams[subteam_idx].players {
                    if one_in_arr(&s.summoner.puuid, &inter) && s.pre_group_markers.name.is_empty()
                    {
                        s.pre_group_markers = pre_group_maker_consts[const_index].clone();
                        marked = true;
                    }
                }
                if marked {
                    break; // 保留原 if/else if 语义：单组只标第一个匹配的小队
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

fn insert_meet_gamers_record(session_data: &mut SessionData, my_puuid: &str) {
    let my_one_game_players_map = session_data
        .subteams
        .iter()
        .flat_map(|s| s.players.iter())
        .find(|s| s.summoner.puuid == my_puuid)
        .and_then(|s| s.user_tag.recent_data.one_game_players_map.clone());

    if let Some(my_map) = my_one_game_players_map {
        for subteam in &mut session_data.subteams {
            for s in &mut subteam.players {
                if s.summoner.puuid == my_puuid {
                    continue;
                }
                if let Some(games) = my_map.get(&s.summoner.puuid) {
                    s.meet_games = games.clone();
                }
            }
        }
    }
}

fn delete_meet_gamers_record(session_data: &mut SessionData) {
    for subteam in &mut session_data.subteams {
        for s in &mut subteam.players {
            s.user_tag.recent_data.one_game_players_map = None;
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::champion_select::ChampSelectView;
    use crate::lcu::api::session::{GameData, OnePlayer, Queue, Session};

    /// `champ_select` 应以 camelCase（`champSelect`/`myBans`/`theirBans`）序列化，
    /// 供前端直接消费选人阶段流视图。
    #[test]
    fn champ_select_field_serializes_camel_case_when_present() {
        let data = SessionData {
            phase: "ChampSelect".into(),
            champ_select: Some(ChampSelectView {
                stage: "banning".into(),
                my_bans: vec![266],
                their_bans: vec![103],
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["champSelect"]["stage"], "banning");
        assert_eq!(json["champSelect"]["myBans"][0], 266);
        assert_eq!(json["champSelect"]["theirBans"][0], 103);
    }

    /// 非选人阶段 `champ_select` 为 None 时，字段应整体省略（skip_serializing_if）。
    #[test]
    fn champ_select_field_omitted_when_none() {
        let data = SessionData {
            phase: "InProgress".into(),
            champ_select: None,
            ..Default::default()
        };
        let json = serde_json::to_value(&data).unwrap();
        assert!(json.get("champSelect").is_none());
    }

    #[test]
    fn newer_session_task_supersedes_older() {
        // 复现修复的竞态：旧局 EndOfGame 的慢任务不得在新局任务领号后继续推送
        let counter = AtomicU64::new(0);
        let old_task = begin_session_task(&counter);
        assert!(is_latest_task(&counter, old_task), "唯一任务应是最新");

        let new_task = begin_session_task(&counter);
        assert!(
            !is_latest_task(&counter, old_task),
            "被超越的旧任务必须作废（防止上一局敌方数据晚到覆盖）"
        );
        assert!(is_latest_task(&counter, new_task));
    }

    #[test]
    fn session_task_seq_is_monotonic() {
        let counter = AtomicU64::new(0);
        let a = begin_session_task(&counter);
        let b = begin_session_task(&counter);
        let c = begin_session_task(&counter);
        assert!(a < b && b < c);
        assert!(is_latest_task(&counter, c));
    }

    fn make_session_classic() -> Session {
        Session {
            phase: "InProgress".into(),
            game_data: GameData {
                game_id: 1,
                is_custom_game: false,
                queue: Queue {
                    queue_type: "RANKED_SOLO_5x5".into(),
                    id: 420,
                    game_mode: "CLASSIC".into(),
                },
                player_champion_selections: vec![],
                team_one: (1..=5)
                    .map(|i| OnePlayer {
                        champion_id: i,
                        puuid: format!("ally-{}", i),
                        selected_position: "TOP".into(),
                        team_participant_id: 0,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    })
                    .collect(),
                team_two: (6..=10)
                    .map(|i| OnePlayer {
                        champion_id: i,
                        puuid: format!("enemy-{}", i),
                        selected_position: "TOP".into(),
                        team_participant_id: 0,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    })
                    .collect(),
            },
        }
    }

    #[test]
    fn classic_should_build_two_subteams_with_my_subteam_one() {
        let mut session = make_session_classic();
        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");
        assert_eq!(data.subteams.len(), 2);
        assert_eq!(data.subteams[0].subteam_id, 1);
        assert_eq!(data.subteams[1].subteam_id, 2);
        assert_eq!(data.my_subteam_id, 1);
        assert!(data.subteams[0]
            .players
            .iter()
            .any(|p| p.summoner.puuid == "ally-1"));
    }

    /// 造 10 条"上一局残留"的 selections（我在后五，模拟上一局在红色方）。
    fn stale_selections_with_me(
        my_puuid: &str,
    ) -> Vec<crate::lcu::api::session::PlayerChampionSelection> {
        (1..=10)
            .map(|i| crate::lcu::api::session::PlayerChampionSelection {
                champion_id: i,
                puuid: if i == 7 {
                    my_puuid.to_string()
                } else {
                    format!("stale-{}", i)
                },
            })
            .collect()
    }

    /// 回归：新选人早期 gameflow session 残留上一局 selections 时，
    /// 绝不能把上一局敌方灌回刚清空的 team_two（真机复现：第二局选人时
    /// 对面显示上一局十人、且"我"同时出现在两边）。
    #[test]
    fn champselect_must_not_refill_enemy_from_stale_selections() {
        let mut session = make_session_classic();
        session.phase = "ChampSelect".into();
        // 模拟 process_session_data 的 ChampSelect 分支：我方来自选人会话、
        // 敌方来自 their_team（此处为空 vec，模拟选人早期敌方尚未亮出任何英雄）
        session.game_data.team_one.truncate(5);
        session.game_data.team_two.clear();
        // gameflow 残留：上一局的 10 条 selections（含"我"在后五）
        session.game_data.player_champion_selections = stale_selections_with_me("ally-1");

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");

        assert_eq!(
            data.subteams[1].players.len(),
            0,
            "选人阶段敌方必须保持为空，不得被上一局 selections 回填"
        );
        // 我方不受影响
        assert_eq!(data.subteams[0].players.len(), 5);
        // "我"绝不能出现在敌方
        assert!(
            !data.subteams[1]
                .players
                .iter()
                .any(|p| p.summoner.puuid == "ally-1"),
            "我不应出现在敌方小队"
        );
    }

    /// 选人期敌方必须从 their_team 填充（仅英雄无身份），pick_state 贯穿。
    #[test]
    fn champselect_fills_enemy_from_their_team_with_pick_state() {
        let mut session = make_session_classic();
        session.phase = "ChampSelect".into();
        // 模拟 ChampSelect 分支产物：我方 5 人已选、敌方 3 人已亮（2 锁定 1 意向）
        session.game_data.team_one.truncate(5);
        session.game_data.team_two = vec![
            crate::lcu::api::session::OnePlayer {
                champion_id: 10,
                puuid: String::new(),
                selected_position: String::new(),
                team_participant_id: 0,
                pick_state: "locked".into(),
                assigned_position: String::new(),
            },
            crate::lcu::api::session::OnePlayer {
                champion_id: 55,
                puuid: String::new(),
                selected_position: String::new(),
                team_participant_id: 0,
                pick_state: "intent".into(),
                assigned_position: String::new(),
            },
            crate::lcu::api::session::OnePlayer {
                champion_id: 0,
                puuid: String::new(),
                selected_position: String::new(),
                team_participant_id: 0,
                pick_state: "none".into(),
                assigned_position: String::new(),
            },
        ];
        // 残留 selections 依旧不得回填（守卫回归）
        session.game_data.player_champion_selections = stale_selections_with_me("ally-1");

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");

        assert_eq!(data.subteams[1].players.len(), 3, "敌方应来自 their_team");
        assert_eq!(data.subteams[1].players[0].champion_id, 10);
        assert_eq!(data.subteams[1].players[0].pick_state, "locked");
        assert_eq!(data.subteams[1].players[1].pick_state, "intent");
        assert!(
            data.subteams[1]
                .players
                .iter()
                .all(|p| p.summoner.puuid.is_empty()),
            "选人期敌方不应有身份"
        );
        assert!(
            !data.subteams[1]
                .players
                .iter()
                .any(|p| p.summoner.puuid == "ally-1"),
            "我不应出现在敌方"
        );
    }

    /// 选人期我方 assigned_position（LCU 官方分配的本局分路）必须透传到
    /// SessionSummoner——AI 选人分析要靠它拼对线关系，丢了模型只能瞎猜。
    #[test]
    fn classic_propagates_assigned_position_to_players() {
        let mut session = make_session_classic();
        session.phase = "ChampSelect".into();
        session.game_data.team_one.truncate(5);
        let lanes = ["top", "jungle", "middle", "bottom", "utility"];
        for (i, p) in session.game_data.team_one.iter_mut().enumerate() {
            p.assigned_position = lanes[i].to_string();
        }
        session.game_data.team_two.clear();

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");

        let positions: Vec<String> = data.subteams[0]
            .players
            .iter()
            .map(|p| p.assigned_position.clone())
            .collect();
        assert_eq!(
            positions,
            vec!["top", "jungle", "middle", "bottom", "utility"],
            "我方本局分路必须原样透传"
        );
    }

    /// 选人会话 → session::OnePlayer 的映射必须带上 assigned_position 与 pick_state。
    #[test]
    fn champ_select_to_one_player_carries_assigned_position() {
        let p = crate::lcu::api::champion_select::OnePlayer {
            champion_id: 10,
            puuid: "p1".into(),
            assigned_position: "middle".into(),
            cell_id: 0,
            champion_pick_intent: 0,
        };
        let mut pick_states = std::collections::HashMap::new();
        pick_states.insert(0, "locked".to_string());
        let one = champ_select_to_one_player(&p, &pick_states);
        assert_eq!(one.assigned_position, "middle");
        assert_eq!(one.pick_state, "locked");
        assert_eq!(one.champion_id, 10);
        assert!(
            one.selected_position.is_empty(),
            "选人期不填 selected_position，保持客户端原始排列"
        );
    }

    /// InProgress 阶段 gameflow 只有 selected_position（assigned_position 为空），
    /// 必须回填进 SessionSummoner.assigned_position——对局中 AI 分析靠它拼对线。
    #[test]
    fn inprogress_backfills_assigned_position_from_selected_position() {
        let mut session = make_session_classic();
        session.phase = "InProgress".into();
        let lanes = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
        for (i, p) in session.game_data.team_one.iter_mut().enumerate() {
            p.selected_position = lanes[i].to_string();
            p.assigned_position = String::new();
        }

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");

        let positions: Vec<String> = data.subteams[0]
            .players
            .iter()
            .map(|p| p.assigned_position.clone())
            .collect();
        assert_eq!(
            positions,
            vec!["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"],
            "selected_position 应回填为本局分路"
        );
    }

    /// 对照：InProgress 阶段 gameflow 队伍不全时，selections 回填行为保留。
    #[test]
    fn inprogress_still_refills_teams_from_selections() {
        let mut session = make_session_classic();
        session.phase = "InProgress".into();
        session.game_data.team_two.clear(); // 模拟 gameflow 队伍数据不全
        session.game_data.player_champion_selections = stale_selections_with_me("ally-1");

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "ally-1");

        assert_eq!(
            data.subteams[1].players.len(),
            5,
            "InProgress 下 selections 回填应保留（本局数据合法）"
        );
    }

    #[test]
    fn classic_should_swap_when_user_in_team_two() {
        let mut session = make_session_classic();
        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "enemy-7");
        assert!(data.subteams[0]
            .players
            .iter()
            .any(|p| p.summoner.puuid == "enemy-7"));
        assert_eq!(data.my_subteam_id, 1);
    }

    fn make_session_cherry() -> Session {
        // 8 个 subteam × 2 人 = 16，全部塞 team_one
        let mut team_one = Vec::new();
        for tpid in 1..=8 {
            for slot in 0..2 {
                team_one.push(OnePlayer {
                    champion_id: tpid * 10 + slot,
                    puuid: format!("p-{}-{}", tpid, slot),
                    selected_position: "NONE".into(),
                    team_participant_id: tpid,
                    pick_state: String::new(),
                    assigned_position: String::new(),
                });
            }
        }
        Session {
            phase: "InProgress".into(),
            game_data: GameData {
                game_id: 2,
                is_custom_game: false,
                queue: Queue {
                    queue_type: "CHERRY".into(),
                    id: 1700,
                    game_mode: "CHERRY".into(),
                },
                player_champion_selections: vec![],
                team_one,
                team_two: vec![],
            },
        }
    }

    #[tokio::test]
    async fn cherry_should_split_into_eight_subteams_of_two() {
        let mut session = make_session_cherry();
        let mut data = SessionData {
            game_mode: "CHERRY".into(),
            is_multi_team: true,
            ..Default::default()
        };
        build_cherry_subteams(&mut session, &mut data, "p-3-0")
            .await
            .unwrap();
        assert_eq!(data.subteams.len(), 8);
        for s in &data.subteams {
            assert_eq!(s.players.len(), 2);
        }
        // my_puuid p-3-0 应在某个 subteam 里
        let mine = data
            .subteams
            .iter()
            .find(|s| s.players.iter().any(|p| p.summoner.puuid == "p-3-0"))
            .expect("my subteam");
        assert_eq!(data.my_subteam_id, mine.subteam_id);
        // 注意：build_cherry_subteams 内部硬调 EOG 端点（无法在测试中 mock），
        // 因此 cherry_subteams_pending 取决于运行测试时本机 LCU 是否恰好可达，
        // 不在此处断言；其语义由代码本身保证（pending = !used_eog）。
    }

    #[tokio::test]
    async fn cherry_should_handle_partial_subteam() {
        // 只剩 3 人，分成 2 + 1
        let mut session = Session {
            phase: "InProgress".into(),
            game_data: GameData {
                game_id: 3,
                is_custom_game: false,
                queue: Queue {
                    queue_type: "CHERRY".into(),
                    id: 1700,
                    game_mode: "CHERRY".into(),
                },
                player_champion_selections: vec![],
                team_one: vec![
                    OnePlayer {
                        champion_id: 1,
                        puuid: "a".into(),
                        selected_position: "".into(),
                        team_participant_id: 1,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    },
                    OnePlayer {
                        champion_id: 2,
                        puuid: "b".into(),
                        selected_position: "".into(),
                        team_participant_id: 1,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    },
                    OnePlayer {
                        champion_id: 3,
                        puuid: "c".into(),
                        selected_position: "".into(),
                        team_participant_id: 4,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    },
                ],
                team_two: vec![],
            },
        };
        let mut data = SessionData {
            game_mode: "CHERRY".into(),
            is_multi_team: true,
            ..Default::default()
        };
        build_cherry_subteams(&mut session, &mut data, "a")
            .await
            .unwrap();
        assert_eq!(data.subteams.len(), 2);
        assert_eq!(data.subteams[0].players.len(), 2);
        assert_eq!(data.subteams[1].players.len(), 1);
    }

    #[tokio::test]
    async fn cherry_should_preserve_sparse_tpids_without_synthetic_pairing() {
        // 腾讯客户端真实数据：4 个完整对 + 8 个单人 → 12 个 raw 组
        // 不强行合并单人——保留 12 个 subteam（4 个 2 人 + 8 个 1 人）
        let mut team_one = Vec::new();
        for tpid in [1, 4, 6, 7] {
            for slot in 0..2 {
                team_one.push(OnePlayer {
                    champion_id: tpid * 10 + slot,
                    puuid: format!("paired-{}-{}", tpid, slot),
                    selected_position: "NONE".into(),
                    team_participant_id: tpid,
                    pick_state: String::new(),
                    assigned_position: String::new(),
                });
            }
        }
        for tpid in [3, 5, 8, 9, 10, 11, 12, 13] {
            team_one.push(OnePlayer {
                champion_id: tpid * 10,
                puuid: format!("solo-{}", tpid),
                selected_position: "NONE".into(),
                team_participant_id: tpid,
                pick_state: String::new(),
                assigned_position: String::new(),
            });
        }
        let mut session = Session {
            phase: "InProgress".into(),
            game_data: GameData {
                game_id: 4,
                is_custom_game: false,
                queue: Queue {
                    queue_type: "CHERRY".into(),
                    id: 1700,
                    game_mode: "CHERRY".into(),
                },
                player_champion_selections: vec![],
                team_one,
                team_two: vec![],
            },
        };
        let mut data = SessionData {
            game_mode: "CHERRY".into(),
            is_multi_team: true,
            ..Default::default()
        };
        build_cherry_subteams(&mut session, &mut data, "paired-1-0")
            .await
            .unwrap();
        // 不合并：每个 raw tpid 保留为独立 subteam
        assert_eq!(data.subteams.len(), 12);
        // 我方排第一
        assert_eq!(data.my_subteam_id, 1);
        assert!(data.subteams[0]
            .players
            .iter()
            .any(|p| p.summoner.puuid == "paired-1-0"));
        assert_eq!(data.subteams[0].players.len(), 2);
        // 4 个完整对（含我方）+ 8 个单人
        let pair_count = data
            .subteams
            .iter()
            .filter(|s| s.players.len() == 2)
            .count();
        let solo_count = data
            .subteams
            .iter()
            .filter(|s| s.players.len() == 1)
            .count();
        assert_eq!(pair_count, 4);
        assert_eq!(solo_count, 8);
    }

    /// 回归：选人期我方玩家顺序应与客户端一致，不按分路重排。
    /// 构造 ChampSelect 场景 team_one 五人（selected_position 全空、champion_id 依次 1..5 标识顺序），
    /// 断言 build_classic_subteams 后玩家 champion_id 顺序仍为 1..5（未被重排）。
    #[test]
    fn champselect_preserves_player_order_without_reordering_by_position() {
        let mut session = Session {
            phase: "ChampSelect".into(),
            game_data: GameData {
                game_id: 5,
                is_custom_game: false,
                queue: Queue {
                    queue_type: "RANKED_SOLO_5x5".into(),
                    id: 420,
                    game_mode: "CLASSIC".into(),
                },
                player_champion_selections: vec![],
                // 选人期我方五人，champion_id 依次 1..5（用来标识顺序），selected_position 全空
                team_one: (1..=5)
                    .map(|i| OnePlayer {
                        champion_id: i,
                        puuid: format!("champ-{}", i),
                        selected_position: String::new(),
                        team_participant_id: 0,
                        pick_state: String::new(),
                        assigned_position: String::new(),
                    })
                    .collect(),
                team_two: vec![],
            },
        };

        let mut data = SessionData {
            game_mode: "CLASSIC".into(),
            ..Default::default()
        };
        build_classic_subteams(&mut session, &mut data, "champ-1");

        // 我方五人应保持原序 1..5，不因 selected_position 为空就被 sort_by_key 重排
        assert_eq!(data.subteams[0].players.len(), 5);
        let champion_ids: Vec<i32> = data.subteams[0]
            .players
            .iter()
            .map(|p| p.champion_id)
            .collect();
        assert_eq!(
            champion_ids,
            vec![1, 2, 3, 4, 5],
            "选人期玩家顺序应保持客户端选人界面排列"
        );
    }
}
