//! # 遇见过玩家查询命令（P1-1）
//!
//! 会话流程（`get_session_data`）负责自动入库，这里的只读命令供前端按需
//! 查询某玩家的全量相遇聚合（设置页玩家台账 / 对局卡详情场景）。

use crate::meet_db::{query_summary, MeetSummary};

/// 查询某玩家（puuid）的累计相遇聚合与最近明细。
///
/// 与 `session-complete` 事件里 `meetGames`/`meetTotal` 的关系：会话事件给的
/// 是「当前用户视角 + 实时 20 场 + 库补历史」，这里是任意路径直接查库。
/// 库里无记录时返回零值摘要（`total = 0`），不视为错误。
#[tauri::command]
pub fn query_meet_summary(puuid: String) -> Result<MeetSummary, String> {
    query_summary(&puuid).ok_or_else(|| "遇见过数据库未就绪".to_string())
}