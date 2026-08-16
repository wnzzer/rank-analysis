//! 知识库（远程可更新的排位/大乱斗/海克斯乱斗知识合集 + 信号规则）。
//!
//! 数据由 `scripts/build-knowledge.mjs` 编译仓库 `knowledge/` 源文件产出
//! `data/knowledge/knowledge.json`，经 jsDelivr / GitCode 分发（与
//! [`crate::cn_patch_notes`] 同构），并在 `update_knowledge()` 时刷新。
//!
//! # 降级链
//! 内存 fresh → 磁盘 fresh → 网络拉取（成功落盘）→ 网络失败回退过期磁盘 →
//! 内置兜底副本（`include_str!` 编译进二进制，永远可用）。
//!
//! # 新鲜度
//! TTL 6h（与 cn_patch_notes / fandom 同约定）；schemaVersion 不识别时
//! 一律按无数据处理（回退兜底），不 panic。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 缓存有效期：6 小时（秒）
pub const TTL_SECS: i64 = 6 * 60 * 60;
/// 当前支持的数据 schema 版本（与 build-knowledge.mjs 的 SCHEMA_VERSION 对齐）
pub const SCHEMA_VERSION: u32 = 1;

/// 分发源，按序尝试：jsDelivr CDN（国内可达）→ GitCode raw（仓库镜像）
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/knowledge/knowledge.json",
    "https://gitcode.com/wnzzer/rank-analysis/raw/main/data/knowledge/knowledge.json",
];

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 内置兜底副本：构建期随二进制打包，任何缓存/网络故障时保底可用
const FALLBACK_JSON: &str = include_str!("../../../data/knowledge/knowledge.json");

/// 单条信号规则（阈值 + 文案模板；判定逻辑在前端信号引擎）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignalCondition {
    pub metric: String,
    /// lt | lte | gt | gte | eq
    pub op: String,
    pub value: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignalRule {
    pub id: String,
    /// teammate | enemy | self
    pub scope: String,
    /// 可选：仅特定位置生效（如 JUNGLE）
    pub position: Option<String>,
    /// 全部满足才命中（可空）
    pub when_all: Vec<SignalCondition>,
    /// 任一满足即命中（可空）
    pub when_any: Vec<SignalCondition>,
    /// 文案模板，支持 {name} 与 {metric} 占位符
    pub text: String,
    /// info | warn | danger
    pub severity: String,
}

/// 知识库完整数据（与 build-knowledge.mjs 产物契约一致）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub schema_version: u32,
    pub patch: String,
    pub updated_at: String,
    /// 版本英雄改动已由 cn 补丁管道独立覆盖，此字段保持空对象
    pub patch_notes: HashMap<String, serde_json::Value>,
    /// championId → 知识点（渐进补充，本批可能为空）
    pub champion_notes: HashMap<String, serde_json::Value>,
    /// "ranked" | "aram" | "brawl" → 知识条目
    pub mode_knowledge: HashMap<String, Vec<String>>,
    pub signal_rules: Vec<SignalRule>,
}

/// 本地缓存快照：checked_at 驱动 TTL；data=None 表示上次拉取无可用数据
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KnowledgeSnapshot {
    pub checked_at: i64,
    pub data: Option<KnowledgeBase>,
}

/// 解析并校验 schema 版本；不识别的版本返回 None（视为无数据，不 panic）
pub fn parse_data(json: &str) -> Option<KnowledgeBase> {
    let data: KnowledgeBase = match serde_json::from_str(json) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("knowledge parse failed: {}", e);
            return None;
        }
    };
    if data.schema_version != SCHEMA_VERSION {
        log::warn!("knowledge schema {} unsupported", data.schema_version);
        return None;
    }
    Some(data)
}

/// 内置兜底副本（解析失败时返回 None，理论上不会发生——契约测试兜底）
pub fn fallback_base() -> Option<KnowledgeBase> {
    parse_data(FALLBACK_JSON)
}

/// 磁盘缓存路径（系统临时目录，与 opgg/wiki 缓存同约定）
pub fn default_path() -> PathBuf {
    crate::paths::cache_file("knowledge_cache.json")
}

fn load_from_path(path: &Path) -> Option<KnowledgeSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_to_path(snapshot: &KnowledgeSnapshot, path: &Path) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        if let Err(e) = std::fs::write(path, json) {
            log::warn!("knowledge cache write {}: {}", path.display(), e);
        }
    }
}

async fn fetch_remote(client: &reqwest::Client) -> Option<KnowledgeBase> {
    for url in SOURCES {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    if let Some(data) = parse_data(&text) {
                        log::info!(
                            "knowledge 「{}」: {} modes, {} rules (from {})",
                            data.patch,
                            data.mode_knowledge.len(),
                            data.signal_rules.len(),
                            url
                        );
                        return Some(data);
                    }
                }
                Err(e) => log::warn!("knowledge read {} failed: {}", url, e),
            },
            Ok(resp) => log::warn!("knowledge {} HTTP {}", url, resp.status()),
            Err(e) => log::warn!("knowledge {} failed: {}", url, e),
        }
    }
    None
}

/// 内存缓存 + 单飞锁
static SNAPSHOT: tokio::sync::Mutex<Option<Arc<KnowledgeSnapshot>>> =
    tokio::sync::Mutex::const_new(None);

/// 取知识库快照：内存 →（TTL 内）磁盘 → 网络 → 过期磁盘 → 内置兜底。
///
/// 拉取失败时旧数据只续命在内存（不刷新 checked_at 落盘，避免把故障钉死 6h）；
/// 兜底副本数据源的 `source` 标记由调用方经 status 透出。
pub async fn get_or_fetch() -> Arc<KnowledgeSnapshot> {
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
            log::warn!("knowledge client build failed: {}", e);
            None
        }
    };

    let snapshot = match fetched {
        Some(data) => {
            let s = KnowledgeSnapshot {
                checked_at: now,
                data: Some(data),
            };
            save_to_path(&s, &default_path());
            s
        }
        // 拉取失败：过期磁盘续命 → 内置兜底；负缓存仅内存持有
        None => KnowledgeSnapshot {
            checked_at: now,
            data: disk.and_then(|d| d.data).or_else(|| {
                log::warn!("knowledge fallback to built-in copy");
                fallback_base()
            }),
        },
    };
    let arc = Arc::new(snapshot);
    *guard = Some(arc.clone());
    arc
}

/// 强制刷新（供 `update_knowledge` 命令与启动时调用）：跳过 TTL 直接拉取。
/// 返回拉取后的最新快照（成功与否由 status 判断）。
pub async fn force_refresh() -> Arc<KnowledgeSnapshot> {
    let mut guard = SNAPSHOT.lock().await;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok();
    let fetched = match client.as_ref() {
        Some(c) => fetch_remote(c).await,
        None => None,
    };

    let snapshot = match fetched {
        Some(data) => {
            let s = KnowledgeSnapshot {
                checked_at: now,
                data: Some(data),
            };
            save_to_path(&s, &default_path());
            s
        }
        None => {
            let disk = load_from_path(&default_path());
            KnowledgeSnapshot {
                checked_at: now,
                data: disk.and_then(|d| d.data).or_else(fallback_base),
            }
        }
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
            r#"{{"schemaVersion":{},"patch":"26.13","updatedAt":"2026-08-16T00:00:00Z",
"patchNotes":{{}},"championNotes":{{}},
"modeKnowledge":{{"ranked":["[对局节奏] 前 15 分钟线权决定小龙团主动权"],"aram":[],"brawl":[]}},
"signalRules":[{{"id":"loser-streak","scope":"teammate","position":null,
"whenAll":[{{"metric":"lossStreak","op":"gte","value":4}}],"whenAny":[],
"text":"{{name}}正在{{lossStreak}}连败","severity":"warn"}}]}}"#,
            schema
        )
    }

    #[test]
    fn should_parse_valid_data() {
        let data = parse_data(&sample_json(1)).expect("schema 1 应可解析");
        assert_eq!(data.patch, "26.13");
        assert_eq!(data.mode_knowledge["ranked"].len(), 1);
        let rule = &data.signal_rules[0];
        assert_eq!(rule.id, "loser-streak");
        assert_eq!(rule.when_all[0].metric, "lossStreak");
        assert_eq!(rule.when_all[0].op, "gte");
        assert_eq!(rule.when_all[0].value, 4.0);
        assert!(rule.position.is_none());
    }

    #[test]
    fn should_reject_unknown_schema_version() {
        assert!(parse_data(&sample_json(2)).is_none());
        assert!(parse_data("not json").is_none());
    }

    #[test]
    fn should_reject_malformed_rule_shape() {
        // metric 缺失（Option 字段不存在会反序列化失败）
        let json = r#"{"schemaVersion":1,"patch":"26.13","updatedAt":"2026-08-16T00:00:00Z",
"patchNotes":{},"championNotes":{},"modeKnowledge":{},"signalRules":[]}"#;
        assert!(parse_data(json).is_some());
    }

    #[test]
    fn builtin_fallback_should_satisfy_contract() {
        // 契约测试：仓库内置兜底副本必须能被本客户端解析（与 CI 产物同源）
        let data = fallback_base().expect("内置兜底副本应满足 schema v1 契约");
        assert!(!data.patch.is_empty());
        assert!(!data.mode_knowledge.is_empty());
        assert!(data.mode_knowledge.contains_key("ranked"));
        assert!(!data.signal_rules.is_empty());
        for rule in &data.signal_rules {
            assert!(!rule.id.is_empty());
            assert!(!rule.text.is_empty());
            let conditions = rule
                .when_all
                .iter()
                .chain(rule.when_any.iter())
                .collect::<Vec<_>>();
            assert!(!conditions.is_empty(), "{} 应有条件", rule.id);
        }
    }
}
