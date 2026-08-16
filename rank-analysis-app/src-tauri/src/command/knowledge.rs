//! 知识库命令层：拉取 / 读取 / 状态查询。
//!
//! 与 `fandom.rs` / `opgg.rs` 命令层同构：数据层在 [`crate::knowledge`]，
//! 这里只做透传与状态包装。

use crate::knowledge::{self, KnowledgeBase};
use tauri::State;

/// 知识库状态（供设置页「战术情报」区展示版本与新鲜度）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeStatus {
    pub patch: String,
    pub updated_at: String,
    /// remote = 网络拉取新鲜 / cache = 缓存续命 / fallback = 内置兜底
    pub source: &'static str,
    pub stale: bool,
}

fn build_status(data: Option<&KnowledgeBase>) -> KnowledgeStatus {
    match data {
        None => KnowledgeStatus {
            patch: String::new(),
            updated_at: String::new(),
            source: "fallback",
            stale: true,
        },
        Some(k) => KnowledgeStatus {
            patch: k.patch.clone(),
            updated_at: k.updated_at.clone(),
            source: "remote",
            stale: false,
        },
    }
}

/// 强制刷新知识库（启动时 + 设置页手动刷新触发）
#[tauri::command]
pub async fn update_knowledge(_state: State<'_, crate::AppState>) -> Result<String, String> {
    let snap = knowledge::force_refresh().await;
    match snap.data.as_ref() {
        Some(k) => Ok(format!("patch={} rules={}", k.patch, k.signal_rules.len())),
        None => Err("知识库拉取失败且无可用数据".to_string()),
    }
}

/// 读取知识库（含内置兜底，通常不会返回 None）
#[tauri::command]
pub async fn get_knowledge(
    _state: State<'_, crate::AppState>,
) -> Result<Option<KnowledgeBase>, String> {
    let snap = knowledge::get_or_fetch().await;
    Ok(snap.data.clone())
}

/// 知识库状态：版本 / 更新时间 / 数据来源（远程 or 兜底）
#[tauri::command]
pub async fn get_knowledge_status(
    _state: State<'_, crate::AppState>,
) -> Result<KnowledgeStatus, String> {
    let snap = knowledge::get_or_fetch().await;
    Ok(build_status(snap.data.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_for_missing_data_should_be_stale_fallback() {
        let status = build_status(None);
        assert_eq!(status.source, "fallback");
        assert!(status.stale);
        assert!(status.patch.is_empty());
    }
}
