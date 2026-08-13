//! # AI 结构化缓存（磁盘）
//!
//! D-P1：把 AI 复盘的结构化结果（Stage 1 归因 / Stage 2 草案）从 sessionStorage
//! 升级到磁盘。按 `gameId + patch` 分片并带时效：
//!
//! - **分片**：每个条目记录写入时的 patch（如 `25.6`）。前端取缓存时必须带上当前
//!   patch，patch 不一致的条目视为不可复用（跨版本脏缓存直接作废）。
//! - **时效**：条目 14 天过期；读取时发现过期/异 patch 条目顺手清除（惰性 GC）。
//! - **容量**：上限 400 条，超出按写入时间淘汰最旧。
//!
//! 落点在系统临时目录（[`crate::paths::cache_file`]）——纯缓存，丢了自动重建，
//! 不占配置目录、不碰写权限问题（与 opgg/cache.rs 同一约定）。
//!
//! 线程安全：命令可能并发到达（前端同一时刻可发起多次分析），读改写整段操作
//! 由模块级互斥锁串行化，防止两个写并发把对方的新条目覆盖丢。

use crate::paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 条目有效期：14 天（秒）。
const TTL_SECS: i64 = 14 * 24 * 60 * 60;

/// 容量上限：超出后按 `created_at` 淘汰最旧的。
const MAX_ENTRIES: usize = 400;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiCacheEntry {
    /// 缓存键（前端拼好：`ai_match_detail_stage1_{gameId}_{modeKind}_{model}` 等）。
    key: String,
    /// 写入时的版本分片（如 `25.6`）。读取方带不同 patch 时视为不可复用。
    patch: String,
    /// Unix 秒。
    created_at: i64,
    value: String,
}

/// 缓存文件绝对路径（临时目录 + 应用前缀，见 [`crate::paths`]）。
fn cache_path() -> PathBuf {
    paths::cache_file("ai_cache.json")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// 读取全部条目；文件缺失或损坏返回空（缓存问题绝不阻塞主流程）。
fn load_entries(path: &Path) -> Vec<AiCacheEntry> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("AI cache corrupt at {}: {}", path.display(), e);
            Vec::new()
        }
    }
}

/// 整表写回（父目录不存在则先创建）。
fn save_entries(path: &Path, entries: &[AiCacheEntry]) -> Result<(), String> {
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
        }
    }
    std::fs::write(path, json).map_err(|e| format!("write {}: {}", path.display(), e))
}

/// 互斥锁：读改写整段串行化，防止并发写互相覆盖。
static IO_LOCK: Mutex<()> = Mutex::new(());

/// 读取缓存条目（测试可注入路径；命令层用默认路径）。
fn get_inner(key: &str, patch: Option<&str>, path: &Path) -> Result<Option<String>, String> {
    let t = now();
    let entries = load_entries(path);
    let mut kept = Vec::with_capacity(entries.len());
    let mut hit: Option<String> = None;
    let mut changed = false;
    for e in entries {
        let expired = t - e.created_at >= TTL_SECS;
        let patch_stale = patch.is_some_and(|p| p != e.patch.as_str());
        if e.key == key && !expired && !patch_stale {
            hit = Some(e.value);
        }
        if expired || patch_stale {
            changed = true;
        } else {
            kept.push(e);
        }
    }
    if changed {
        save_entries(path, &kept)?;
    }
    Ok(hit)
}

/// 写入/更新缓存条目（测试可注入路径；命令层用默认路径）。
fn put_inner(key: &str, patch: &str, value: &str, path: &Path) -> Result<(), String> {
    let t = now();
    let mut entries = load_entries(path);
    // 惰性 GC：先清过期条目，再按容量淘汰最旧
    entries.retain(|e| t - e.created_at < TTL_SECS);
    if let Some(existing) = entries.iter_mut().find(|e| e.key == key) {
        existing.patch = patch.to_string();
        existing.created_at = t;
        existing.value = value.to_string();
    } else {
        entries.push(AiCacheEntry {
            key: key.to_string(),
            patch: patch.to_string(),
            created_at: t,
            value: value.to_string(),
        });
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.created_at));
    if entries.len() > MAX_ENTRIES {
        entries.truncate(MAX_ENTRIES);
    }
    save_entries(path, &entries)
}

/// 读取 AI 缓存条目。
///
/// # 参数
/// - `key`: 缓存键
/// - `patch`: 当前版本分片；`None` 时不做 patch 校验（仅 TTL）
///
/// # 返回值
/// - `Ok(Some(value))`: 命中
/// - `Ok(None)`: 未命中 / 已过期 / patch 不一致
/// - `Err(String)`: 写回清理时失败（缓存问题不阻塞，前端可回退 sessionStorage）
#[tauri::command]
pub async fn ai_cache_get(key: String, patch: Option<String>) -> Result<Option<String>, String> {
    let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    get_inner(&key, patch.as_deref(), &cache_path())
}

/// 写入 AI 缓存条目。
#[tauri::command]
pub async fn ai_cache_put(key: String, patch: String, value: String) -> Result<(), String> {
    let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    put_inner(&key, &patch, &value, &cache_path())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("ra_ai_cache_test_{}_{}", name, std::process::id()))
    }

    #[test]
    fn put_then_get_round_trips() {
        let path = test_path("roundtrip");
        let _ = std::fs::remove_file(&path);

        put_inner("k1", "25.6", "v1", &path).unwrap();
        assert_eq!(get_inner("k1", Some("25.6"), &path).unwrap(), Some("v1".to_string()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_serves_patch_independent_value_when_patch_not_required() {
        let path = test_path("nopatch");
        let _ = std::fs::remove_file(&path);

        put_inner("k1", "25.6", "v1", &path).unwrap();
        assert_eq!(get_inner("k1", None, &path).unwrap(), Some("v1".to_string()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn patch_shard_mismatch_is_a_miss_and_entry_is_removed() {
        let path = test_path("shard");
        let _ = std::fs::remove_file(&path);

        put_inner("k1", "25.6", "v1", &path).unwrap();
        assert_eq!(get_inner("k1", Some("25.7"), &path).unwrap(), None);
        // 异 patch 条目已被惰性清除，下一次读取文件里已无此键
        assert_eq!(get_inner("k1", Some("25.6"), &path).unwrap(), None);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn put_updates_existing_key_and_bumps_created_at() {
        let path = test_path("update");
        let _ = std::fs::remove_file(&path);

        put_inner("k1", "25.6", "v1", &path).unwrap();
        put_inner("k1", "25.6", "v2", &path).unwrap();
        assert_eq!(get_inner("k1", Some("25.6"), &path).unwrap(), Some("v2".to_string()));
        let entries = load_entries(&path);
        assert_eq!(entries.len(), 1);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn expired_entries_are_dropped_on_get_and_put() {
        let path = test_path("ttl");
        let _ = std::fs::remove_file(&path);

        let t = now() - TTL_SECS - 1;
        save_entries(
            &path,
            &[AiCacheEntry {
                key: "old".into(),
                patch: "25.6".into(),
                created_at: t,
                value: "stale".into(),
            }],
        )
        .unwrap();
        assert_eq!(get_inner("old", Some("25.6"), &path).unwrap(), None);
        assert!(load_entries(&path).is_empty(), "过期条目读取后应被清除");

        // put 侧同样清理过期条目
        save_entries(
            &path,
            &[AiCacheEntry {
                key: "old".into(),
                patch: "25.6".into(),
                created_at: t,
                value: "stale".into(),
            }],
        )
        .unwrap();
        put_inner("fresh", "25.6", "v", &path).unwrap();
        let entries = load_entries(&path);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "fresh");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn capacity_is_capped_dropping_oldest() {
        let path = test_path("cap");
        let _ = std::fs::remove_file(&path);

        // 超过上限一截：只保留 MAX_ENTRIES 条，且最旧的被淘汰
        for i in 0..(MAX_ENTRIES + 10) {
            put_inner(&format!("k{}", i), "25.6", "v", &path).unwrap();
        }
        let entries = load_entries(&path);
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert!(
            entries.iter().all(|e| e.key != "k0"),
            "最旧的 k0 应被容量淘汰"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_or_corrupt_file_yields_empty_cache() {
        let missing = test_path("missing");
        let _ = std::fs::remove_file(&missing);
        assert_eq!(get_inner("k", Some("25.6"), &missing).unwrap(), None);

        let corrupt = test_path("corrupt");
        std::fs::write(&corrupt, "not json").unwrap();
        assert_eq!(get_inner("k", Some("25.6"), &corrupt).unwrap(), None);

        let _ = std::fs::remove_file(&corrupt);
    }
}
