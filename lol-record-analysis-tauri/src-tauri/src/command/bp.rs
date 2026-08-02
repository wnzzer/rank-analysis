//! # BP 决策命令模块
//!
//! 把 automation 常驻任务算好的决策快照暴露给前端。
//! 纯读取进程内静态存储，无 I/O、无锁等待，前端可安心高频轮询。

use crate::bp_decision::store;
use crate::bp_decision::types::BpDecision;

/// 读取当前 BP 决策快照。
///
/// # 返回值
/// - `Ok(Some(_))`: 选人期且有属于我的待办 BP 动作
/// - `Ok(None)`: 非选人期、我的回合已完成，或快照尚未生成
#[tauri::command]
pub async fn get_bp_decision() -> Result<Option<BpDecision>, String> {
    Ok(store::read())
}
