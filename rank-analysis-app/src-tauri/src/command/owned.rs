//! # 已拥有英雄命令模块
//!
//! 提供「当前账号已拥有的英雄」查询命令，供选人期推荐面板的「仅已拥有」筛选使用。

/// 获取当前账号已拥有的英雄 ID 列表。
///
/// # 返回值
///
/// - `Ok(Vec<i32>)`: 已拥有英雄 ID 列表
/// - `Err(String)`: LCU 请求失败或响应解析失败
///
/// # 降级约定
///
/// 调用方拿不到该列表时应**关闭「仅已拥有」筛选**（而非清空候选池）：
/// 推荐面板缺这一层过滤只是候选变宽，直接清空会让整个推荐不可用。
#[tauri::command]
pub async fn get_owned_champions() -> Result<Vec<i32>, String> {
    crate::lcu::api::owned::get_owned_champion_ids().await
}
