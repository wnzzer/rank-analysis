//! # Mayhem 数据磁盘存储层
//!
//! 目录布局（位于系统临时目录，见 [`crate::paths::cache_dir`]）：
//!
//! ```text
//! {temp}/rank-analysis-mayhem/
//! ├── pointer.json                 // 当前激活版本指针（原子写）
//! └── versions/
//!     └── {dataVersion}/           // 版本目录，校验通过后不可变
//!         ├── augments.json
//!         ├── champions.json
//!         ├── items.json
//!         └── champion-shards/{index,0..N}.json
//! ```
//!
//! 激活流程（[`sync`]）：下载到 `versions/{v}.staging/` → 全量校验 → 重命名为正式目录
//! → 原子覆盖 pointer.json → 清理其它旧版本。任一步失败均不影响当前激活版本。
//!
//! 可测试性：所有磁盘操作都提供 `_in(root, …)` 注入根目录的变体，公开函数委托到
//! 全局根目录版本——单测在独立临时目录里跑真实文件系统，不碰全局状态。

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::client::{fetch_manifest, fetch_remote_config, is_safe_rel_path, SyncReport};

/// 指针文件内容：当前激活的数据版本。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivePointer {
    pub data_version: String,
    /// 激活时刻的 Unix 秒。
    pub synced_at: i64,
}

/// mayhem 数据根目录（全局）。
pub fn root_dir() -> PathBuf {
    crate::paths::cache_dir("mayhem")
}

/// 当前 Unix 秒（系统时钟异常时回退 0，仅影响展示）。
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 指针读写（_in 变体供测试注入根目录）
// ---------------------------------------------------------------------------

/// 从指定根目录读取激活指针；缺失或损坏返回 None。
pub fn read_pointer_in(root: &Path) -> Option<ActivePointer> {
    let content = std::fs::read_to_string(root.join("pointer.json")).ok()?;
    match serde_json::from_str(&content) {
        Ok(p) => Some(p),
        Err(e) => {
            log::warn!("mayhem pointer corrupt: {}", e);
            None
        }
    }
}

/// 原子写指针到指定根目录：先写 `.tmp` 再 rename 覆盖，中断不留半截 JSON。
pub fn write_pointer_atomic_in(root: &Path, pointer: &ActivePointer) -> Result<(), String> {
    crate::paths::ensure_parent_dir(root).map_err(|e| e.to_string())?;
    let path = root.join("pointer.json");
    let tmp = root.join("pointer.json.tmp");
    let json = serde_json::to_string(pointer).map_err(|e| e.to_string())?;
    // File::create + write_all + rename：rename 在同一卷内是原子的
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 读取全局激活指针。
pub fn read_pointer() -> Option<ActivePointer> {
    read_pointer_in(&root_dir())
}

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

/// 删除指定根目录下除 `keep` 外的全部版本/staging 目录。
///
/// 简化策略：只保留当前版本——数据随时可重新拉取，不为回滚保留磁盘。
pub fn cleanup_other_versions_in(root: &Path, keep: &str) {
    let versions = root.join("versions");
    let Ok(entries) = std::fs::read_dir(&versions) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name == keep {
            continue;
        }
        if let Err(e) = std::fs::remove_dir_all(entry.path()) {
            log::warn!("mayhem cleanup {} failed: {}", entry.path().display(), e);
        }
    }
}

// ---------------------------------------------------------------------------
// 本地读取
// ---------------------------------------------------------------------------

/// 校验相对路径后从指定根目录的**激活版本**读取 JSON 文件。
///
/// 错误语义：
/// - 未同步 / 无指针 → `"mayhem data not synced yet"`
/// - 路径非法 → `"unsafe rel path"`（在读盘之前拒绝）
pub fn read_local_json_in(root: &Path, rel_path: &str) -> Result<serde_json::Value, String> {
    let Some(ptr) = read_pointer_in(root) else {
        return Err("mayhem data not synced yet".to_string());
    };
    if !is_safe_rel_path(rel_path) {
        return Err(format!("unsafe rel path: {}", rel_path));
    }
    let path = root.join("versions").join(&ptr.data_version).join(rel_path);
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    serde_json::from_str(&content).map_err(|e| format!("parse {}: {}", rel_path, e))
}

/// 全局根目录版 [`read_local_json_in`]。
pub fn read_local_json(rel_path: &str) -> Result<serde_json::Value, String> {
    read_local_json_in(&root_dir(), rel_path)
}

/// 从 champion-shards 里定位单个英雄详情（指定根目录变体）。
///
/// 流程：读 `champion-shards/index.json` → 找包含该英雄的分片 → 读分片 → 取
/// `champions.{id}`。索引缺失或英雄不存在返回 `Ok(None)`（调用方按无数据处理）。
pub fn champion_detail_in(
    root: &Path,
    champion_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    let index: serde_json::Value = match read_local_json_in(root, "champion-shards/index.json") {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let Some(shards) = index["shards"].as_array() else {
        return Ok(None);
    };
    for shard in shards {
        let contains_id = shard["championIds"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|v| v.as_i64() == Some(champion_id)));
        if !contains_id {
            continue;
        }
        let Some(path) = shard["path"].as_str() else {
            continue;
        };
        let shard_json = read_local_json_in(root, path)?;
        return Ok(shard_json["champions"][&champion_id.to_string()].clone());
    }
    Ok(None)
}

/// 全局根目录版 [`champion_detail_in`]。
pub fn champion_detail(champion_id: i64) -> Result<Option<serde_json::Value>, String> {
    champion_detail_in(&root_dir(), champion_id)
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

/// 执行一次远端同步：版本一致时跳过（除非 force），否则全量下载、校验并原子激活。
///
/// 并发安全：调用方（command 层）持有互斥锁，本函数内部不再加锁。
///
/// # 返回值
///
/// - `Ok(None)`：本地已是最新版本，无事发生
/// - `Ok(Some(report))`：完成了新版本下载与激活
pub async fn sync(force: bool) -> Result<Option<SyncReport>, String> {
    let config = fetch_remote_config().await?;
    if config.data_version.is_empty() || config.manifest.is_empty() {
        return Err("remote config missing dataVersion/manifest".to_string());
    }

    if !force {
        if let Some(ptr) = read_pointer() {
            if ptr.data_version == config.data_version {
                return Ok(None);
            }
        }
    }

    let manifest = fetch_manifest(&config.manifest).await?;
    if !manifest.data_version.is_empty() && manifest.data_version != config.data_version {
        return Err(format!(
            "manifest version {} != config version {}",
            manifest.data_version, config.data_version
        ));
    }

    let root = root_dir();
    let from_version = read_pointer_in(&root).map(|p| p.data_version);
    let staging = root.join("versions").join(format!("{}.staging", config.data_version));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }

    let mut total_files = 0usize;
    let mut total_bytes = 0u64;
    for file in &manifest.files {
        if !is_safe_rel_path(&file.path) {
            return Err(format!("unsafe path in manifest: {}", file.path));
        }
        let dest = staging.join(&file.path);
        let url = if file.url.is_empty() {
            super::client::join_origin(&format!(
                "/api/client/v1/data/{}/{}",
                config.data_version, file.path
            ))
        } else {
            super::client::join_origin(&file.url)
        };
        total_bytes += super::client::download_verified(&url, file.hash.as_deref(), &dest).await?;
        total_files += 1;
    }

    // 校验全部通过后才落正式目录；目标已存在（上次中断残留）先移除
    let final_dir = root.join("versions").join(&config.data_version);
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&staging, &final_dir)
        .map_err(|e| format!("activate {}: {}", config.data_version, e))?;

    write_pointer_atomic_in(
        &root,
        &ActivePointer {
            data_version: config.data_version.clone(),
            synced_at: now_secs(),
        },
    )?;

    cleanup_other_versions_in(&root, &config.data_version);

    Ok(Some(SyncReport {
        from_version,
        to_version: config.data_version,
        files: total_files,
        bytes: total_bytes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 独立临时根目录（按测试名隔离，结束时不清理以便失败排查由系统回收）。
    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ra-mayhem-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn write_version(root: &Path, version: &str, rel: &str, content: &str) {
        let path = root.join("versions").join(version).join(rel);
        crate::paths::ensure_parent_dir(&path).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn pointer_should_roundtrip_via_atomic_write() {
        let root = temp_root("ptr");
        assert!(read_pointer_in(&root).is_none());

        let original = ActivePointer { data_version: "16.16.3".into(), synced_at: 1_756_000_000 };
        write_pointer_atomic_in(&root, &original).unwrap();

        // 原子写不应遗留 .tmp 文件
        assert!(!root.join("pointer.json.tmp").exists());
        assert_eq!(read_pointer_in(&root), Some(original));
    }

    #[test]
    fn corrupted_pointer_should_be_swallowed_as_none() {
        let root = temp_root("corrupt");
        crate::paths::ensure_parent_dir(&root).unwrap();
        std::fs::write(root.join("pointer.json"), "{broken").unwrap();
        assert!(read_pointer_in(&root).is_none());

        // 空 JSON 对象缺字段同样视为损坏
        std::fs::write(root.join("pointer.json"), "{}").unwrap();
        assert!(read_pointer_in(&root).is_none());
    }

    #[test]
    fn cleanup_should_remove_everything_except_keep() {
        let root = temp_root("cleanup");
        write_version(&root, "16.15.1", "champions.json", "{}");
        write_version(&root, "16.16.2", "champions.json", "{}");
        write_version(&root, "16.16.3", "champions.json", "{}");
        // 遗留 staging 目录也应被清理
        let staging = root.join("versions").join("16.17.0.staging");
        crate::paths::ensure_parent_dir(&staging).unwrap();
        std::fs::write(staging.join("x"), "1").unwrap();

        cleanup_other_versions_in(&root, "16.16.3");

        let versions = root.join("versions");
        let remaining: Vec<_> = std::fs::read_dir(&versions)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_str().unwrap().to_owned())
            .collect();
        assert_eq!(remaining, vec!["16.16.3".to_string()]);
    }

    #[test]
    fn unsafe_rel_path_must_be_rejected_before_disk_io() {
        let root = temp_root("unsafe");
        // 根本没有指针（未同步）——路径校验仍应先于其它错误触发
        let err = read_local_json_in(&root, "../escape.json").unwrap_err();
        assert!(err.contains("unsafe"), "got: {}", err);
        assert!(!root.join("escape.json").exists());
    }

    #[test]
    fn unsynced_root_reports_friendly_error() {
        let root = temp_root("unsynced");
        let err = read_local_json_in(&root, "champions.json").unwrap_err();
        assert!(err.contains("not synced"), "got: {}", err);
    }

    #[test]
    fn champion_detail_should_locate_across_shard_index() {
        let root = temp_root("detail");
        write_version(
            &root,
            "16.16.3",
            "champion-shards/index.json",
            r#"{"dataVersion":"16.16.3","shardSize":2,"shards":[
                {"id":0,"championIds":[1,2],"path":"champion-shards/0.json"},
                {"id":1,"championIds":[67,104],"path":"champion-shards/1.json"}]}"#,
        );
        write_version(
            &root,
            "16.16.3",
            "champion-shards/1.json",
            r#"{"dataVersion":"16.16.3","shardId":1,"champions":{
                "67":{"champion":{"alias":"Vayne"},"augments":[1,2,3]}}}"#,
        );
        write_pointer_atomic_in(
            &root,
            &ActivePointer { data_version: "16.16.3".into(), synced_at: 0 },
        )
        .unwrap();

        // 命中第二个分片里的 67 号
        let detail = champion_detail_in(&root, 67).unwrap().expect("should find vayne");
        assert_eq!(detail["champion"]["alias"], "Vayne");
        // 索引存在但没有该英雄 → None
        assert!(champion_detail_in(&root, 999).unwrap().is_none());
    }

    #[test]
    fn champion_detail_should_tolerate_missing_index() {
        let root = temp_root("noindex");
        write_pointer_atomic_in(
            &root,
            &ActivePointer { data_version: "16.16.3".into(), synced_at: 0 },
        )
        .unwrap();
        assert!(champion_detail_in(&root, 67).unwrap().is_none());
    }
}
