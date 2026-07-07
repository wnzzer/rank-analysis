//! Supabase 云同步：匿名会话管理 + sync_data 表读写 + 导入导出文件 IO
//!
//! 身份模型：每台设备一个匿名 Supabase 账号，只用于写入溯源（RLS「谁写的谁能改」），
//! 不承担跨设备身份识别；跨设备找回数据按 puuid 查询所有设备的行，前端合并。

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config::{self, Value};

/// Supabase 项目地址（东南亚节点，2026-07 创建）
const SUPABASE_URL: &str = "https://agutdvbhkhxzngscdlsh.supabase.co";
/// 可公开 key（新版 publishable 格式，等价旧 anon key）——权限由服务端 RLS 兜底，
/// 硬编码提交是 Supabase 官方推荐用法，不是泄密
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_ksZfyme84izJY9oTWC4VOw_l9OBXWBp";

/// 会话在 config.yaml 里的存储键（序列化为 JSON 字符串存 Value::String）
const SESSION_CONFIG_KEY: &str = "cloudSyncSession";
/// 云端行的数据类型标识，v1 只有玩家备注
const DATA_TYPE_NOTES: &str = "playerNotes";
/// access_token 过期前多少秒就触发刷新（留网络往返余量）
const REFRESH_MARGIN_SECS: u64 = 60;

static HTTP: OnceLock<Client> = OnceLock::new();

/// 云同步专用 HTTP client：正常 TLS 校验（区别于 LCU client 的自签名豁免）
fn http() -> &'static Client {
    HTTP.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("Failed to build cloud sync http client")
    })
}

/// Supabase 匿名会话（持久化到 config，跨启动复用同一账号）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CloudSession {
    access_token: String,
    refresh_token: String,
    /// Supabase 用户 UUID，即云端行的 owner_id
    user_id: String,
    /// access_token 过期时刻（unix 秒）
    expires_at: u64,
}

/// GoTrue /signup 与 /token 响应的公共字段
#[derive(Debug, Deserialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user: AuthUser,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// access_token 是否临近过期需要刷新
fn needs_refresh(expires_at: u64, now: u64) -> bool {
    now + REFRESH_MARGIN_SECS >= expires_at
}

impl CloudSession {
    fn from_auth(resp: AuthResponse) -> Self {
        Self {
            access_token: resp.access_token,
            refresh_token: resp.refresh_token,
            user_id: resp.user.id,
            expires_at: now_unix() + resp.expires_in,
        }
    }
}

/// 从 config 读持久化会话，没有或解析失败返回 None
async fn load_session() -> Option<CloudSession> {
    match config::get_config(SESSION_CONFIG_KEY).await {
        Ok(Value::String(s)) => serde_json::from_str(&s).ok(),
        _ => None,
    }
}

async fn save_session(session: &CloudSession) -> Result<(), String> {
    let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
    config::put_config(SESSION_CONFIG_KEY.to_string(), Value::String(json)).await
}

/// 匿名注册一个新 Supabase 账号
async fn sign_in_anonymously() -> Result<CloudSession, String> {
    let resp = http()
        .post(format!("{SUPABASE_URL}/auth/v1/signup"))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("匿名登录失败: HTTP {}", resp.status()));
    }
    let auth: AuthResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CloudSession::from_auth(auth))
}

/// 用 refresh_token 换新 access_token
async fn refresh_session(refresh_token: &str) -> Result<CloudSession, String> {
    let resp = http()
        .post(format!(
            "{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
        ))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("会话刷新失败: HTTP {}", resp.status()));
    }
    let auth: AuthResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CloudSession::from_auth(auth))
}

/// 取可用会话：无会话→匿名注册；临过期→刷新；刷新失败→重新匿名注册（旧行仍可读到）
async fn ensure_session() -> Result<CloudSession, String> {
    let session = match load_session().await {
        Some(s) if !needs_refresh(s.expires_at, now_unix()) => return Ok(s),
        Some(s) => match refresh_session(&s.refresh_token).await {
            Ok(fresh) => fresh,
            // refresh_token 失效（被回收/项目重置）：放弃旧账号重新注册。
            // 旧账号写的行不再可写，但 select 全开放，pull 合并仍能读回其数据。
            Err(_) => sign_in_anonymously().await?,
        },
        None => sign_in_anonymously().await?,
    };
    save_session(&session).await?;
    Ok(session)
}

/// 拉取云端某 puuid 下所有设备的备注 payload 列表（前端负责合并）
///
/// # 参数
/// - `puuid`: 召唤师 PUUID
///
/// # 返回值
/// - `Ok(Vec<Value>)`: 各设备写入的 payload 列表（可能为空）
/// - `Err(String)`: 网络失败或非 2xx 响应
#[tauri::command]
pub async fn cloud_pull_notes(puuid: String) -> Result<Vec<serde_json::Value>, String> {
    let session = ensure_session().await?;
    let url = format!(
        "{SUPABASE_URL}/rest/v1/sync_data?puuid=eq.{puuid}&data_type=eq.{DATA_TYPE_NOTES}&select=payload"
    );
    let resp = http()
        .get(url)
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("拉取失败: HTTP {}", resp.status()));
    }
    #[derive(Deserialize)]
    struct Row {
        payload: serde_json::Value,
    }
    let rows: Vec<Row> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| r.payload).collect())
}

/// 把本设备合并后的完整备注表 upsert 到自己的行
///
/// # 参数
/// - `puuid`: 召唤师 PUUID
/// - `payload`: 合并后的完整备注 JSON
///
/// # 返回值
/// - `Ok(())`: 推送成功
/// - `Err(String)`: 网络失败或非 2xx 响应
#[tauri::command]
pub async fn cloud_push_notes(puuid: String, payload: serde_json::Value) -> Result<(), String> {
    let session = ensure_session().await?;
    let url = format!("{SUPABASE_URL}/rest/v1/sync_data?on_conflict=owner_id,puuid,data_type");
    let body = json!([{
        "owner_id": session.user_id,
        "puuid": puuid,
        "data_type": DATA_TYPE_NOTES,
        "payload": payload,
    }]);
    let resp = http()
        .post(url)
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("推送失败: HTTP {}", resp.status()));
    }
    Ok(())
}

/// 把文本写入用户经系统对话框选定的路径（导出备份用，路径来自 plugin-dialog）
///
/// # 参数
/// - `path`: 目标文件路径
/// - `content`: 待写入的文本内容
#[tauri::command]
pub async fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取用户经系统对话框选定的文本文件（导入备份用）
///
/// # 参数
/// - `path`: 待读取文件路径
///
/// # 返回值
/// - `Ok(String)`: 文件文本内容
/// - `Err(String)`: 读取失败（文件不存在/权限/编码问题）
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_refresh_when_within_margin() {
        assert!(needs_refresh(100, 50)); // 50 + 60 >= 100
        assert!(needs_refresh(100, 100));
    }

    #[test]
    fn should_not_refresh_when_fresh() {
        assert!(!needs_refresh(1000, 100)); // 100 + 60 < 1000
    }

    #[test]
    fn session_serde_roundtrip() {
        let s = CloudSession {
            access_token: "a".into(),
            refresh_token: "r".into(),
            user_id: "u".into(),
            expires_at: 42,
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: CloudSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_id, "u");
        assert_eq!(back.expires_at, 42);
    }
}
