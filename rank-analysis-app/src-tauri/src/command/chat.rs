//! # 聊天/社交命令模块
//!
//! 目前只有好友列表查询,供前端 Header 超级搜索做本地模糊候选。

use crate::lcu::api::chat::{self, Friend};

/// 获取当前登录账号的好友列表。
///
/// # 返回值
///
/// - `Ok(Vec<Friend>)`: 好友列表(`{ gameName, tagLine, puuid }`)
/// - `Err(String)`: LCU 未连接或请求失败
#[tauri::command]
pub async fn get_friends() -> Result<Vec<Friend>, String> {
    chat::get_friends().await
}
