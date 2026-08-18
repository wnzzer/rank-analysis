//! # 习惯标签命令（command/insight，M3 战场三）
//!
//! - `get_habit_tags`：全量收集 → 聚合 → 幂等落库 → 返回（重算一体，前端
//!   只需调一个命令）。拿不到本机 summoner 时如实报错。
//! - 改错清单：`list_habit_goals` / `add_habit_goal` / `toggle_habit_goal`。

use crate::insight::aggregate_habit_tags;
use crate::insight::store::{
    add_habit_goal, query_habit_goals, query_habit_tags, toggle_habit_goal, upsert_habit_tags,
    HabitGoal, HabitTag,
};
use crate::lcu::api::summoner::Summoner;
use crate::meet_db;

/// 重算并落库全部习惯标签（幂等覆盖），返回标签列表（短板最明显在前）。
#[tauri::command]
pub async fn get_habit_tags() -> Result<Vec<HabitTag>, String> {
    let me = Summoner::get_my_summoner()
        .await
        .map_err(|e| format!("拿不到本机召唤师: {e}"))?;
    let games: Vec<_> = meet_db::all_collected_games()
        .into_iter()
        .flat_map(|(_, _, games)| games)
        .collect();
    let tags = aggregate_habit_tags(&games, &me.puuid);
    upsert_habit_tags(&tags);
    Ok(tags)
}

/// 改错清单：全部目标（未完成在前）。
#[tauri::command]
pub fn list_habit_goals() -> Result<Vec<HabitGoal>, String> {
    Ok(query_habit_goals())
}

/// 改错清单：加一条目标，返回新 id。
#[tauri::command]
pub fn add_habit_goal_cmd(dimension: String, title: String) -> Result<i64, String> {
    if title.trim().is_empty() {
        return Err("目标不能为空".to_string());
    }
    add_habit_goal(&dimension, &title).ok_or_else(|| "记忆库不可用".to_string())
}

/// 改错清单：勾选/取消勾选（幂等）。
#[tauri::command]
pub fn toggle_habit_goal_cmd(id: i64) -> Result<(), String> {
    if !toggle_habit_goal(id) {
        return Err("记忆库不可用".to_string());
    }
    Ok(())
}
