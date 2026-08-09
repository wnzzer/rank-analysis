//! # Info 命令模块
//!
//! 提供与召唤师/对局相关的辅助信息，如根据名称解析服务器（平台）名称。
//!
//! ## 主要功能
//!
//! - **服务器查询**: 根据召唤师名称查询所在服务器的中文名称
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 查询服务器名称
//! let platform = get_platform_name_by_name("召唤师名称".to_string()).await?;
//! println!("所在服务器: {}", platform); // 如 "艾欧尼亚"
//! ```

use crate::constant;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;

/// 根据召唤师名称获取其所在服务器（平台）的中文名称。
///
/// # 参数
///
/// - `name`: 召唤师名称
///
/// # 返回值
///
/// - `Ok(String)`: 服务器中文名称（如 "艾欧尼亚", "黑色玫瑰" 等）
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 查询流程
///
/// 1. 通过名称获取召唤师 PUUID
/// 2. 获取该召唤师的对局记录
/// 3. 从对局记录中提取 `platform_id`
/// 4. 通过 `SGP_SERVER_ID_TO_NAME` 映射为中文名称
///
/// # 注意
///
/// 如果该召唤师没有进行过任何对局，可能无法获取服务器信息。
#[tauri::command]
pub async fn get_platform_name_by_name(name: String) -> Result<String, String> {
    let puuid = Summoner::get_summoner_by_name(&name).await?.puuid;
    let match_history = MatchHistory::get_match_history_by_puuid(&puuid, 0, 1).await?;
    constant::game::SGP_SERVER_ID_TO_NAME
        .get(match_history.platform_id.as_str())
        .map(|&v| v.to_string())
        .ok_or_else(|| "未找到对应的服务器名称".to_string())
}
