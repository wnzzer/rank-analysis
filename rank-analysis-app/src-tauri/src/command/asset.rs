//! # Asset 命令模块
//!
//! 提供前端悬浮说明所需的资产元数据，如物品和符文名称、描述等。
//!
//! ## 主要功能
//!
//! - **资产查询**: 根据类型和 ID 列表查询游戏资产详情
//! - **支持类型**: 物品、符文等游戏内资产
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 查询物品信息
//! let items = get_asset_details("item".to_string(), vec![1001, 1004]).await?;
//!
//! // 查询符文信息
//! let runes = get_asset_details("rune".to_string(), vec![8000, 8100]).await?;
//! ```

use crate::lcu::api::asset::{self, AssetDetails};

/// 获取资产详情列表。
///
/// 根据资产类型和 ID 列表查询对应的游戏资产元数据。
///
/// # 参数
///
/// - `type_string`: 资产类型字符串（如 "item", "rune" 等）
/// - `ids`: 资产 ID 列表
///
/// # 返回值
///
/// - `Ok(Vec<AssetDetails>)`: 资产详情列表
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 支持的资产类型
///
/// - `item`: 游戏物品
/// - `rune`: 符文
/// - `champion`: 英雄（通常通过其他接口获取）
///
/// # 示例
///
/// ```rust,ignore
/// // 查询鞋子和仙女护符
/// let details = get_asset_details("item".to_string(), vec![1001, 1004])?;
/// for detail in details {
///     println!("{}: {}", detail.name, detail.description);
/// }
/// ```
#[tauri::command]
pub fn get_asset_details(type_string: String, ids: Vec<i64>) -> Result<Vec<AssetDetails>, String> {
    asset::get_asset_details(type_string, ids)
}
