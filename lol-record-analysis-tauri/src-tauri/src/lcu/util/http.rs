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
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(50))
            .build()
            .expect("Failed to build reqwest client")
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

    // 从 JSON 字符串反序列化为目标类型
    serde_json::from_str::<T>(&raw_json).map_err(|e| format!("反序列化失败: {}", e))
}

/// 向 LCU 发起 POST 请求，请求体为 JSON。失败时刷新认证并重试一次。
pub async fn lcu_post<T: DeserializeOwned, D: Serialize>(uri: &str, data: &D) -> Result<T, String> {
    for _ in 0..2 {
        let (token, port) = get_auth_pair().map_err(|e| format!("LCU认证失败: {}", e))?;
        let url = build_url(&token, uri, &port);
        let resp = get_client().post(&url).json(data).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let data = r
                    .json::<T>()
                    .await
                    .map_err(|e| format!("反序列化失败: {}", e))?;
                return Ok(data);
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
                let data = r
                    .json::<T>()
                    .await
                    .map_err(|e| format!("反序列化失败: {}", e))?;
                return Ok(data);
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
