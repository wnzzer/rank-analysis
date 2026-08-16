//! # 遇见过玩家查询命令（P1-1）
//!
//! 会话流程（`get_session_data`）负责自动入库，这里的只读命令供前端按需
//! 查询某玩家的全量相遇聚合（设置页玩家台账 / 对局卡详情场景）。
//!
//! 另含跨区「收集全部」结果持久化命令（读写 SQLite 的 `collected_games` 表，
//! 供战绩页跨区模式重启后恢复全量收集，见 `meet_db::save/load/clear`）。

use crate::lcu::api::match_history::Game;
use crate::meet_db::{
    clear_collected_games as db_clear_collected_games,
    load_collected_games as db_load_collected_games, query_summary,
    save_collected_games as db_save_collected_games, MeetSummary,
};

/// 查询某玩家（puuid）的累计相遇聚合与最近明细。
///
/// 与 `session-complete` 事件里 `meetGames`/`meetTotal` 的关系：会话事件给的
/// 是「当前用户视角 + 实时 20 场 + 库补历史」，这里是任意路径直接查库。
/// 库里无记录时返回零值摘要（`total = 0`），不视为错误。
#[tauri::command]
pub fn query_meet_summary(puuid: String) -> Result<MeetSummary, String> {
    query_summary(&puuid).ok_or_else(|| "遇见过数据库未就绪".to_string())
}

/// 持久化跨区「收集全部」结果（SQLite 覆盖写入，`(region, name)` 主键）。
#[tauri::command]
pub fn save_collected_games(region: String, name: String, games: Vec<Game>) -> Result<(), String> {
    db_save_collected_games(&region, &name, &games);
    Ok(())
}

/// 读取已持久化的跨区收集结果；无记录返回空数组。
#[tauri::command]
pub fn load_collected_games(region: String, name: String) -> Result<Vec<Game>, String> {
    Ok(db_load_collected_games(&region, &name))
}

/// 清除某玩家的跨区收集结果。
#[tauri::command]
pub fn clear_collected_games(region: String, name: String) -> Result<(), String> {
    db_clear_collected_games(&region, &name);
    Ok(())
}
