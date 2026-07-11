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

/// 把会话序列化为 JSON 字符串，持久化到 config（键 [`SESSION_CONFIG_KEY`]）
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
/// - `Err(String)`: puuid 格式非法、网络失败或非 2xx 响应
#[tauri::command]
pub async fn cloud_pull_notes(puuid: String) -> Result<Vec<serde_json::Value>, String> {
    // puuid 要拼进 PostgREST 查询串：命令边界的不信任输入，限定 UUID 字符集防注入。
    // 正常路径 puuid 来自 LCU，恒为 UUID 格式，不受影响。
    if !puuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("puuid 格式非法".to_string());
    }
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

/// 云端配置行的数据类型标识
const DATA_TYPE_CONFIG: &str = "appConfig";

/// 云端配置行 payload:`updatedAt` 放 payload 内而非依赖数据库列,
/// 免去 sync_data 表结构迁移;毫秒时间戳由推送方(本地时钟)盖。
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigPayload {
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    pub config: std::collections::HashMap<String, crate::config::Value>,
}

/// 从多设备的 appConfig payload 行里挑 updatedAt 最大的一份。
///
/// 云端行任何人可写,逐行当不可信输入:反序列化失败的行直接跳过;
/// 解析成功后再按云端黑名单剔键(防脏 payload 夹带 cloudSyncSession 等)。
fn pick_latest_config(rows: Vec<serde_json::Value>) -> Option<ConfigPayload> {
    rows.into_iter()
        .filter_map(|v| serde_json::from_value::<ConfigPayload>(v).ok())
        .max_by_key(|p| p.updated_at)
        .map(|mut p| {
            p.config.retain(|k, _| crate::config::allowed_in_cloud(k));
            p
        })
}

/// 拉取云端最新一份配置(所有设备行中 updatedAt 最大者);云端无配置返回 None
#[tauri::command]
pub async fn cloud_pull_config(puuid: String) -> Result<Option<ConfigPayload>, String> {
    if !puuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("puuid 格式非法".to_string());
    }
    let session = ensure_session().await?;
    let url = format!(
        "{SUPABASE_URL}/rest/v1/sync_data?puuid=eq.{puuid}&data_type=eq.{DATA_TYPE_CONFIG}&select=payload"
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
    Ok(pick_latest_config(
        rows.into_iter().map(|r| r.payload).collect(),
    ))
}

/// 把本机云同步口径快照推送到本设备的 appConfig 行。
///
/// 快照在 Rust 侧现取现滤——前端无法传入自定义 payload,杜绝绕过黑名单。
#[tauri::command]
pub async fn cloud_push_config(puuid: String) -> Result<(), String> {
    let session = ensure_session().await?;
    let payload = ConfigPayload {
        updated_at: now_unix() * 1000,
        config: crate::config::config_snapshot(true).await,
    };
    let url = format!("{SUPABASE_URL}/rest/v1/sync_data?on_conflict=owner_id,puuid,data_type");
    let body = json!([{
        "owner_id": session.user_id,
        "puuid": puuid,
        "data_type": DATA_TYPE_CONFIG,
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

/// 前端做"云端 vs 本地"内容比对用的本地快照(云同步口径,已过滤,无敏感键)
#[tauri::command]
pub async fn get_cloud_config_snapshot(
) -> Result<std::collections::HashMap<String, crate::config::Value>, String> {
    Ok(crate::config::config_snapshot(true).await)
}

/// 应用一份外来配置快照(云端拉取确认后 / 备份文件导入确认后)
#[tauri::command]
pub async fn apply_config_snapshot(
    snapshot: std::collections::HashMap<String, crate::config::Value>,
) -> Result<(), String> {
    crate::config::apply_config_snapshot_map(snapshot).await
}

/// 导出 v2 全量备份文件:{version, type, exportedAt, playerNotes, appConfig}。
///
/// appConfig 用文件口径快照(含 dashscopeApiKey——文件由用户自己保管);
/// playerNotes 从 config 读出并解掉 `{value:...}` 包装,与前端 importNotes
/// 期望的裸 PlayerNotesMap 形状一致。
#[tauri::command]
pub async fn export_backup(path: String) -> Result<(), String> {
    validate_backup_path(&path)?;
    let notes = match crate::config::get_config("playerNotes").await? {
        crate::config::Value::Map(m) => m
            .get("value")
            .cloned()
            .unwrap_or(crate::config::Value::Map(std::collections::HashMap::new())),
        _ => crate::config::Value::Map(std::collections::HashMap::new()),
    };
    let backup = json!({
        "version": 2,
        "type": "rank-analysis-backup",
        "exportedAt": now_unix() * 1000,
        "playerNotes": notes,
        "appConfig": crate::config::config_snapshot(false).await,
    });
    let content = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败 {path}: {e}"))
}

/// 备份文件大小上限（字节）：备注备份远小于此，超限说明选错了文件
const MAX_BACKUP_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// 校验备份文件路径：只允许 `.json` 扩展名（不区分大小写）
///
/// # 防御意图
///
/// 这两个文件命令暴露给 webview，若前端被注入（本应用 CSP 宽松且存在 v-html
/// 渲染远程内容的面板），`read_text_file` + `cloud_push_notes` 可组合成
/// 「读任意本地文件 → 外传云端」的攻击链。限定 `.json` 扩展名把「任意文件
/// 读写原语」收敛为「仅备份文件读写」，正常导入导出流程（plugin-dialog 过滤
/// `.json`）完全不受影响。
fn validate_backup_path(path: &str) -> Result<(), String> {
    if path.to_lowercase().ends_with(".json") {
        Ok(())
    } else {
        Err("仅支持 .json 备份文件".to_string())
    }
}

/// 把文本写入用户经系统对话框选定的路径（导出备份用，路径来自 plugin-dialog）
///
/// # 参数
/// - `path`: 目标文件路径（必须以 `.json` 结尾，见 [`validate_backup_path`]）
/// - `content`: 待写入的文本内容
#[tauri::command]
pub async fn save_text_file(path: String, content: String) -> Result<(), String> {
    validate_backup_path(&path)?;
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败 {path}: {e}"))
}

/// 读取用户经系统对话框选定的文本文件（导入备份用）
///
/// # 参数
/// - `path`: 待读取文件路径（必须以 `.json` 结尾，见 [`validate_backup_path`]）
///
/// # 返回值
/// - `Ok(String)`: 文件文本内容
/// - `Err(String)`: 路径非法、文件过大或读取失败（文件不存在/权限/编码问题）
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    validate_backup_path(&path)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件失败 {path}: {e}"))?;
    if meta.len() > MAX_BACKUP_FILE_SIZE {
        return Err("文件过大（>10MB），不是备份文件".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败 {path}: {e}"))
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
    fn should_accept_json_backup_path_case_insensitive() {
        assert!(validate_backup_path("C:\\backup\\notes.json").is_ok());
        assert!(validate_backup_path("/tmp/notes.JSON").is_ok());
        assert!(validate_backup_path("notes.Json").is_ok());
    }

    #[test]
    fn should_reject_non_json_backup_path() {
        assert!(validate_backup_path("C:\\Windows\\system32\\config\\SAM").is_err());
        assert!(validate_backup_path("/etc/passwd").is_err());
        assert!(validate_backup_path("notes.json.exe").is_err());
        assert!(validate_backup_path("notes.txt").is_err());
        assert!(validate_backup_path("").is_err());
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

    #[test]
    fn config_payload_serde_shape() {
        // 前端按 { updatedAt, config } 读取;serde rename 必须精确
        let mut cfg = std::collections::HashMap::new();
        cfg.insert(
            "theme".to_string(),
            crate::config::Value::String("dark".into()),
        );
        let p = ConfigPayload {
            updated_at: 1_783_700_000_000,
            config: cfg,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["updatedAt"], 1_783_700_000_000_u64);
        assert_eq!(json["config"]["theme"], "dark");
        let back: ConfigPayload = serde_json::from_value(json).unwrap();
        assert_eq!(back.updated_at, 1_783_700_000_000);
    }

    #[test]
    fn pick_latest_should_choose_max_updated_at_and_skip_malformed() {
        let rows = vec![
            serde_json::json!({ "updatedAt": 100, "config": { "theme": "light" } }),
            serde_json::json!(null),   // 云端脏数据
            serde_json::json!([1, 2]), // 云端脏数据
            serde_json::json!({ "updatedAt": 200, "config": { "theme": "dark" } }),
            serde_json::json!({ "config": {} }), // 缺 updatedAt
        ];
        let latest = pick_latest_config(rows).unwrap();
        assert_eq!(latest.updated_at, 200);
        assert!(matches!(
            latest.config.get("theme"),
            Some(crate::config::Value::String(s)) if s == "dark"
        ));
    }

    #[test]
    fn pick_latest_should_filter_cloud_blacklist_keys() {
        // 云端行任何人可写:payload 里混入黑名单键必须在解析时剔除
        let rows = vec![serde_json::json!({
            "updatedAt": 1,
            "config": { "theme": "dark", "cloudSyncSession": "evil", "dashscopeApiKey": "sk" }
        })];
        let latest = pick_latest_config(rows).unwrap();
        assert!(latest.config.contains_key("theme"));
        assert!(!latest.config.contains_key("cloudSyncSession"));
        assert!(!latest.config.contains_key("dashscopeApiKey"));
    }

    #[test]
    fn pick_latest_should_return_none_when_all_malformed() {
        assert!(pick_latest_config(vec![serde_json::json!("junk")]).is_none());
        assert!(pick_latest_config(vec![]).is_none());
    }
}
