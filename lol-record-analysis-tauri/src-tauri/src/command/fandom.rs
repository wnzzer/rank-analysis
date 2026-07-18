//! # Fandom 命令模块
//!
//! 与 Fandom 外部数据对接：更新大乱斗平衡数据、按英雄 ID 查询平衡信息。
//!
//! ## 主要功能
//!
//! - **数据更新**: 从 Fandom 拉取最新的大乱斗平衡数据
//! - **数据查询**: 根据英雄 ID 查询平衡数据
//! - **缓存管理**: 使用应用状态的缓存存储平衡数据
//!
//! ## 大乱斗平衡数据
//!
//! 包含以下信息：
//! - 伤害调整（造成/受到）
//! - 治疗调整
//! - 护盾调整
//! - 其他特殊调整
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 更新数据
//! let result = update_fandom_data(state).await?;
//!
//! // 查询特定英雄的平衡数据
//! let balance = get_aram_balance(91, state).await?; // 91 = 卡特琳娜
//! ```

use crate::fandom::api::fetch_aram_balance_data;
use crate::fandom::data::AramBalanceData;
use crate::state::AppState;
use tauri::State;

/// 从 Fandom 拉取大乱斗平衡数据并写入应用缓存。
///
/// # 参数
///
/// - `state`: Tauri 应用状态，包含 Fandom 数据缓存
///
/// # 返回值
///
/// - `Ok(String)`: 更新成功消息
/// - `Err(String)`: 更新失败时的错误信息
///
/// # 缓存策略
///
/// 数据会被写入 `AppState.fandom_cache`，该缓存有 2 小时的 TTL。
#[tauri::command]
pub async fn update_fandom_data(state: State<'_, AppState>) -> Result<String, String> {
    match fetch_aram_balance_data().await {
        Ok(data) => {
            for (id, balance) in data {
                state.fandom_cache.insert(id, balance).await;
            }
            Ok("Fandom data updated successfully".to_string())
        }
        Err(e) => Err(format!("Failed to update fandom data: {}", e)),
    }
}

/// 根据英雄 ID 从缓存获取大乱斗平衡数据。
///
/// # 参数
///
/// - `id`: 英雄 ID
/// - `state`: Tauri 应用状态，包含 Fandom 数据缓存
///
/// # 返回值
///
/// - `Ok(Some(AramBalanceData))`: 找到平衡数据
/// - `Ok(None)`: 该英雄无平衡调整
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 使用建议
///
/// 如果返回 `None`，表示该英雄在大乱斗中没有特殊平衡调整（伤害/治疗等均为默认值）。
#[tauri::command]
pub async fn get_aram_balance(
    id: i32,
    state: State<'_, AppState>,
) -> Result<Option<AramBalanceData>, String> {
    Ok(state.fandom_cache.get(&id).await)
}

/// 查询英雄在指定版本的官方补丁改动（LoL Wiki `V{patch}` 页解析）。
///
/// # 参数
///
/// - `champion_id`: 英雄 ID（经 LCU 英雄缓存映射为英文 alias 再匹配 wiki 名）
/// - `patch`: 版本号（如 "16.14"，前端从 OP.GG 状态取）
///
/// # 返回值
///
/// - `Ok(Some(ChampionPatchNote))`: 该英雄本版本有改动（方向 + 英文条目）
/// - `Ok(None)`: 本版本无改动，或英雄缓存尚未就绪（未连接客户端时）
///
/// # 数据源优先级
///
/// 1. 国服公告中文明细（CI 管线产出的静态 JSON，21 天新鲜度守卫）
/// 2. LoL Wiki `V{patch}` 英文条目（原有逻辑，作为降级层）
///
/// # 缓存策略
///
/// 快照按 patch 三级缓存（内存/磁盘/网络，TTL 24h），网络失败降级空快照，
/// 不会因 wiki 不可达阻塞选人页。
#[tauri::command]
pub async fn get_champion_patch_note(
    champion_id: i64,
    patch: String,
) -> Result<Option<crate::fandom::patch_notes::ChampionPatchNote>, String> {
    use crate::fandom::patch_notes;

    // 国服中文源优先：CI 管线产出的数据自带 championId，直接按 id 命中；
    // 快照过期（>21 天，跨版本）或未命中该英雄时降级 Wiki 英文源
    let cn = crate::cn_patch_notes::get_or_fetch().await;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if let Some(data) = cn
        .data
        .as_ref()
        .filter(|d| crate::cn_patch_notes::is_fresh(d, now))
    {
        if let Some(note) = crate::cn_patch_notes::note_for(data, champion_id) {
            return Ok(Some(note));
        }
    }

    // patch 号仅 Wiki 路径需要；空串（OP.GG 不可达时前端传入）直接视为无兜底数据，
    // 避免用空版本号去拉 wiki 的 "V" 页
    if patch.is_empty() {
        return Ok(None);
    }

    // 英雄 ID → LCU 英文 alias（如 91 → "Talon"）；缓存未就绪时静默返回 None
    let alias = {
        let cache = crate::lcu::api::asset::CHAMPION_CACHE
            .read()
            .map_err(|e| e.to_string())?;
        match cache.get(&champion_id) {
            Some(c) => c.alias.clone(),
            None => return Ok(None),
        }
    };
    let alias_key = patch_notes::normalize_champion_name(&alias);
    let snapshot = patch_notes::get_or_fetch(&patch).await;
    let hit = snapshot
        .champions
        .iter()
        .find(|(wiki_key, _)| patch_notes::wiki_name_to_alias_key(wiki_key) == alias_key)
        .map(|(_, note)| note.clone());
    Ok(hit)
}
