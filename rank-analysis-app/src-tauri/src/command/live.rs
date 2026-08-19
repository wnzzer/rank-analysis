//! # 下一动作推荐命令（M5a 基础版 + M5b 增强版）
//!
//! `get_next_actions`：对局中实时下一动作建议。命令层负责取数据
//! （liveclientdata 快照 + PUGG 出装 + 习惯标签），引擎层纯计算。
//!
//! 轮询由前端负责（Gaming.vue 按 2s 间隔 invoke），引擎保证 < 2ms。

use crate::insight::store::query_habit_tags;
use crate::lcu::api::live_game::get_live_game_snapshot;
use crate::live::suggest_next_actions;
use crate::live::NextAction;

/// 获取对局中下一动作建议（含习惯标签增强）。
///
/// # 参数
/// - `my_champion_id`: 本局我方英雄 id
/// - `my_game_name`: 本局我方召唤师名（用于在快照中定位自己）
/// - `my_puuid`: 本机召唤师 puuid（用于拉取 PUGG 出装）
/// - `queue_id`: 对局模式（用于 PUGG 模式过滤）
///
/// # 返回值
/// - `Ok(actions)`: 建议列表（可能为空——数据不足或不在对局中时不编造）
/// - `Err(String)`: 快照解析异常
#[tauri::command]
pub async fn get_next_actions(
    my_champion_id: i32,
    my_game_name: String,
    my_puuid: String,
    queue_id: i32,
) -> Result<Vec<NextAction>, String> {
    let Some(snapshot) = get_live_game_snapshot().await? else {
        return Ok(Vec::new());
    };

    let build_stats = crate::command::build_stats::get_build_stats(
        my_puuid,
        my_champion_id,
        queue_id,
        String::new(),
    )
    .await
    .ok()
    .flatten();

    let habit_tags = query_habit_tags();

    Ok(suggest_next_actions(
        &snapshot,
        my_champion_id,
        &my_game_name,
        build_stats.as_ref(),
        &habit_tags,
    ))
}
