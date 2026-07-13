//! # Command 模块
//!
//! 暴露给前端的 Tauri 命令（Commands），封装 LCU API 调用与业务逻辑。
//!
//! ## 模块结构
//!
//! | 子模块 | 功能描述 |
//! |--------|----------|
//! | `asset` | 游戏资产元数据查询（物品、符文等） |
//! | `config` | 应用配置读写、选项数据查询 |
//! | `fandom` | Fandom 外部数据（大乱斗平衡数据） |
//! | `info` | 辅助信息查询（服务器名称等） |
//! | `match_history` | 对局记录查询与筛选 |
//! | `rank` | 段位查询与胜率统计 |
//! | `session` | 对局会话数据获取与处理 |
//! | `user_tag` | 用户标签计算与近期数据分析 |
//! | `user_tag_config` | 标签配置规则管理 |
//!
//! ## 命令注册
//!
//! 所有命令通过 `tauri::generate_handler!` 宏注册到 Tauri 运行时：
//!
//! ```rust,ignore
//! .invoke_handler(tauri::generate_handler![
//!     command::get_summoner_by_puuid,
//!     command::get_summoner_by_name,
//!     command::get_my_summoner,
//!     command::rank::get_rank_by_name,
//!     command::rank::get_rank_by_puuid,
//!     // ... 其他命令
//! ])
//! ```
//!
//! ## 错误处理
//!
//! 所有命令统一使用 `Result<T, String>` 作为返回类型：
//! - `Ok(T)`: 操作成功，返回数据
//! - `Err(String)`: 操作失败，返回错误信息字符串

pub mod ai;
pub mod asset;
pub mod cloud_sync;
pub mod config;
pub mod fandom;
pub mod info;
pub mod launcher;
pub mod match_history;
pub mod opgg;
pub mod rank;
pub mod rule_config;
pub mod session;
pub mod sgp;
pub mod system;
pub mod user_tag;
pub mod user_tag_config;

use crate::lcu::api::summoner::Summoner;

/// 根据 PUUID 获取召唤师信息。
///
/// # 参数
///
/// - `puuid`: 召唤师的 PUUID（玩家唯一标识符）
///
/// # 返回值
///
/// - `Ok(Summoner)`: 成功获取召唤师信息
/// - `Err(String)`: 获取失败，返回错误信息
#[tauri::command]
pub async fn get_summoner_by_puuid(puuid: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_puuid(&puuid).await
}

/// 根据召唤师名称获取召唤师信息。
///
/// # 参数
///
/// - `name`: 召唤师名称（游戏内显示名）
///
/// # 返回值
///
/// - `Ok(Summoner)`: 成功获取召唤师信息
/// - `Err(String)`: 获取失败（如玩家不存在），返回错误信息
#[tauri::command]
pub async fn get_summoner_by_name(name: String) -> Result<Summoner, String> {
    Summoner::get_summoner_by_name(&name).await
}

/// 获取当前登录客户端的召唤师信息。
///
/// 返回当前登录到 LCU 客户端的召唤师信息，即"我自己"的信息。
///
/// # 返回值
///
/// - `Ok(Summoner)`: 成功获取当前召唤师信息
/// - `Err(String)`: 获取失败（如客户端未登录），返回错误信息
#[tauri::command]
pub async fn get_my_summoner() -> Result<Summoner, String> {
    Summoner::get_my_summoner().await
}
