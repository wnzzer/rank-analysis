//! SGP league-servers 动态主机映射（P1-3 加固）。
//!
//! 背景：`constant/game.rs` 的 `SGP_PLATFORM_TO_HOST` 是编译期静态表（来源
//! LeagueAkari builtin 配置）。SGP token 每次请求现取天然轮换，但主机映射是死的——
//! 上游调整主机 / 新增区服后旧表直接失效（401 拒新 token / 超时）。
//!
//! 本模块把映射动态化：
//! - 远程源：LeagueAkari akari-api 同源 `sgp/league-servers`（服务端按 updatedAt 版本化下发）
//! - 磁盘缓存：配置目录 `sgp_league_servers.json`（跨重启保留，updatedAt 择优）
//! - 刷新时机：懒加载（首次解析 miss 时同步拉一次）+ 2h 节流后台 revalidate +
//!   [`force_refresh`]（请求失败兜底，无视节流立即拉）
//! - 回退顺序：动态表（远程 + 磁盘）→ 静态表（远程不可达 / 解析失败时兜底，绝不丢主机）

use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::constant;
use crate::lcu::util::http::external_get_json;
use crate::paths::{data_file, ensure_parent_dir};

/// 远程配置源：与 LeagueAkari 的 akari-api 相同（`https://akari-api.yuru-yuri.com` 下的
/// `sgp/league-servers` 资源）。失败静默保旧，依赖 [`resolve_sgp_host`] 的静态表兜底。
const REMOTE_URL: &str = "https://akari-api.yuru-yuri.com/sgp/league-servers";

/// 磁盘缓存文件名（配置目录，跨重启保留）。
const CACHE_FILE_NAME: &str = "sgp_league_servers.json";

/// 后台 revalidate 间隔：对齐 LeagueAkari 的 2h。
const REVALIDATE_INTERVAL: Duration = Duration::from_secs(2 * 60 * 60);

/// 单个服务器的 SGP 端点配置（与远程下发字段一致；未知字段忽略）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueServerEndpoint {
    #[serde(rename = "matchHistory")]
    pub match_history: String,
    pub common: String,
    #[serde(rename = "isTencent")]
    pub is_tencent: bool,
    #[serde(rename = "regionPathParam", default)]
    pub region_path_param: Option<String>,
}

/// 远程下发的整表配置（`servers` 的 key = 服务器 ID，如 `TENCENT_HN10` / `NA1`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueServersConfig {
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub servers: HashMap<String, LeagueServerEndpoint>,
}

struct Store {
    config: Option<LeagueServersConfig>,
    /// 最近一次远程拉取时间（成功与失败都记，避免离线时每次 miss 都重拉；
    /// [`force_refresh`] 与 `maybe_spawn_revalidate` 的 2h 节流依据）。
    last_fetch: Option<Instant>,
}

static STORE: LazyLock<Mutex<Store>> = LazyLock::new(|| {
    Mutex::new(Store {
        config: None,
        last_fetch: None,
    })
});

/// 解析远程/磁盘的原始 JSON 文本为配置（校验失败返回错误，调用方回退静态表）。
pub fn parse_config(text: &str) -> Result<LeagueServersConfig, String> {
    let config: LeagueServersConfig =
        serde_json::from_str(text).map_err(|e| format!("league-servers 配置解析失败: {e}"))?;
    if config.updated_at.trim().is_empty() || config.servers.is_empty() {
        return Err("league-servers 配置缺 updatedAt 或 servers 为空".to_string());
    }
    Ok(config)
}

/// 服务器 ID → 端点：先按 platform_id 直查（国际区 key 即 platform_id），
/// 再试 `TENCENT_{platform_id}` 前缀（腾讯区 key 形如 `TENCENT_HN10`）。
fn endpoint_of<'a>(
    config: &'a LeagueServersConfig,
    platform_id: &str,
) -> Option<&'a LeagueServerEndpoint> {
    config
        .servers
        .get(platform_id)
        .or_else(|| config.servers.get(&format!("TENCENT_{platform_id}")))
}

/// 择优判定：incoming 的 updatedAt 更新（或当前无配置）才应用。
/// 同源下发格式固定（ISO-8601 等长字符串），字典序即时间序。
fn config_is_newer(cur: Option<&LeagueServersConfig>, incoming: &LeagueServersConfig) -> bool {
    match cur {
        None => true,
        Some(cur) => incoming.updated_at > cur.updated_at,
    }
}

/// 应用配置到内存 + 写磁盘缓存（写盘失败静默——下次启动重新拉取即可）。
fn apply_config(config: LeagueServersConfig) {
    let newer = {
        let st = STORE.lock().unwrap();
        config_is_newer(st.config.as_ref(), &config)
    };
    if !newer {
        return;
    }
    STORE.lock().unwrap().config = Some(config.clone());
    if let Err(e) = save_disk_cache_at(&data_file(CACHE_FILE_NAME), &config) {
        log::warn!("SGP league-servers 磁盘缓存写入失败（不影响内存映射）: {e}");
    }
}

/// 读磁盘缓存（不存在的文件 / 解析失败都视为无缓存）。
pub fn load_disk_cache_at(path: &Path) -> Option<LeagueServersConfig> {
    let text = std::fs::read_to_string(path).ok()?;
    parse_config(&text).ok()
}

/// 写磁盘缓存（自动建父目录）。
fn save_disk_cache_at(path: &Path, config: &LeagueServersConfig) -> std::io::Result<()> {
    ensure_parent_dir(path)?;
    let text = serde_json::to_string(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(path, text)
}

/// 远程拉取（走公开 HTTPS，无 LCU 依赖）。
async fn fetch_remote() -> Result<LeagueServersConfig, String> {
    external_get_json::<LeagueServersConfig>(REMOTE_URL).await
}

/// 拉取 + 择优应用。成功与失败都刷新 last_fetch（节流依据），失败保留现有映射。
async fn refresh_from_remote() {
    let result = fetch_remote().await;
    STORE.lock().unwrap().last_fetch = Some(Instant::now());
    match result {
        Ok(config) => apply_config(config),
        Err(e) => log::warn!("SGP league-servers 远程拉取失败（保留现有映射）: {e}"),
    }
}

/// 请求失败兜底：无视 2h 节流立即重新拉取（P1-3 重试链调用）。
pub async fn force_refresh() {
    refresh_from_remote().await;
}

/// 动态表命中且距上次拉取 ≥2h 时，后台 revalidate（不阻塞请求；竞态重拉无害，
/// `apply_config` 按 updatedAt 择优且幂等）。
fn maybe_spawn_revalidate() {
    let stale = STORE
        .lock()
        .unwrap()
        .last_fetch
        .map(|t| t.elapsed() >= REVALIDATE_INTERVAL)
        .unwrap_or(true);
    if stale {
        tokio::spawn(async {
            refresh_from_remote().await;
        });
    }
}

fn dynamic_host(platform_id: &str, common: bool) -> Option<String> {
    let st = STORE.lock().unwrap();
    let endpoint = st
        .config
        .as_ref()
        .and_then(|c| endpoint_of(c, platform_id))?;
    let host = if common {
        &endpoint.common
    } else {
        &endpoint.match_history
    };
    if host.is_empty() {
        None
    } else {
        Some(host.clone())
    }
}

fn static_host(platform_id: &str, common: bool) -> Option<String> {
    if common {
        constant::game::get_sgp_common_host(platform_id).map(String::from)
    } else {
        constant::game::get_sgp_host(platform_id).map(String::from)
    }
}

/// 解析某大区的 SGP 主机（战绩主机 `common=false` / common 主机 `common=true`）。
///
/// 顺序：动态表（内存，首次 miss 时并入磁盘缓存）→ 同步拉一次远程并回查 →
/// 静态表兜底。返回值 `None` 仅在「远程不可达且静态表也无此大区」时出现。
pub async fn resolve_sgp_host(platform_id: &str, common: bool) -> Option<String> {
    if STORE.lock().unwrap().config.is_none() {
        if let Some(cached) = load_disk_cache_at(&data_file(CACHE_FILE_NAME)) {
            apply_config(cached);
        }
    }
    if let Some(host) = dynamic_host(platform_id, common) {
        maybe_spawn_revalidate();
        return Some(host);
    }

    // 动态表 miss：距上次拉取 ≥2h（或从未拉过）才同步拉一次，之后回查
    let stale = STORE
        .lock()
        .unwrap()
        .last_fetch
        .map(|t| t.elapsed() >= REVALIDATE_INTERVAL)
        .unwrap_or(true);
    if stale {
        refresh_from_remote().await;
        if let Some(host) = dynamic_host(platform_id, common) {
            return Some(host);
        }
    }

    static_host(platform_id, common)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "updatedAt": "2026-07-18T04:00:00.000Z",
        "servers": {
            "NA1": { "matchHistory": "usw2-red.pp.sgp.pvp.net", "common": "usw2-red.lol.sgp.pvp.net", "isTencent": false },
            "TENCENT_HN10": { "matchHistory": "hn10-k8s-sgp.lol.qq.com:21019", "common": "hn10-k8s-sgp.lol.qq.com:21019", "isTencent": true },
            "TENCENT_HN1": { "matchHistory": "hn1-k8s-sgp.lol.qq.com:21019", "common": "hn1-k8s-sgp.lol.qq.com:21019", "isTencent": true, "regionPathParam": "HN1" }
        },
        "serverNames": { "NA1": { "zh-CN": "北美" } }
    }"#;

    #[test]
    fn parse_config_accepts_sample_with_extra_fields() {
        let config = parse_config(SAMPLE).expect("应能解析含 serverNames 等多余字段的配置");
        assert_eq!(config.servers.len(), 3);
        assert_eq!(config.updated_at, "2026-07-18T04:00:00.000Z");
    }

    #[test]
    fn parse_config_rejects_garbage() {
        assert!(parse_config("not json").is_err());
        assert!(parse_config("{}").is_err(), "缺 updatedAt/servers 必须拒绝");
        assert!(
            parse_config(r#"{"updatedAt":"x","servers":{}}"#).is_err(),
            "空 servers 必须拒绝"
        );
    }

    #[test]
    fn endpoint_of_prefers_exact_key_then_tencent_prefix() {
        let config = parse_config(SAMPLE).unwrap();
        assert_eq!(
            endpoint_of(&config, "NA1").unwrap().match_history,
            "usw2-red.pp.sgp.pvp.net"
        );
        assert_eq!(
            endpoint_of(&config, "HN10").unwrap().match_history,
            "hn10-k8s-sgp.lol.qq.com:21019"
        );
        assert!(endpoint_of(&config, "EUW1").is_none(), "未知大区必须 miss");
        assert_eq!(
            endpoint_of(&config, "HN1")
                .unwrap()
                .region_path_param
                .as_deref(),
            Some("HN1")
        );
    }

    #[test]
    fn config_is_newer_compares_updated_at() {
        let old = parse_config(SAMPLE).unwrap();
        let newer =
            parse_config(&SAMPLE.replace("2026-07-18T04:00:00.000Z", "2026-08-01T00:00:00.000Z"))
                .unwrap();
        assert!(config_is_newer(None, &old));
        assert!(!config_is_newer(Some(&old), &old), "同版本不得覆盖");
        assert!(config_is_newer(Some(&old), &newer));
        assert!(!config_is_newer(Some(&newer), &old));
    }

    #[test]
    fn disk_cache_roundtrip() {
        let path =
            std::env::temp_dir().join(format!("ra-sgp-league-servers-{}.json", std::process::id()));
        let config = parse_config(SAMPLE).unwrap();
        save_disk_cache_at(&path, &config).expect("写入应成功");
        let loaded = load_disk_cache_at(&path).expect("应能读回");
        assert_eq!(loaded.updated_at, config.updated_at);
        assert_eq!(loaded.servers.len(), config.servers.len());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dynamic_host_reads_common_vs_match_history() {
        let config = parse_config(SAMPLE).unwrap();
        STORE.lock().unwrap().config = Some(config);
        assert_eq!(
            dynamic_host("NA1", false).as_deref(),
            Some("usw2-red.pp.sgp.pvp.net")
        );
        assert_eq!(
            dynamic_host("NA1", true).as_deref(),
            Some("usw2-red.lol.sgp.pvp.net")
        );
        assert_eq!(
            dynamic_host("HN10", false).as_deref(),
            Some("hn10-k8s-sgp.lol.qq.com:21019")
        );
        assert_eq!(dynamic_host("EUW1", false), None);
        STORE.lock().unwrap().config = None;
    }
}
