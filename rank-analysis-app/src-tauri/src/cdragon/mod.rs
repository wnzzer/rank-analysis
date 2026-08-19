//! # CDragon 静态资产模块（M4 数据地基）
//!
//! 从 CommunityDragon 下载英雄/物品/符文/召唤师技能图标，本地磁盘缓存。
//! 降级链：内存缓存 → 磁盘缓存 → CDragon HTTP。
//!
//! ## 数据源
//!
//! - CDragon base: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default`
//! - 图标路径格式: `v1/{type}-icons/{id}.png`
//!
//! ## 缓存策略
//!
//! - 磁盘缓存目录: `{cache_dir}/cdragon-assets/`（跨启动持久化）
//! - 内存缓存: moka Cache（无界，生存期=进程生命周期）
//! - 类型: champion, item, spell, perk

use std::path::PathBuf;
use std::sync::LazyLock;

use moka::future::Cache;
use reqwest::Client;

const CDRAGON_BASE: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

/// 磁盘缓存目录（懒初始化，首次 fetch 时确定）。
static DISK_CACHE_DIR: LazyLock<std::sync::Mutex<Option<PathBuf>>> =
    LazyLock::new(|| std::sync::Mutex::new(None));

/// 内存缓存：键为 `{type}/{id}`，值为 PNG 字节。
static MEMORY_CACHE: LazyLock<Cache<String, Vec<u8>>> =
    LazyLock::new(|| Cache::builder().max_capacity(10_000).build());

/// 确保磁盘缓存目录存在并返回路径。
fn disk_cache_dir() -> PathBuf {
    let mut lock = DISK_CACHE_DIR.lock().unwrap();
    if let Some(ref dir) = *lock {
        return dir.clone();
    }
    let dir = std::env::temp_dir().join("rank-analysis-cache-cdragon");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("cdragon: 无法创建磁盘缓存目录 {:?}: {}", dir, e);
    }
    *lock = Some(dir.clone());
    dir
}

/// 构建 CDragon 图标 URL。
fn icon_url(kind: &str, id: i64) -> String {
    format!("{CDRAGON_BASE}/v1/{kind}-icons/{id}.png")
}

/// 构建内存缓存键。
fn cache_key(kind: &str, id: i64) -> String {
    format!("{kind}/{id}")
}

/// 构建磁盘缓存文件路径。
fn disk_cache_path(kind: &str, id: i64) -> PathBuf {
    disk_cache_dir().join(format!("{kind}_{id}.png"))
}

/// 从 CDragon 获取图标二进制数据。
///
/// 降级链：内存缓存 → 磁盘缓存 → CDragon HTTP → 磁盘缓存 + 内存缓存。
///
/// # 参数
/// - `kind`: 图标类型（"champion" / "item" / "spell" / "perk"）
/// - `id`: 图标 ID
pub async fn fetch_icon(kind: &str, id: i64) -> Result<Vec<u8>, String> {
    let key = cache_key(kind, id);

    // 1. 内存缓存
    if let Some(hit) = MEMORY_CACHE.get(&key).await {
        return Ok(hit);
    }

    // 2. 磁盘缓存
    let disk_path = disk_cache_path(kind, id);
    if disk_path.exists() {
        if let Ok(bytes) = std::fs::read(&disk_path) {
            if !bytes.is_empty() {
                MEMORY_CACHE.insert(key, bytes.clone()).await;
                return Ok(bytes);
            }
        }
    }

    // 3. CDragon HTTP
    let url = icon_url(kind, id);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("cdragon: 创建 HTTP 客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("cdragon: 请求 {url} 失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("cdragon: HTTP {} for {url}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("cdragon: 读取响应失败: {e}"))?
        .to_vec();

    if bytes.is_empty() {
        return Err(format!("cdragon: 空响应 for {url}"));
    }

    // 写入磁盘缓存
    if let Err(e) = std::fs::write(&disk_path, &bytes) {
        log::warn!("cdragon: 磁盘缓存写入失败 {:?}: {}", disk_path, e);
    }

    // 写入内存缓存
    MEMORY_CACHE.insert(key, bytes.clone()).await;

    Ok(bytes)
}

/// 从 CDragon 获取图标并返回 (bytes, mime_type)。
///
/// 与 `lcu::api::asset::get_asset_binary` 返回格式一致，
/// 可作为 LCU 不可用时的降级数据源。
pub async fn fetch_icon_with_mime(kind: &str, id: i64) -> Result<(Vec<u8>, String), String> {
    let bytes = fetch_icon(kind, id).await?;
    Ok((bytes, "image/png".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_build_correct_icon_url() {
        let url = icon_url("champion", 1);
        assert!(url.contains("champion-icons"));
        assert!(url.contains("/1.png"));
        assert!(url.contains(CDRAGON_BASE));
    }

    #[test]
    fn should_build_correct_cache_key() {
        assert_eq!(cache_key("champion", 1), "champion/1");
        assert_eq!(cache_key("item", 3031), "item/3031");
    }

    #[test]
    fn should_build_correct_disk_cache_path() {
        let path = disk_cache_path("champion", 1);
        assert!(path.to_string_lossy().contains("champion_1.png"));
    }
}
