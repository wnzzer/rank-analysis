//! OP.GG 快照磁盘缓存。
//!
//! 按模式一个 JSON 文件（`opgg_cache_ranked.json` / `opgg_cache_aram.json`），
//! 工作目录相对路径——与 `config.yaml` 相同的存储约定。
//! 一个 patch 内数据基本不变，TTL 取 12 小时。

use crate::opgg::data::OpggSnapshot;
use std::path::{Path, PathBuf};

/// 快照有效期：12 小时（秒）。
pub const TTL_SECS: i64 = 12 * 60 * 60;

/// 快照是否仍新鲜（`now - fetched_at < TTL_SECS`）。
pub fn is_fresh(snapshot: &OpggSnapshot, now: i64) -> bool {
    now - snapshot.fetched_at < TTL_SECS
}

/// 某模式的默认缓存文件路径（工作目录相对）。
pub fn default_path(mode: &str) -> PathBuf {
    PathBuf::from(format!("opgg_cache_{}.json", mode))
}

/// 序列化快照写入指定路径。
pub fn save_to_path(snapshot: &OpggSnapshot, path: &Path) -> Result<(), String> {
    let json = serde_json::to_string(snapshot).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write {}: {}", path.display(), e))
}

/// 从指定路径读取快照；文件缺失或损坏返回 None（缓存问题不阻塞主流程）。
pub fn load_from_path(path: &Path) -> Option<OpggSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&content) {
        Ok(snap) => Some(snap),
        Err(e) => {
            log::warn!("OP.GG cache corrupt at {}: {}", path.display(), e);
            None
        }
    }
}

/// 写入默认路径。
pub fn save(snapshot: &OpggSnapshot) -> Result<(), String> {
    save_to_path(snapshot, &default_path(&snapshot.mode))
}

/// 从默认路径读取。
pub fn load(mode: &str) -> Option<OpggSnapshot> {
    load_from_path(&default_path(mode))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opgg::data::OpggSnapshot;
    use std::collections::HashMap;

    fn snap(fetched_at: i64) -> OpggSnapshot {
        OpggSnapshot {
            mode: "ranked".into(),
            patch: "16.13".into(),
            fetched_at,
            champions: HashMap::new(),
            counters: HashMap::new(),
        }
    }

    #[test]
    fn should_round_trip_snapshot_via_disk() {
        let path = std::env::temp_dir().join("opgg_cache_test_roundtrip.json");
        let original = snap(1_752_000_000);
        save_to_path(&original, &path).unwrap();
        let loaded = load_from_path(&path).expect("should load");
        assert_eq!(loaded.patch, "16.13");
        assert_eq!(loaded.fetched_at, 1_752_000_000);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn should_return_none_for_missing_or_corrupt_file() {
        let missing = std::env::temp_dir().join("opgg_cache_test_missing.json");
        let _ = std::fs::remove_file(&missing);
        assert!(load_from_path(&missing).is_none());

        let corrupt = std::env::temp_dir().join("opgg_cache_test_corrupt.json");
        std::fs::write(&corrupt, "not json").unwrap();
        assert!(load_from_path(&corrupt).is_none());
        let _ = std::fs::remove_file(&corrupt);
    }

    #[test]
    fn should_judge_freshness_by_ttl() {
        let now = 1_752_000_000;
        assert!(is_fresh(&snap(now - TTL_SECS + 1), now));
        assert!(!is_fresh(&snap(now - TTL_SECS), now));
        assert!(!is_fresh(&snap(now - TTL_SECS - 1), now));
    }

    #[test]
    fn default_path_should_be_mode_scoped_relative_file() {
        assert_eq!(
            default_path("ranked").to_str().unwrap(),
            "opgg_cache_ranked.json"
        );
        assert_eq!(
            default_path("aram").to_str().unwrap(),
            "opgg_cache_aram.json"
        );
    }
}
