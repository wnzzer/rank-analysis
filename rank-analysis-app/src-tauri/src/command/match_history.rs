//! # MatchHistory 命令模块
//!
//! 提供对局记录查询功能：按 PUUID/名称查询、分页，以及详情与中文信息增强。
//!
//! ## 主要功能
//!
//! - **基础查询**: 按 PUUID 或名称获取对局记录
//! - **增强查询**: 自动补充对局详情和中文名称
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 基础查询
//! let history = get_match_history_by_puuid(puuid, 0, 20).await?;
//! ```

use crate::lcu::api::{
    match_history::{Game, MatchHistory},
    summoner::Summoner,
};

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
                perks: None,
                stats: p.stats.clone(),
                timeline: None,
            })
            .collect();
    }

    // 补充队列中文名称
    game.queue_name =
        crate::lcu::api::match_history::resolve_queue_name_cn(game.queue_id, &game.game_mode);

    Ok(game)
}
