//! # CDragon 静态资产模块（M4 数据地基）
//!
//! 从 CommunityDragon 下载英雄/物品/符文/召唤师技能图标，本地磁盘缓存。
//! 降级链：内存缓存 → 磁盘缓存 → CDragon HTTP。
//!
//! ## 数据源
//!
//! - CDragon base: `https://raw.communitydragon.org/{CDRAGON_PATCH}/plugins/rcp-be-lol-game-data/global/default`
//! - 图标路径格式: `v1/{type}-icons/{id}.png`（profile 为 `.jpg`，CDragon 真实路径）
//!
//! ## 缓存策略
//!
//! - 磁盘缓存目录: `{temp}/rank-analysis-cache-cdragon/{CDRAGON_PATCH}/`（跨启动持久化，
//!   带 patch 段隔离——升级版本时旧缓存不污染新数据，首访自动回源）
//! - 内存缓存: moka Cache（无界，生存期=进程生命周期）
//! - 类型: champion, item, spell, perk, profile
//! - `prefetch_icons` 批量预下载：启动预热常见图标（英雄/符文/召唤师技能），
//!   保证客户端离线时战绩/选人界面图标仍可渲染（M4 验收：断网可用）。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::LazyLock;

use moka::future::Cache;
use reqwest::Client;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// CDragon 当前版本段（`latest` 自动跟随最新正式版本；需钉住某 patch 时改为如 `25.16`）。
/// 升级 patch 只改这一处——URL 与磁盘缓存目录同时生效。
pub const CDRAGON_PATCH: &str = "latest";

const CDRAGON_HOST: &str = "https://raw.communitydragon.org";
const CDRAGON_PLUGIN_PATH: &str = "plugins/rcp-be-lol-game-data/global/default";

/// 批量预下载的并发度（HTTP 连接数）。
const PREFETCH_CONCURRENCY: usize = 8;

/// 预下载熔断阈值：连续失败达到该次数即中止剩余请求（CDragon 网络不可达时，
/// 避免 170+ 个请求排队超时——8 并发 × 10s 超时 ≈ 3.5 分钟的后台风暴）。
const PREFETCH_FAIL_ABORT_THRESHOLD: usize = 5;

/// 磁盘缓存目录（懒初始化，首次 fetch 时确定）。
static DISK_CACHE_DIR: LazyLock<std::sync::Mutex<Option<PathBuf>>> =
    LazyLock::new(|| std::sync::Mutex::new(None));

/// 内存缓存：键为 `{type}/{id}`，值为 PNG 字节。
static MEMORY_CACHE: LazyLock<Cache<String, Vec<u8>>> =
    LazyLock::new(|| Cache::builder().max_capacity(10_000).build());

/// 失败负缓存：请求失败的图标短期标记为不可用。
///
/// 国内网络访问 CDragon 通常整体不可达，若不加负缓存，每次头像请求
/// 都会等满 HTTP 超时（3s）才返回失败——10 人对局反复请求会持续卡顿。
/// 失败一次后 60s 内直接快速失败，前端立刻落到 fallback 占位图。
static FAILED_CACHE: LazyLock<Cache<String, ()>> = LazyLock::new(|| {
    Cache::builder()
        .time_to_live(std::time::Duration::from_secs(60))
        .max_capacity(10_000)
        .build()
});

/// 共享 HTTP 客户端（连接池复用，避免每次请求重建）。
/// 超时 3s：CDragon 只是降级兜底，不值得长等；连通场景下小图标 3s 足够。
static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .expect("cdragon: HTTP 客户端构建失败")
});

/// 构建 CDragon 数据根 URL（含版本段）。
fn cdn_base() -> String {
    format!("{CDRAGON_HOST}/{CDRAGON_PATCH}/{CDRAGON_PLUGIN_PATH}")
}

/// 确保磁盘缓存目录存在并返回路径（带版本段隔离）。
fn disk_cache_dir() -> PathBuf {
    let mut lock = DISK_CACHE_DIR.lock().unwrap();
    if let Some(ref dir) = *lock {
        return dir.clone();
    }
    let dir = std::env::temp_dir()
        .join("rank-analysis-cache-cdragon")
        .join(CDRAGON_PATCH);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("cdragon: 无法创建磁盘缓存目录 {:?}: {}", dir, e);
    }
    *lock = Some(dir.clone());
    dir
}

/// 构建 CDragon 图标 URL。
///
/// profile 类型真实路径为 `.jpg`，其余为 `.png`（LCU 的 profile 接口同样是 jpg）。
fn icon_url(kind: &str, id: i64) -> String {
    let ext = if kind == "profile" { "jpg" } else { "png" };
    format!("{}/v1/{kind}-icons/{id}.{ext}", cdn_base())
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

    // 0. 失败负缓存：近期失败过的不再重试，快速失败
    if FAILED_CACHE.get(&key).await.is_some() {
        return Err(format!("cdragon: {key} 近期失败过，跳过重试"));
    }

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
    let response = match HTTP_CLIENT.get(&url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            FAILED_CACHE.insert(key.clone(), ()).await;
            return Err(format!("cdragon: 请求 {url} 失败: {e}"));
        }
    };

    if !response.status().is_success() {
        FAILED_CACHE.insert(key.clone(), ()).await;
        return Err(format!("cdragon: HTTP {} for {url}", response.status()));
    }

    let bytes = match response.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            FAILED_CACHE.insert(key.clone(), ()).await;
            return Err(format!("cdragon: 读取响应失败: {e}"));
        }
    };

    if bytes.is_empty() {
        FAILED_CACHE.insert(key.clone(), ()).await;
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

/// 仅读取本地缓存（内存 + 磁盘）的图标，绝不发起网络请求。
///
/// 降级链策略：只有用户手动「一键缓存 CDragon」成功落盘后，
/// 本地数据才可作 LCU 失败时的兜底；未缓存过的图标直接快速失败，
/// 避免每次头像请求都等 CDragon 网络超时。
pub async fn local_fetch_icon(kind: &str, id: i64) -> Result<Vec<u8>, String> {
    let key = cache_key(kind, id);

    if let Some(hit) = MEMORY_CACHE.get(&key).await {
        return Ok(hit);
    }

    let disk_path = disk_cache_path(kind, id);
    if disk_path.exists() {
        if let Ok(bytes) = std::fs::read(&disk_path) {
            if !bytes.is_empty() {
                MEMORY_CACHE.insert(key, bytes.clone()).await;
                return Ok(bytes);
            }
        }
    }

    Err(format!(
        "cdragon: {key} 未缓存（本地无数据，不发起网络请求）"
    ))
}

/// 仅本地缓存版本的 `fetch_icon_with_mime`，供 LCU 失败时快速兜底。
pub async fn local_fetch_icon_with_mime(kind: &str, id: i64) -> Result<(Vec<u8>, String), String> {
    let bytes = local_fetch_icon(kind, id).await?;
    let mime = if kind == "profile" {
        "image/jpeg"
    } else {
        "image/png"
    };
    Ok((bytes, mime.to_string()))
}

/// 批量预下载图标到磁盘缓存（M4 数据地基：启动预热，保证离线可渲染）。
///
/// - 磁盘已存在的图标直接跳过，不重复请求
/// - 并发 `PREFETCH_CONCURRENCY`，单图标失败不阻断整体（跳过计数）
/// - 返回实际成功下载数（含内存命中但磁盘缺失后落盘的）
///
/// # 参数
/// - `keys`: 图标清单 `(类型, ID)`，如 `("champion", 1)`、`("perk", 8100)`
pub async fn prefetch_icons(keys: &[(String, i64)]) -> usize {
    if keys.is_empty() {
        return 0;
    }

    let todo: Vec<(String, i64)> = keys
        .iter()
        .filter(|(kind, id)| !disk_cache_path(kind, *id).exists())
        .cloned()
        .collect();
    if todo.is_empty() {
        return 0;
    }

    let semaphore = Arc::new(Semaphore::new(PREFETCH_CONCURRENCY));
    let mut handled = 0usize;
    let mut consecutive_failures = 0usize;
    let mut in_flight = JoinSet::new();

    for (kind, id) in todo {
        // 熔断：连续失败达到阈值即中止（CDragon 不可达时不再发起剩余请求）
        if consecutive_failures >= PREFETCH_FAIL_ABORT_THRESHOLD {
            log::warn!(
                "cdragon: 预下载连续失败 {consecutive_failures} 次，中止剩余预下载（CDragon 可能不可达）"
            );
            break;
        }

        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => break,
        };
        in_flight.spawn(async move {
            let _permit = permit;
            match fetch_icon(&kind, id).await {
                Ok(_) => 1usize,
                Err(e) => {
                    log::warn!("cdragon: 预下载 {kind}/{id} 失败: {e}");
                    0
                }
            }
        });

        // 并发窗口满时，等最早完成的任务，统计结果
        if in_flight.len() >= PREFETCH_CONCURRENCY {
            if let Some(joined) = in_flight.join_next().await {
                match joined {
                    Ok(n) if n > 0 => {
                        handled += n;
                        consecutive_failures = 0;
                    }
                    _ => consecutive_failures += 1,
                }
            }
        }
    }

    // 收尾剩余在飞任务
    while let Some(joined) = in_flight.join_next().await {
        if let Ok(n) = joined {
            handled += n;
        }
    }
    handled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_build_correct_icon_url() {
        let url = icon_url("champion", 1);
        assert!(url.contains("champion-icons"));
        assert!(url.contains("/1.png"));
        assert!(url.contains(&cdn_base()));
        assert!(url.contains(CDRAGON_PATCH));
    }

    #[test]
    fn should_use_jpg_for_profile_icons() {
        let url = icon_url("profile", 456);
        assert!(url.contains("profile-icons"));
        assert!(url.ends_with("/456.jpg"), "profile 应为 jpg: {url}");
    }

    #[test]
    fn should_build_correct_cache_key() {
        assert_eq!(cache_key("champion", 1), "champion/1");
        assert_eq!(cache_key("item", 3031), "item/3031");
    }

    #[test]
    fn should_build_correct_disk_cache_path() {
        let path = disk_cache_path("champion", 1);
        let s = path.to_string_lossy();
        assert!(s.contains("champion_1.png"));
        assert!(s.contains(CDRAGON_PATCH), "磁盘缓存目录应带版本段隔离: {s}");
    }

    #[tokio::test]
    async fn prefetch_with_empty_list_returns_zero() {
        assert_eq!(prefetch_icons(&[]).await, 0);
    }
}
