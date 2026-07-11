//! # LCU HTTP 客户端
//!
//! 使用本地认证（token + port）向 LCU 发起 HTTPS 请求，支持 GET/POST/PATCH；
//! 认证失败时自动刷新并重试一次。图片接口支持 Base64 或二进制返回。

use crate::lcu::util::token::get_auth;
use base64::engine::general_purpose;
use base64::Engine;
use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Serialize};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static AUTH: OnceLock<Mutex<(String, String)>> = OnceLock::new();
static LAST_REFRESH_TIME: OnceLock<Mutex<Instant>> = OnceLock::new();

/// 最大并发 LCU GET 请求数
static LCU_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(10));

/// Singleflight：相同 URI 的并发 GET 请求只发一次，100ms TTL
static SINGLEFLIGHT: LazyLock<moka::future::Cache<String, String>> = LazyLock::new(|| {
    moka::future::Cache::builder()
        .time_to_live(std::time::Duration::from_millis(100))
        .max_capacity(200)
        .build()
});
fn get_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            // 本客户端只连 127.0.0.1（LCU / Riot Client），必须绕过一切代理：
            // reqwest 默认会读环境变量与 Windows 系统代理，玩家开加速器/Clash 且
            // 例外名单不含 127.0.0.1 时，本地请求会被劫持到代理导致直接失败。
            // 同类项目 LeagueAkari 对 LCU/RC axios 亦显式 `proxy: false`。
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(50))
            .build()
            .expect("Failed to build reqwest client")
    })
}

/// 外网公开资源（CommunityDragon 等）专用客户端。
///
/// 与 [`get_client`] 刻意分离：外网请求**保留**系统/环境代理支持（国内网络访问
/// CommunityDragon 常需代理），且走正常 TLS 校验，不沿用本地客户端的
/// `danger_accept_invalid_certs`。
static EXTERNAL_CLIENT: OnceLock<Client> = OnceLock::new();

fn external_client() -> &'static Client {
    EXTERNAL_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(50))
            .build()
            .expect("Failed to build external reqwest client")
    })
}

/// 对已毒化的 Mutex 恢复：取回内部值继续使用，避免先开软件再开游戏时一直 PoisonError。
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn get_auth_pair() -> Result<(String, String), String> {
    let auth = AUTH.get_or_init(|| Mutex::new((String::new(), String::new())));
    let mut guard = lock_or_recover(auth);
    if guard.0.is_empty() || guard.1.is_empty() {
        let (token, port) = get_auth()?;
        *guard = (token.clone(), port.clone());
        return Ok((token, port));
    }
    Ok(guard.clone())
}

fn refresh_auth() -> Result<(String, String), String> {
    let last_refresh = LAST_REFRESH_TIME.get_or_init(|| Mutex::new(Instant::now()));
    let mut last_refresh_guard = lock_or_recover(last_refresh);

    let now = Instant::now();
    if now.duration_since(*last_refresh_guard) < Duration::from_secs(1) {
        let auth = AUTH.get().expect("AUTH not initialized");
        let auth_guard = lock_or_recover(auth);
        return Ok(auth_guard.clone());
    }

    *last_refresh_guard = now;

    let (token, port) = get_auth()?;
    let auth = AUTH.get_or_init(|| Mutex::new((String::new(), String::new())));
    let mut guard = lock_or_recover(auth);
    *guard = (token.clone(), port.clone());
    Ok((token, port))
}
fn build_url(token: &str, uri: &str, port: &str) -> String {
    let uri = uri.trim_start_matches('/');
    format!("https://riot:{}@127.0.0.1:{}/{}", token, port, uri)
}

/// 内部：发起真实 HTTP GET 请求，返回原始 JSON 字符串。
async fn lcu_get_raw(uri: &str) -> Result<String, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        log::debug!("LCU GET URL: {}", url);
        let resp = get_client().get(&url).send().await;
        match resp {
            Ok(r) if r.status() == StatusCode::OK => {
                let text = r.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
                return Ok(text);
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("请求失败或认证失效".to_string())
}

/// 将 LCU 响应体反序列化为 `T`，**把空 body 当作 JSON `null`**。
///
/// LCU 的动作类接口（接受对局 `ready-check/accept`、选英雄 `patch_session_action`
/// 等）成功时返回 `204 No Content` 空 body。直接拿空字符串喂 `serde_json` 会得到
/// “EOF while parsing a value at line 1 column 0”，导致**已成功**的操作被误报为
/// 反序列化失败并上报。把空/纯空白 body 归一成 `null`，使 `T = ()` / `Option<_>`
/// 等正常反序列化；非空 body 照常解析、坏数据照常报错。
fn deserialize_lcu_body<T: DeserializeOwned>(body: &str) -> Result<T, String> {
    let trimmed = body.trim();
    let json = if trimmed.is_empty() { "null" } else { trimmed };
    serde_json::from_str::<T>(json).map_err(|e| format!("反序列化失败: {}", e))
}

/// 向 LCU 发起 GET 请求，将响应 JSON 反序列化为 `T`。
/// 内置 singleflight（相同 URI 并发请求合并）和并发限制（最多 10 个同时请求）。
pub async fn lcu_get<T: DeserializeOwned + 'static>(uri: &str) -> Result<T, String> {
    let uri_owned = uri.to_string();

    // singleflight：相同 URI 的并发请求只发一次
    let raw_json = SINGLEFLIGHT
        .try_get_with(uri_owned.clone(), async {
            // 获取 semaphore permit（限制并发数）
            let _permit = LCU_SEMAPHORE
                .acquire()
                .await
                .map_err(|e| format!("Semaphore error: {}", e))?;

            lcu_get_raw(&uri_owned).await
        })
        .await
        .map_err(|e| format!("{}", e))?;

    // 从 JSON 字符串反序列化为目标类型（空 body 归一成 null，见 deserialize_lcu_body）
    deserialize_lcu_body::<T>(&raw_json)
}

/// 向 LCU 发起 POST 请求，请求体为 JSON。失败时刷新认证并重试一次。
pub async fn lcu_post<T: DeserializeOwned, D: Serialize>(uri: &str, data: &D) -> Result<T, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        let resp = get_client().post(&url).json(data).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                // 动作类接口常返回 204 空 body：先取文本，空 body 归一成 null。
                let body = r.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
                return deserialize_lcu_body::<T>(&body);
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("POST请求失败或认证失效".to_string())
}

/// 向 LCU 发起 PATCH 请求，请求体为 JSON。失败时刷新认证并重试一次。
pub async fn lcu_patch<T: DeserializeOwned, D: Serialize>(
    uri: &str,
    data: &D,
) -> Result<T, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        let resp = get_client().patch(&url).json(data).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                // 动作类接口常返回 204 空 body：先取文本，空 body 归一成 null。
                let body = r.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
                return deserialize_lcu_body::<T>(&body);
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("PATCH请求失败或认证失效".to_string())
}

/// 请求 LCU 图片资源并返回 Data URL（data:content-type;base64,...）。
pub async fn lcu_get_img_as_base64(uri: &str) -> Result<String, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        let resp = get_client().get(&url).send().await;
        match resp {
            Ok(r) if r.status() == StatusCode::OK => {
                let content_type = r
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/png")
                    .to_string();
                let bytes = r
                    .bytes()
                    .await
                    .map_err(|e| format!("读取图片失败: {}", e))?;
                let base64_str = general_purpose::STANDARD.encode(&bytes);
                return Ok(format!("data:{};base64,{}", content_type, base64_str));
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("图片请求失败或认证失效".to_string())
}

/// 请求 LCU 图片资源并返回原始字节与 Content-Type。
pub async fn lcu_get_img_as_binary(uri: &str) -> Result<(Vec<u8>, String), String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        log::debug!("LCU GET Binary URL: {}", url);
        let resp = get_client().get(&url).send().await;
        match resp {
            Ok(r) if r.status() == StatusCode::OK => {
                let content_type = r
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/png")
                    .to_string();
                let bytes = r
                    .bytes()
                    .await
                    .map_err(|e| format!("读取图片失败: {}", e))?
                    .to_vec();
                return Ok((bytes, content_type));
            }
            _ => {
                if let Err(e) = refresh_auth() {
                    log::info!("刷新LCU认证失败（可先打开游戏再重试）: {}", e);
                }
            }
        }
    }
    Err("图片二进制请求失败或认证失效".to_string())
}

/// 外部 HTTP GET + JSON 反序列化（不走 LCU 认证/限流，用于 CommunityDragon 等公开资源）
pub async fn external_get_json<T: DeserializeOwned>(url: &str) -> Result<T, String> {
    let resp = external_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("external GET failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("external GET non-2xx: {}", resp.status()));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("external JSON 反序列化失败: {}", e))
}

/// SGP（腾讯跨区网关）专用 HTTP 客户端。
///
/// 与 LCU 客户端（[`get_client`]，`danger_accept_invalid_certs`）**刻意隔离**：SGP
/// 主机是 `lol.qq.com` 的有效公网证书，必须**正常校验 TLS**，绝不能忽略证书。
static SGP_CLIENT: OnceLock<Client> = OnceLock::new();

/// 拟真客户端 UA。SGP 网关会校验 UA，缺失/异常可能被拒；沿用 LeagueAkari 给 SGP
/// 请求固定设置的形态（已随 match-history 请求真机验证可用）。
const SGP_USER_AGENT: &str = "LeagueOfLegendsClient/15.0.0.0 (rcp-be-lol-match-history)";

fn sgp_client() -> &'static Client {
    SGP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("Failed to build SGP reqwest client")
    })
}

/// 向 **Riot Client** 本地 API 发起 GET 并反序列化为 `T`（自签证书 + Basic 鉴权）。
///
/// Riot Client 与 LeagueClient(LCU) 是两个不同的本地服务；全区 `name#TAG → puuid`
/// 的 `player-account/aliases` 查询只在 RC 端口可用。认证 `(token, port)` 由
/// [`crate::lcu::util::token::get_riot_client_auth`] 从 LCU 命令行提取。复用 LCU 的
/// [`get_client`]（已 `danger_accept_invalid_certs`，本地自签证书）。
pub async fn riot_client_get<T: DeserializeOwned>(
    port: &str,
    token: &str,
    uri: &str,
) -> Result<T, String> {
    let uri = uri.trim_start_matches('/');
    let url = format!("https://riot:{}@127.0.0.1:{}/{}", token, port, uri);
    let resp = get_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Riot Client 请求失败: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取 Riot Client 响应失败: {}", e))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(150).collect();
        return Err(format!("Riot Client 非 2xx（{}）: {}", status, snippet));
    }
    serde_json::from_str::<T>(&body).map_err(|e| format!("Riot Client 反序列化失败: {}", e))
}

/// 向腾讯 SGP 网关发起带 Bearer 鉴权的 GET，并反序列化为 `T`。
///
/// # 参数
/// - `host`: 目标大区 SGP 主机（含端口，如 `tj100-sgp.lol.qq.com:21019`，见
///   [`crate::constant::game::get_sgp_host`]）
/// - `uri`: 端点路径（相对，如 `match-history-query/v1/...`）
/// - `bearer`: 鉴权 token（战绩用 LCU `entitlements/v1/token` 的 `accessToken`）
///
/// 正常 TLS + 拟真 UA。非 2xx 时把状态码与截断的 body 一并返回，便于区分
/// 「网络/证书失败」「token 失效(401)」「玩家/大区不存在」。
pub async fn sgp_get<T: DeserializeOwned>(
    host: &str,
    uri: &str,
    bearer: &str,
) -> Result<T, String> {
    let uri = uri.trim_start_matches('/');
    let url = format!("https://{}/{}", host, uri);
    let resp = sgp_client()
        .get(&url)
        .bearer_auth(bearer)
        .header(reqwest::header::USER_AGENT, SGP_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("SGP 请求失败（网络/TLS）: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取 SGP 响应失败: {}", e))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(200).collect();
        return Err(format!("SGP 非 2xx（{}）: {}", status, snippet));
    }
    serde_json::from_str::<T>(&body).map_err(|e| format!("SGP 反序列化失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 复现根因：LCU 的动作类接口（接受对局 / 选英雄等）成功时返回 204 空 body，
    /// 直接拿空字符串喂 serde_json 会得到 “EOF while parsing a value”。
    #[test]
    fn empty_body_breaks_raw_serde_json() {
        let err = serde_json::from_str::<()>("").unwrap_err();
        assert!(err.to_string().contains("EOF"), "实际错误: {err}");
    }

    #[test]
    fn deserialize_body_treats_empty_as_unit() {
        // 接受对局成功（204 空 body），T = ()，应当成功而非报反序列化失败。
        deserialize_lcu_body::<()>("").expect("空 body 应反序列化为 ()");
    }

    #[test]
    fn deserialize_body_treats_whitespace_as_unit() {
        deserialize_lcu_body::<()>("  \n ").expect("纯空白 body 应反序列化为 ()");
    }

    #[test]
    fn deserialize_body_empty_option_is_none() {
        let v: Option<i32> = deserialize_lcu_body("").expect("空 body 应反序列化为 None");
        assert_eq!(v, None);
    }

    #[test]
    fn deserialize_body_still_parses_non_empty_json() {
        let v: Vec<i32> = deserialize_lcu_body("[1,2,3]").expect("非空 JSON 应正常解析");
        assert_eq!(v, vec![1, 2, 3]);
    }

    #[test]
    fn deserialize_body_reports_malformed_json() {
        // 非空但不是合法 JSON 时仍应报错（不要把坏数据吞成默认值）。
        assert!(deserialize_lcu_body::<Vec<i32>>("{not json").is_err());
    }
}
