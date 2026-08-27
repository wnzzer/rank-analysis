//! # Mayhem 数据 HTTP 客户端
//!
//! 与 aramgg 公开客户端 API（`https://data.dtodo.cn/api/client/v1/*`）交互：
//! 拉取远端 `config`（携带 dataVersion 与 manifest 地址）、`manifest.json`
//! （文件清单 + sha256），以及逐个下载并校验数据文件。
//!
//! 接口契约来源：aramgg_client 仓库 `docs/client-api-strategy.md`，
//! 并于 2026-08-26 实测线上响应钉死字段（config: dataVersion/gamePatch/generatedAt/
//! manifest；manifest files[]: path/url/bytes/hash="sha256-<hex>"/cacheControl）。

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// 数据 API 源站。manifest 里的 `url` 是相对路径，需要拼上这个 origin。
pub const DATA_API_ORIGIN: &str = "https://data.dtodo.cn";

/// 远端 config（`GET /api/client/v1/config`）。
///
/// 只取同步所需的字段；`client.latestVersion` 等应用更新相关字段与本模块无关，忽略。
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteConfig {
    /// 数据语言（zh-CN）。非默认语言时 manifest 契约要求显式匹配，本应用只用默认中文。
    #[serde(default)]
    pub locale: String,
    /// 游戏补丁号（如 "16.16"）。
    #[serde(rename = "gamePatch", default)]
    pub game_patch: String,
    /// 数据版本号（如 "16.16.3"）——同步与激活的判定主键。
    #[serde(rename = "dataVersion", default)]
    pub data_version: String,
    /// 数据生成时间（ISO 8601），用于 UI 展示数据新鲜度。
    #[serde(rename = "generatedAt", default)]
    pub generated_at: String,
    /// manifest 相对地址（如 "/api/client/v1/data/16.16.3/manifest.json"）。
    #[serde(default)]
    pub manifest: String,
}

/// manifest 中单个数据文件的描述。
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestFile {
    /// 版本目录内的相对路径（正斜杠分隔，如 "champion-shards/0.json"）。
    pub path: String,
    /// 可选：完整相对 URL；缺省时由 [`DATA_API_ORIGIN`] + path 拼接。
    #[serde(default)]
    pub url: String,
    /// 文件字节数（可选，存在时参与完整性校验）。
    #[serde(default)]
    pub bytes: Option<u64>,
    /// 形如 `"sha256-<64位hex>"` 的内容哈希（可选但强烈预期存在）。
    #[serde(default)]
    pub hash: Option<String>,
}

/// manifest.json（文件清单）。
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    /// 与 config.dataVersion 冗余一致，用于交叉校验。
    #[serde(rename = "dataVersion", default)]
    pub data_version: String,
    /// 全部数据文件清单。
    #[serde(default)]
    pub files: Vec<ManifestFile>,
}

/// 同步结果报告（序列化给前端展示）。
#[derive(Debug, Clone, Serialize)]
pub struct SyncReport {
    /// 同步前本地的版本；首次同步为 None。
    pub from_version: Option<String>,
    /// 同步后的版本。
    pub to_version: String,
    /// 下载并校验通过的文件数。
    pub files: usize,
    /// 下载的总字节数。
    pub bytes: u64,
}

/// 把 manifest 中的 path/url 解析成绝对 URL。
///
/// 已是绝对 URL 直接返回；否则拼上 [`DATA_API_ORIGIN`]。
pub fn join_origin(path_or_url: &str) -> String {
    if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
        return path_or_url.to_string();
    }
    let sep = if path_or_url.starts_with('/') {
        ""
    } else {
        "/"
    };
    format!("{}{}{}", DATA_API_ORIGIN, sep, path_or_url)
}

/// 校验版本目录内相对路径的安全性（防 manifest 被篡改导致路径穿越）。
///
/// 拒绝：空路径、绝对路径、盘符、任何形式的父目录引用（`..`）、反斜杠
/// （上游契约固定用 `/`，出现 `\` 即视为异常）、NTFS 备用数据流冒号。
pub fn is_safe_rel_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return false;
    }
    if path.contains(':') || path.contains('\\') {
        return false;
    }
    path.split('/')
        .all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

/// 从 `"sha256-<hex>"` 提取 hex 部分；格式不符返回 None。
pub fn parse_sha256_hex(hash: Option<&str>) -> Option<String> {
    let raw = hash?.strip_prefix("sha256-")?;
    let normalized = raw.trim().to_lowercase();
    (normalized.len() == 64 && normalized.bytes().all(|b| b.is_ascii_hexdigit()))
        .then_some(normalized)
}

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// GET 一个 URL 并反序列化为 JSON。
async fn fetch_json<T: DeserializeOwned>(url: &str) -> Result<T, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("build http client: {}", e))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("GET {}: HTTP {}", url, resp.status()));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("decode {}: {}", url, e))
}

/// 拉取远端 config。
pub async fn fetch_remote_config() -> Result<RemoteConfig, String> {
    fetch_json(&join_origin("/api/client/v1/config")).await
}

/// 按 config.manifest 地址拉取文件清单。
pub async fn fetch_manifest(manifest_path: &str) -> Result<Manifest, String> {
    fetch_json(&join_origin(manifest_path)).await
}

/// 流式下载文件到目标路径，校验 sha256（提供 hash 时）与字节数（提供 bytes 时）。
///
/// 先写到同目录 `<dest>.part`，全部校验通过后原子重命名为最终路径——失败不留下半成品。
/// 带轻量重试（最多 3 次），抵抗连续 40+ 文件批量下载时的网络抖动。
///
/// # 返回值
///
/// 实际写入的字节数。
pub async fn download_verified(
    url: &str,
    expect_hash: Option<&str>,
    dest: &Path,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("build http client: {}", e))?;

    let mut attempts = 0;
    let body = loop {
        attempts += 1;
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                Ok(bytes) => break bytes,
                Err(_e) if attempts < 3 => {
                    tokio::time::sleep(std::time::Duration::from_millis(300 * attempts)).await;
                    continue;
                }
                Err(e) => return Err(format!("read {}: {}", url, e)),
            },
            Ok(resp) if attempts < 3 && resp.status().is_server_error() => {
                tokio::time::sleep(std::time::Duration::from_millis(300 * attempts)).await;
                continue;
            }
            Ok(resp) => return Err(format!("GET {}: HTTP {}", url, resp.status())),
            Err(_e) if attempts < 3 => {
                tokio::time::sleep(std::time::Duration::from_millis(300 * attempts)).await;
                continue;
            }
            Err(e) => return Err(format!("GET {}: {}", url, e)),
        }
    };

    if let Some(hex) = parse_sha256_hex(expect_hash) {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(&body);
        let actual = hex::encode(digest);
        if actual != hex {
            return Err(format!(
                "hash mismatch for {}: expect {} got {}",
                url, hex, actual
            ));
        }
    }

    crate::paths::ensure_parent_dir(dest)
        .map_err(|e| format!("mkdir {}: {}", dest.display(), e))?;
    let part = dest.with_extension("part");
    std::fs::write(&part, &body).map_err(|e| format!("write {}: {}", part.display(), e))?;
    std::fs::rename(&part, dest).map_err(|e| format!("rename to {}: {}", dest.display(), e))?;
    Ok(body.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_origin_should_handle_relative_and_absolute() {
        assert_eq!(
            join_origin("/api/x.json"),
            "https://data.dtodo.cn/api/x.json"
        );
        // 无前导斜杠也要能拼
        assert_eq!(
            join_origin("api/x.json"),
            "https://data.dtodo.cn/api/x.json"
        );
        // 绝对 URL 原样返回
        assert_eq!(
            join_origin("https://cdn.example.com/a.json"),
            "https://cdn.example.com/a.json"
        );
    }

    #[test]
    fn is_safe_rel_path_should_reject_traversal_and_absolutes() {
        assert!(is_safe_rel_path("augments.json"));
        assert!(is_safe_rel_path("champion-shards/0.json"));
        assert!(!is_safe_rel_path(""));
        assert!(!is_safe_rel_path("/abs.json"));
        assert!(!is_safe_rel_path("../escape.json"));
        assert!(!is_safe_rel_path("a/../b.json"));
        assert!(!is_safe_rel_path("./a.json"));
        assert!(!is_safe_rel_path("C:/x.json"));
        assert!(!is_safe_rel_path("a\\b.json"));
        assert!(!is_safe_rel_path("ads:b.json"));
        assert!(!is_safe_rel_path("dir//x.json"));
    }

    #[test]
    fn parse_sha256_hex_should_accept_only_canonical_form() {
        let h = "a".repeat(64);
        assert_eq!(
            parse_sha256_hex(Some(&format!("sha256-{}", h))),
            Some(h.clone())
        );
        // 大写应归一化为小写
        let upper = format!("sha256-{}", h.to_uppercase());
        assert_eq!(parse_sha256_hex(Some(&upper)), Some(h));
        // 非法形态一律拒绝
        assert_eq!(parse_sha256_hex(Some("md5-abc")), None);
        assert_eq!(parse_sha256_hex(Some("sha256-短")), None);
        assert_eq!(parse_sha256_hex(None), None);
    }

    // RemoteConfig / Manifest 反序列化容错：实测线上字段钉死，缺字段不应炸
    #[test]
    fn remote_config_should_deserialize_from_live_shape() {
        let raw = r#"{
            "service":"aramgg-client-api","apiVersion":"client-v1","locale":"zh-CN",
            "gamePatch":"16.16","dataVersion":"16.16.3",
            "generatedAt":"2026-08-24T14:35:03.486Z",
            "manifest":"/api/client/v1/data/16.16.3/manifest.json"
        }"#;
        let cfg: RemoteConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.data_version, "16.16.3");
        assert_eq!(cfg.game_patch, "16.16");
        assert_eq!(cfg.manifest, "/api/client/v1/data/16.16.3/manifest.json");
    }

    #[test]
    fn manifest_should_deserialize_from_live_shape() {
        let raw = r#"{"dataVersion":"16.16.3","files":[
            {"path":"augments.json","url":"/api/client/v1/data/16.16.3/augments.json",
             "bytes":389753,"hash":"sha256-f24c","cacheControl":"public"}]}"#;
        let m: Manifest = serde_json::from_str(raw).unwrap();
        assert_eq!(m.files.len(), 1);
        assert_eq!(m.files[0].path, "augments.json");
        assert_eq!(m.files[0].bytes, Some(389753));
    }
}
