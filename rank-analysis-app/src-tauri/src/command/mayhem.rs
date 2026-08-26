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

use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;
use crate::mayhem::client::SyncReport;
use crate::mayhem::db::{self, AugmentAgg, ChampionAgg, ImportReport};
use crate::mayhem::MAYHEM_QUEUE_ID;

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

// ---------------------------------------------------------------------------
// 个人自采（mayhem.db，数据不出设备）
// ---------------------------------------------------------------------------

/// 从本机 LCU 战绩导入最近的海克斯大乱斗对局。
///
/// 单次 LCU 请求（0..=49 场窗口）即可拿到完整摘要（含 playerAugment1..6），
/// 无需逐场拉详情；写入按 game_id 幂等。需要客户端在线。
#[tauri::command]
pub async fn mayhem_import_recent() -> Result<ImportReport, String> {
    let me = Summoner::get_my_summoner().await?;
    let history = MatchHistory::get_match_history_by_puuid(&me.puuid, 0, 49).await?;

    let mayhem_games: Vec<_> = history
        .games
        .games
        .iter()
        .filter(|g| g.queue_id == MAYHEM_QUEUE_ID)
        .collect();

    let mut report = ImportReport {
        scanned: mayhem_games.len() as i64,
        ..Default::default()
    };
    for g in &mayhem_games {
        match db::import_game(g, &me.puuid) {
            Some(Ok(true)) => report.imported += 1,
            Some(Ok(false)) => report.skipped_existing += 1,
            // 连接未就绪或写库失败：计入失败，继续处理其余对局
            _ => report.failed += 1,
        }
    }
    Ok(report)
}

/// 本人英雄维度聚合（games/wins/KDA 求和），按场次降序。
#[tauri::command]
pub async fn mayhem_personal_champion_stats() -> Result<Vec<ChampionAgg>, String> {
    Ok(db::personal_champion_stats())
}

/// 本人强化维度聚合；`champion_id` 提供时只统计该英雄的对局。
#[tauri::command]
pub async fn mayhem_personal_augment_stats(
    champion_id: Option<i32>,
) -> Result<Vec<AugmentAgg>, String> {
    Ok(db::personal_augment_stats(champion_id))
}

/// 版本变动日志（新 → 旧）；首次同步前为空表。
#[tauri::command]
pub async fn mayhem_version_changes() -> Result<Vec<crate::mayhem::store::VersionChange>, String> {
    Ok(crate::mayhem::store::version_changes())
}

// ---------------------------------------------------------------------------
// A3 局内三选一：探测 / OCR 匹配层
// ---------------------------------------------------------------------------

/// LCU 强化暴露度探测（A3.0）。
///
/// 在真实 2400 对局中调用：扫描候选端点 JSON 里键名含 "augment" 的路径。
/// 全部为空即维持 OCR 主路径；一旦出现可用状态字段，A3 可升级为事件订阅。
#[tauri::command]
pub async fn mayhem_probe_lcu() -> Result<Vec<crate::mayhem::probe::ProbeResult>, String> {
    Ok(crate::mayhem::probe::run_probe().await)
}

/// 当前本地数据构建的强化名词表（OCR 词表约束用）。
#[tauri::command]
pub async fn mayhem_ocr_lexicon(
) -> Result<Vec<crate::mayhem::ocr::LexiconEntry>, String> {
    let augments = crate::mayhem::store::read_local_json("augments.json")?;
    Ok(crate::mayhem::ocr::build_lexicon(&augments))
}

/// 用样例文本试跑词表匹配（调试用：验证归一化/容差手感，无需截屏）。
#[tauri::command]
pub async fn mayhem_ocr_match_sample(
    text: String,
    max_distance: Option<usize>,
) -> Result<Option<crate::mayhem::ocr::MatchHit>, String> {
    let lexicon = mayhem_ocr_lexicon().await?;
    Ok(crate::mayhem::ocr::match_text(&text, &lexicon, max_distance.unwrap_or(2)))
}
