//! # MatchHistory 命令模块
//!
//! 提供对局记录查询功能：按 PUUID/名称查询、分页、队列/英雄筛选，以及详情与中文信息增强。
//!
//! ## 主要功能
//!
//! - **基础查询**: 按 PUUID 或名称获取对局记录
//! - **增强查询**: 自动补充对局详情和中文名称
//! - **筛选查询**: 支持按队列模式和英雄进行筛选
//!
//! ## 筛选逻辑
//!
//! ```text
//! 输入: 召唤师名称 + 筛选条件
//!     │
//!     ▼
//! ┌─────────────────┐
//! │ 分页获取对局记录 │ ◄── 每次最多 50 条
//! └─────────────────┘
//!     │
//!     ▼
//! ┌─────────────────┐
//! │ 应用筛选条件     │ ◄── queue_id + champion_id
//! └─────────────────┘
//!     │
//!     ▼
//! ┌─────────────────┐
//! │ 收集匹配结果     │ ◄── 最多 10 条
//! └─────────────────┘
//!     │
//!     ▼
//! 输出: 筛选后的对局记录
//! ```
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 基础查询
//! let history = get_match_history_by_puuid(puuid, 0, 20).await?;
//!
//! // 带筛选的查询
//! let filtered = get_filter_match_history_by_name(
//!     "玩家名称".to_string(),
//!     0,      // 起始索引
//!     100,    // 搜索深度
//!     420,    // 单双排
//!     91,     // 英雄 ID（卡特琳娜）
//! ).await?;
//! ```

use crate::lcu::api::{
    match_history::{Game, MatchHistory},
    summoner::Summoner,
};

/// 根据 PUUID 与索引范围获取对局记录（原始数据，无详情增强）。
///
/// # 参数
///
/// - `puuid`: 召唤师 PUUID
/// - `beg_index`: 起始索引（从 0 开始）
/// - `end_index`: 结束索引（包含）
///
/// # 返回值
///
/// - `Ok(MatchHistory)`: 对局记录
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 注意
///
/// LCU API 限制最多返回 50 条记录（索引 0-49）。
#[tauri::command]
pub async fn get_match_history(
    puuid: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    // This command specifically calls the get_match_history method
    MatchHistory::get_match_history_by_puuid(&puuid, beg_index, end_index).await
}

/// 根据 PUUID 获取对局记录并增强详情与中文信息。
///
/// # 参数
///
/// - `puuid`: 召唤师 PUUID
/// - `beg_index`: 起始索引
/// - `end_index`: 结束索引
///
/// # 返回值
///
/// - `Ok(MatchHistory)`: 增强后的对局记录
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 增强内容
///
/// 1. `enrich_game_detail()`: 补充对局详细信息
/// 2. `enrich_info_cn()`: 添加中文名称（英雄、地图等）
/// 3. `calculate()`: 计算统计数据
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

/// 根据召唤师名称获取对局记录（内部转为 PUUID 后调用 get_match_history_by_puuid）。
///
/// # 参数
///
/// - `name`: 召唤师名称
/// - `beg_index`: 起始索引
/// - `end_index`: 结束索引
///
/// # 返回值
///
/// - `Ok(MatchHistory)`: 增强后的对局记录
/// - `Err(String)`: 查询失败时的错误信息
#[tauri::command]
pub async fn get_match_history_by_name(
    name: String,
    beg_index: i32,
    end_index: i32,
) -> Result<MatchHistory, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    get_match_history_by_puuid(puuid, beg_index, end_index).await
}

/// 根据名称、索引范围及队列/英雄筛选获取对局记录（最多返回指定条数）。
///
/// # 参数
///
/// - `name`: 召唤师名称
/// - `beg_index`: 起始索引
/// - `end_index`: 搜索深度上限（会被限制为 49）
/// - `filter_queue_id`: 队列模式筛选（0 或负数表示不筛选）
/// - `filter_champion_id`: 英雄 ID 筛选（0 或负数表示不筛选）
///
/// # 返回值
///
/// - `Ok(MatchHistory)`: 筛选后的对局记录（最多 10 条）
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 筛选逻辑
///
/// 1. 分页获取对局记录（每页最多 50 条）
/// 2. 应用筛选条件（队列模式 + 英雄）
/// 3. 收集匹配结果直到达到 10 条或搜索完指定范围
/// 4. 对匹配结果增强详情
///
/// # 常量
///
/// - `MAX_RESULTS_TO_FIND`: 最多返回 10 条匹配记录
/// - `PAGE_SIZE`: 每次 API 请求获取 50 条
#[tauri::command]
pub async fn get_filter_match_history_by_name(
    name: String,
    beg_index: i32,
    mut end_index: i32,
    filter_queue_id: i32,
    filter_champion_id: i32,
) -> Result<MatchHistory, String> {
    // 可能是bug，超过49的记录无法查询，目前截断一下
    if end_index > 49 {
        end_index = 49;
    }
    // --- Configuration with named constants for improved readability ---
    const MAX_RESULTS_TO_FIND: usize = 10;
    const PAGE_SIZE: i32 = 50; // Fetch 50 matches per API request.

    // --- State Initialization ---
    let mut result_history = MatchHistory::default();
    let mut current_start_index = beg_index;
    let search_depth_limit = end_index;

    'outer: loop {
        // Stop if the next search would exceed the specified depth limit.
        if current_start_index >= search_depth_limit {
            break;
        }

        let mut current_end_index = current_start_index + PAGE_SIZE - 1;
        if current_end_index > 49 {
            current_end_index = 49;
        }

        // Fetch a "page" of match history from the data source.
        let page =
            get_match_history_by_name(name.clone(), current_start_index, current_end_index).await?;

        // If the API returns no more games, we've reached the end of the user's history.
        if page.games.games.is_empty() {
            break;
        }

        // --- Filter and collect matches from the fetched page ---
        for (i, game) in page.games.games.iter().enumerate() {
            if game_matches_filters(game, filter_queue_id, filter_champion_id) {
                result_history.games.games.push(game.clone());

                // If we've found the desired number of matches, the search is complete.
                if result_history.games.games.len() >= MAX_RESULTS_TO_FIND {
                    // Record the exact index where the search stopped.
                    result_history.end_index = current_start_index + i as i32;
                    break 'outer; // Exit both the inner and outer loops.
                }
            }
        }

        // --- Pagination: Prepare for the next iteration ---
        current_start_index += PAGE_SIZE;
    }

    // --- Finalization ---
    // If the loop terminated without `break 'outer'`, it means we either hit the
    // search depth limit or the end of the match history. In that case, the
    // end_index should be the last index we successfully queried.
    if result_history.end_index == 0 {
        result_history.end_index = current_start_index.min(search_depth_limit) - 1;
    }
    result_history.beg_index = beg_index;

    result_history.enrich_game_detail().await?;
    Ok(result_history)
}

/// 检查对局是否匹配筛选条件。
///
/// # 参数
///
/// - `game`: 对局数据
/// - `filter_queue_id`: 队列模式筛选（<= 0 表示不筛选）
/// - `filter_champion_id`: 英雄 ID 筛选（<= 0 表示不筛选）
///
/// # 返回值
///
/// - `true`: 对局匹配所有筛选条件
/// - `false`: 对局不匹配某些条件
///
/// # 匹配逻辑
///
/// - 队列匹配: `filter_queue_id <= 0` 或与对局队列属于同一模式分组
///   （多个队列 ID 共用同一中文名，如新旧人机队列同难度，按分组而非精确 ID 匹配）
/// - 英雄匹配: `filter_champion_id <= 0` 或参与者中使用了指定英雄
fn game_matches_filters(game: &Game, filter_queue_id: i32, filter_champion_id: i32) -> bool {
    let queue_matches = filter_queue_id <= 0
        || crate::constant::game::queue_ids_same_group(
            game.queue_id as u32,
            filter_queue_id as u32,
        );
    let champion_matches = filter_champion_id <= 0
        || game
            .participants
            .iter()
            .any(|p| p.champion_id == filter_champion_id);

    queue_matches && champion_matches
}

/// 根据对局 ID 获取对局详情。
///
/// # 参数
///
/// - `game_id`: 对局 ID
///
/// # 返回值
///
/// - `Ok(Game)`: 对局详情
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 说明
///
/// 该接口通过 LCU API 获取对局详情，并补充中文队列名称。
#[tauri::command]
pub async fn get_game_by_id(game_id: i64) -> Result<Game, String> {
    use crate::lcu::api::game_detail::GameDetail;

    // 获取对局详情
    let game_detail = GameDetail::get_game_detail_by_id(&game_id).await?;

    // 构造 Game 对象，使用 game_detail 中的字段
    let mut game = Game {
        game_id,
        game_detail: game_detail.clone(),
        game_creation_date: game_detail.game_creation_date.clone(),
        game_duration: game_detail.game_duration,
        game_mode: game_detail.game_mode.clone(),
        game_type: game_detail.game_type.clone(),
        map_id: game_detail.map_id,
        queue_id: game_detail.queue_id,
        queue_name: String::new(),
        platform_id: game_detail.platform_id.clone(),
        participant_identities: game_detail.participant_identities.clone(),
        participants: Vec::new(),
        mvp: String::new(),
    };

    // 从 game_detail 中提取 participants
    if !game_detail.participants.is_empty() {
        // 转换 GameDetailParticipant 到 Participant
        game.participants = game_detail
            .participants
            .iter()
            .map(|p| crate::lcu::api::model::Participant {
                participant_id: p.participant_id,
                team_id: p.team_id,
                champion_id: p.champion_id,
                spell1_id: p.spell1_id,
                spell2_id: p.spell2_id,
                stats: p.stats.clone(),
            })
            .collect();
    }

    // 补充队列中文名称
    game.queue_name =
        crate::lcu::api::match_history::resolve_queue_name_cn(game.queue_id, &game.game_mode);

    Ok(game)
}
