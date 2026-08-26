//! # Mayhem 命令模块
//!
//! 海克斯大乱斗（queueId 2400）数据的前端入口：
//! 同步（[`mayhem_sync`]）、状态查询（[`mayhem_status`]）、榜单读取
//! （[`mayhem_get_champions`] / [`mayhem_get_augments`]）、单英雄详情
//! （[`mayhem_get_champion_detail`]）。
//!
//! 数据契约与磁盘布局见 [`crate::mayhem`] 模块文档。
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 前端：首次进入大乱斗页时同步数据
//! let report = mayhem_sync(Some(false)).await?; // force=false，版本一致则跳过
//!
//! // 读取英雄榜（本地激活版本）
//! let champions = mayhem_get_champions().await?;
//! ```

use serde::Serialize;

use crate::mayhem::client::SyncReport;

/// 全局同步互斥锁：防止前端重复触发导致并发下载同一版本。
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 本地数据状态（供页面首屏渲染，不发网络请求）。
#[derive(Debug, Serialize)]
pub struct MayhemStatus {
    /// 当前激活的数据版本；未同步过为 null。
    pub active_version: Option<String>,
    /// 激活时间（Unix 秒）；未同步过为 null。
    pub synced_at: Option<i64>,
    /// 关键文件是否齐备（champions/augments/index 任一缺失视为不可用）。
    pub ready: bool,
}

/// 同步海克斯大乱斗数据到本地。
///
/// # 参数
///
/// - `force`: 强制重新下载（默认 false——远端版本一致时直接跳过）
///
/// # 返回值
///
/// - `Ok(None)` 序列化为 `null`：本地已是最新
/// - `Ok(Some(report))`：完成了一次新版本下载
#[tauri::command]
pub async fn mayhem_sync(force: Option<bool>) -> Result<Option<SyncReport>, String> {
    let _guard = SYNC_LOCK.lock().await;
    crate::mayhem::store::sync(force.unwrap_or(false)).await
}

/// 查询本地数据状态（纯磁盘读取，离线可用）。
#[tauri::command]
pub async fn mayhem_status() -> Result<MayhemStatus, String> {
    let ptr = crate::mayhem::store::read_pointer();
    let (version, synced_at) = match ptr {
        Some(p) => (Some(p.data_version.clone()), Some(p.synced_at)),
        None => (None, None),
    };
    let ready = version.is_some()
        && crate::mayhem::store::read_local_json("champions.json").is_ok()
        && crate::mayhem::store::read_local_json("augments.json").is_ok()
        && crate::mayhem::store::read_local_json("champion-shards/index.json").is_ok();
    Ok(MayhemStatus {
        active_version: version,
        synced_at,
        ready,
    })
}

/// 读取英雄榜（champions.json 原始 JSON，含 T 级/胜率/选取率/职业标签）。
#[tauri::command]
pub async fn mayhem_get_champions() -> Result<serde_json::Value, String> {
    crate::mayhem::store::read_local_json("champions.json")
}

/// 读取强化榜（augments.json 原始 JSON）。
#[tauri::command]
pub async fn mayhem_get_augments() -> Result<serde_json::Value, String> {
    crate::mayhem::store::read_local_json("augments.json")
}

/// 读取单个英雄的大乱斗详情（强化胜率列表/TOP 组合/出装/加点/召唤师技能）。
///
/// # 返回值
///
/// - `Ok(null)`: 未同步或该英雄无数据（调用方按无数据处理）
#[tauri::command]
pub async fn mayhem_get_champion_detail(
    champion_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    crate::mayhem::store::champion_detail(champion_id)
}
