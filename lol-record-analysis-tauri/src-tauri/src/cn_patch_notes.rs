//! 国服英雄改动数据（瘦客户端）：消费 CI 管线产出的静态 JSON。
//!
//! 数据由 `.github/workflows/patch-notes-data.yml` 生成（AI 抽取 + 校验闸门）
//! 并提交至 `data/patch-notes/cn-latest.json`，经 jsDelivr / GitCode 分发。
//! 本模块只做拉取、缓存与按 championId 查询，不含任何解析/判定逻辑。
//!
//! # 缓存
//! 内存 + 磁盘（`cn_patch_notes_cache.json`），TTL 6h；网络失败旧快照续命。
//!
//! # 新鲜度守卫
//! 公告发布超过 21 天视为跨版本旧数据（国服约两周一更），查询按未命中处理，
//! 由调用方降级 Wiki 英文源。

use crate::fandom::patch_notes::{ChampionPatchNote, ChangeDirection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 缓存有效期：6 小时（秒）
pub const TTL_SECS: i64 = 6 * 60 * 60;
/// 新鲜度上限：21 天（秒）
pub const FRESH_SECS: i64 = 21 * 24 * 60 * 60;
/// 当前支持的数据 schema 版本
pub const SCHEMA_VERSION: u32 = 1;

/// 分发源，按序尝试：jsDelivr CDN（国内可达）→ GitCode raw（仓库镜像）
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/patch-notes/cn-latest.json",
    "https://gitcode.com/wnzzer/rank-analysis/raw/main/data/patch-notes/cn-latest.json",
];

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 单个英雄的改动（CI 已按白名单富化 id/alias）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CnChampionNote {
    pub champion_id: i64,
    pub alias: String,
    /// 中文名（如「娜美」）
    pub name: String,
    pub direction: ChangeDirection,
    /// 公告原文条目（校验闸门保证逐字）
    pub lines: Vec<String>,
}

/// `cn-latest.json` 的完整数据
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CnPatchData {
    pub schema_version: u32,
    pub doc_id: String,
    pub title: String,
    /// 展示标签（如「7月16日更新」）
    pub patch_label: String,
    pub published_at: String,
    /// 公告发布时刻 Unix 秒（新鲜度守卫用）
    pub published_at_epoch: i64,
    pub generated_at: String,
    pub source_url: String,
    pub champions: Vec<CnChampionNote>,
}

/// 本地缓存快照：checked_at 驱动 TTL；data=None 表示上次拉取无可用数据
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CnPatchSnapshot {
    pub checked_at: i64,
    pub data: Option<CnPatchData>,
}

/// 公告是否仍在新鲜期内（21 天）
pub fn is_fresh(data: &CnPatchData, now: i64) -> bool {
    now - data.published_at_epoch < FRESH_SECS
}

/// 按英雄 ID 查改动，命中时格式化为通用 [`ChampionPatchNote`]
/// （champion 字段 = 「名字（patchLabel）」，与 Wiki 源产物同构，前端无感）
pub fn note_for(data: &CnPatchData, champion_id: i64) -> Option<ChampionPatchNote> {
    data.champions
        .iter()
        .find(|c| c.champion_id == champion_id)
        .map(|c| ChampionPatchNote {
            champion: format!("{}（{}）", c.name, data.patch_label),
            direction: c.direction,
            lines: c.lines.clone(),
        })
}

/// 解析并校验 schema 版本；不识别的版本返回 None（视为无数据，不 panic）
pub fn parse_data(json: &str) -> Option<CnPatchData> {
    let data: CnPatchData = match serde_json::from_str(json) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("cn patch data parse failed: {}", e);
            return None;
        }
    };
    if data.schema_version != SCHEMA_VERSION {
        log::warn!("cn patch data schema {} unsupported", data.schema_version);
        return None;
    }
    Some(data)
}

/// 磁盘缓存路径（工作目录相对，与 opgg/wiki 缓存同约定）
pub fn default_path() -> PathBuf {
    PathBuf::from("cn_patch_notes_cache.json")
}

fn load_from_path(path: &Path) -> Option<CnPatchSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_to_path(snapshot: &CnPatchSnapshot, path: &Path) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        if let Err(e) = std::fs::write(path, json) {
            log::warn!("cn patch notes cache write {}: {}", path.display(), e);
        }
    }
}

async fn fetch_remote(client: &reqwest::Client) -> Option<CnPatchData> {
    for url in SOURCES {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    if let Some(data) = parse_data(&text) {
                        log::info!(
                            "cn patch data 「{}」: {} champions (from {})",
                            data.patch_label,
                            data.champions.len(),
                            url
                        );
                        return Some(data);
                    }
                }
                Err(e) => log::warn!("cn patch data read {} failed: {}", url, e),
            },
            Ok(resp) => log::warn!("cn patch data {} HTTP {}", url, resp.status()),
            Err(e) => log::warn!("cn patch data {} failed: {}", url, e),
        }
    }
    None
}

/// 内存缓存 + 单飞锁
static SNAPSHOT: tokio::sync::Mutex<Option<Arc<CnPatchSnapshot>>> =
    tokio::sync::Mutex::const_new(None);

/// 取国服改动快照：内存 →（TTL 内）磁盘 → 网络；网络失败旧数据续命（仅内存，
/// 不刷新 checked_at 落盘，避免把故障钉死 6h）。
pub async fn get_or_fetch() -> Arc<CnPatchSnapshot> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut guard = SNAPSHOT.lock().await;

    if let Some(snap) = guard.as_ref() {
        if now - snap.checked_at < TTL_SECS {
            return snap.clone();
        }
    }
    let disk = load_from_path(&default_path());
    if let Some(d) = disk.as_ref() {
        if now - d.checked_at < TTL_SECS {
            let arc = Arc::new(d.clone());
            *guard = Some(arc.clone());
            return arc;
        }
    }

    let fetched = match reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => fetch_remote(&client).await,
        Err(e) => {
            log::warn!("cn patch notes client build failed: {}", e);
            None
        }
    };

    let snapshot = match fetched {
        Some(data) => {
            let s = CnPatchSnapshot {
                checked_at: now,
                data: Some(data),
            };
            save_to_path(&s, &default_path());
            s
        }
        // 拉取失败：旧数据续命（含 disk 里可能的 None），负缓存仅内存持有
        None => CnPatchSnapshot {
            checked_at: now,
            data: disk.and_then(|d| d.data),
        },
    };
    let arc = Arc::new(snapshot);
    *guard = Some(arc.clone());
    arc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json(schema: u32) -> String {
        format!(
            r#"{{"schemaVersion":{},"docId":"6214","title":"7月16日凌晨1点停机版本更新公告",
"patchLabel":"7月16日更新","publishedAt":"2026-07-15","publishedAtEpoch":1000000,
"generatedAt":"2026-07-16T02:00:00Z","sourceUrl":"https://lol.qq.com/gicp/news/410/37091415.html",
"champions":[{{"championId":267,"alias":"Nami","name":"娜美","direction":"buff",
"lines":["W 潮涌 治疗量：60 → 65"]}}]}}"#,
            schema
        )
    }

    #[test]
    fn should_parse_valid_data() {
        let data = parse_data(&sample_json(1)).expect("schema 1 应可解析");
        assert_eq!(data.doc_id, "6214");
        assert_eq!(data.champions.len(), 1);
        assert_eq!(data.champions[0].champion_id, 267);
        assert_eq!(data.champions[0].direction, ChangeDirection::Buff);
    }

    #[test]
    fn should_reject_unknown_schema_version() {
        assert!(parse_data(&sample_json(2)).is_none());
        assert!(parse_data("not json").is_none());
    }

    #[test]
    fn freshness_should_expire_at_21_days() {
        let data = parse_data(&sample_json(1)).unwrap();
        assert!(is_fresh(&data, 1_000_000 + FRESH_SECS - 1));
        assert!(!is_fresh(&data, 1_000_000 + FRESH_SECS));
    }

    #[test]
    fn note_for_should_format_champion_with_label() {
        let data = parse_data(&sample_json(1)).unwrap();
        let note = note_for(&data, 267).expect("267 应命中");
        assert_eq!(note.champion, "娜美（7月16日更新）");
        assert_eq!(note.direction, ChangeDirection::Buff);
        assert_eq!(note.lines, vec!["W 潮涌 治疗量：60 → 65"]);
        assert!(note_for(&data, 1).is_none());
    }

    /// 契约测试：CI 管线产出的真实数据文件必须能被本客户端解析。
    /// 任一侧 schema 漂移（字段名/类型/枚举值）都会在这里红灯，而不是线上静默降级。
    #[test]
    fn repo_data_file_should_satisfy_client_contract() {
        let json = include_str!("../../../data/patch-notes/cn-latest.json");
        let data = parse_data(json).expect("仓库内 cn-latest.json 应符合 schema v1 契约");
        assert!(!data.doc_id.is_empty());
        assert!(!data.patch_label.is_empty());
        assert!(data.published_at_epoch > 0);
        for c in &data.champions {
            assert!(c.champion_id > 0);
            assert!(!c.name.is_empty());
            assert!(!c.lines.is_empty());
        }
    }
}
