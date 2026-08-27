//! # 配置管理模块
//!
//! 提供应用程序配置的持久化存储和缓存管理。
//!
//! ## 主要功能
//!
//! - **配置缓存**: 使用 Moka 缓存实现高性能的配置读取
//! - **YAML 持久化**: 配置数据以 YAML 格式存储在本地文件
//! - **变更回调**: 支持注册配置变更监听器
//! - **类型安全**: 支持多种数据类型的配置值
//!
//! ## 架构
//!
//! ```text
//! Config Cache (Moka)
//!     ├── Memory Cache (TTL)
//!     └── YAML File (config.yaml)
//!
//! Callback System
//!     └── ON_CHANGE_CALLBACK_ARR
//!         └── Vec<ConfigCallback>
//! ```
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 初始化配置缓存
//! init_config().await?;
//!
//! // 读取配置
//! let value = get_config("settings.theme").await?;
//!
//! // 写入配置
//! put_config("settings.theme".to_string(), Value::String("dark".to_string())).await?;
//!
//! // 注册变更回调
//! register_on_change_callback(|key, value| {
//!     println!("Config changed: {} = {:?}", key, value);
//! });
//! ```

use moka::future::Cache;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::sync::OnceCell;

/// 配置值的枚举类型，支持多种数据类型。
///
/// # 变体说明
///
/// - `Null`: 空值
/// - `String`: 字符串值
/// - `Integer`: 整数值 (i64)
/// - `Float`: 浮点数值 (f64)
/// - `Boolean`: 布尔值
/// - `List`: 列表（数组）
/// - `Map`: 键值对映射
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum Value {
    /// 空值类型
    Null,
    /// 字符串类型
    String(String),
    /// 整数类型
    Integer(i64),
    /// 浮点数类型
    Float(f64),
    /// 布尔类型
    Boolean(bool),
    /// 列表类型
    List(Vec<Value>),
    /// 映射类型
    Map(HashMap<String, Value>),
}

/// 配置变更回调函数类型。
///
/// 参数:
/// - `&str`: 变更的配置键
/// - `&Value`: 新的配置值
///
/// 用 `Arc` 包装是为了在触发回调前能克隆整份列表并释放锁：回调体内可能再次
/// 读写配置（如自动化模块热更新后回读），持锁调用会在同一把 Mutex 上自锁。
type ConfigCallback = Arc<dyn Fn(&str, &Value) + Send + Sync>;

/// 回调函数列表类型，使用 Mutex 保证线程安全。
type CallbackList = Mutex<Vec<ConfigCallback>>;

/// 配置文件的绝对路径（由 [`crate::paths`] 按平台解析）。
///
/// 这里刻意**不是**常量字符串：曾经是 `"config.yaml"` 这种 CWD 相对路径，落点随启动
/// 方式漂移——macOS 上由 Finder 拉起时 CWD 为只读的 `/`，配置读不到也写不进。
fn config_path() -> std::path::PathBuf {
    crate::paths::config_file()
}

/// 全局配置变更回调列表。
///
/// 使用 `LazyLock` 实现线程安全的懒加载初始化。
static ON_CHANGE_CALLBACK_ARR: LazyLock<CallbackList> = LazyLock::new(|| Mutex::new(Vec::new()));

/// 全局配置缓存实例。
///
/// 使用 `OnceCell` 确保只初始化一次，提供异步安全的单例模式。
static CACHE: OnceCell<Cache<String, Value>> = OnceCell::const_new();

/// 获取全局配置缓存实例。
///
/// 如果缓存尚未初始化，会自动从配置文件加载数据并初始化缓存。
///
/// # 返回值
///
/// 返回全局配置缓存的静态引用。
///
/// # 初始化流程
///
/// 1. 检查缓存是否已初始化
/// 2. 如果未初始化，读取 `config.yaml` 文件
/// 3. 将所有配置项加载到缓存中
/// 4. 返回缓存实例
///
/// # 示例
///
/// ```rust,ignore
/// let cache = get_cache().await;
/// ```
pub async fn get_cache() -> &'static Cache<String, Value> {
    CACHE
        .get_or_init(|| async {
            log::info!("Initializing config cache...");
            let cache = Cache::builder().build();

            let path = config_path();
            match read_config(&path) {
                Ok(config) => {
                    log::info!(
                        "Loaded {} config entries from {}",
                        config.len(),
                        path.display()
                    );
                    for (k, v) in config {
                        // 在 async 块中可以自由 .await
                        cache.insert(k.clone(), v.clone()).await;
                        log::debug!("Config loaded: {} = {:?}", k, v);
                    }
                }
                // 文件不存在是首次运行的正常情况（全新安装 / 换了新机器），不该报 error：
                // error 级日志会被转发成 Sentry 事件，每个新用户都刷一条纯噪音。
                Err(e) if is_not_found(e.as_ref()) => {
                    log::info!("配置文件尚不存在，按默认值启动: {}", path.display());
                }
                Err(e) => {
                    log::error!("Failed to load config from {}: {}", path.display(), e);
                    quarantine_corrupt_config(&path, &e.to_string());
                }
            }
            log::info!("Config cache initialized");
            cache
        })
        .await
}

/// 注册配置变更回调函数。
///
/// 当配置值通过 `put_config` 修改时，所有注册的回调函数都会被调用。
///
/// # 参数
///
/// - `callback`: 回调函数，接收配置键和新值作为参数
///
/// # 示例
///
/// ```rust,ignore
/// register_on_change_callback(|key, value| {
///     log::info!("Config changed: {} = {:?}", key, value);
/// });
/// ```
pub fn register_on_change_callback<F>(callback: F)
where
    F: Fn(&str, &Value) + Send + Sync + 'static,
{
    ON_CHANGE_CALLBACK_ARR
        .lock()
        .unwrap()
        .push(Arc::new(callback));
}

/// 触发所有配置变更回调。
///
/// 先把列表克隆成 `Vec<ConfigCallback>`（Arc 计数拷贝，廉价）再释放锁逐个调用：
/// 回调体内可能再次读写配置或注册新回调，若持锁调用会在同一把 Mutex 上自锁。
fn fire_change_callbacks(key: &str, value: &Value) {
    let callbacks = ON_CHANGE_CALLBACK_ARR.lock().unwrap().clone();
    for callback in callbacks {
        callback(key, value);
    }
}

/// 初始化配置缓存。
///
/// 从配置文件加载所有配置项到内存缓存中。
///
/// # 返回值
///
/// - `Ok(())`: 初始化成功（或配置文件不存在）
/// - `Err(...)`: 读取配置文件时发生错误
///
/// # 注意
///
/// 此方法通常在应用程序启动时调用一次。后续配置访问应使用 `get_cache()` 或 `get_config()`。
pub async fn init_config() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match read_config(&config_path()) {
        Ok(config) => {
            for (key, value) in config {
                get_cache().await.insert(key, value).await;
            }
        }
        Err(e) => eprintln!("Failed to load config: {}", e),
    }
    Ok(())
}

/// 从文件读取配置。
///
/// 内部辅助函数，从 YAML 文件解析配置数据。
///
/// # 参数
///
/// - `path`: 配置文件路径
///
/// # 返回值
///
/// - `Ok(HashMap)`: 成功解析的配置映射
/// - `Err(...)`: 文件读取或解析错误
fn read_config(
    path: &std::path::Path,
) -> Result<HashMap<String, Value>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let config: HashMap<String, Value> = serde_yaml::from_reader(reader)?;
    Ok(config)
}

/// 判断读配置的错误是否为「文件不存在」。
///
/// 首次运行没有配置文件是正常的，需要与「文件损坏 / 无权限」区分开，避免把正常情况
/// 记成 error（进而变成 Sentry 噪音）。
fn is_not_found(err: &(dyn std::error::Error + Send + Sync + 'static)) -> bool {
    err.downcast_ref::<std::io::Error>()
        .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound)
}

/// 把损坏的配置文件改名留存为 `config.yaml.corrupt-<unix秒>`。
///
/// 解析失败说明文件已损坏；若不挪走，下一次成功写入会覆盖掉唯一的现场，
/// 用户的全部设置就真的找不回来了。留存后按默认值启动，用户可人工恢复。
fn quarantine_corrupt_config(path: &std::path::Path, reason: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut os = path.as_os_str().to_os_string();
    os.push(format!(".corrupt-{}", stamp));
    let backup = std::path::PathBuf::from(os);
    match std::fs::rename(path, &backup) {
        Ok(()) => log::warn!(
            "已将损坏的配置文件留存为 {}（原因: {}），可人工找回其中的设置",
            backup.display(),
            reason
        ),
        Err(e) => log::warn!("留存损坏配置文件失败（{}）: {}", backup.display(), e),
    }
}

/// 将配置写入文件。
///
/// 内部辅助函数，将当前缓存中的所有配置持久化到 YAML 文件。
///
/// # 返回值
///
/// - `Ok(())`: 写入成功
/// - `Err(...)`: 文件写入错误
async fn write_config() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config: HashMap<String, Value> = get_cache()
        .await
        .iter()
        .map(|(k, v)| (k.as_ref().clone(), v.clone()))
        .collect();
    write_config_to(&config_path(), &config)
}

/// 把一份配置写到指定路径，父目录不存在则先创建。
///
/// 与 [`write_config`] 拆开是为了可测：写入才是 macOS 上真正失败的那条路径
/// （目录不存在 + CWD 只读），必须有回归测试盯着，而 [`write_config`] 依赖全局缓存
/// 单例、不适合在并行测试里碰。
fn write_config_to(
    path: &std::path::Path,
    config: &HashMap<String, Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // macOS 首次写入时 `~/Library/Application Support/<bundle id>` 还不存在，
    // 不先建目录 File::create 会直接失败。
    crate::paths::ensure_parent_dir(path)?;
    // 先整体序列化到内存：半截 YAML 比写失败更糟——启动解析失败会按空配置运行，
    // 用户全部设置等于丢失；序列化失败时旧文件保持原样。
    let mut body = Vec::new();
    serde_yaml::to_writer(&mut body, config)?;
    // 原子替换：先写同目录临时文件并 fsync，再 rename 覆盖目标。进程在写入中途
    // 被杀/断电时，最坏情况是留下一个 .tmp 残骸，config.yaml 本身始终完整。
    let mut tmp_os = path.as_os_str().to_os_string();
    tmp_os.push(".tmp");
    let tmp_path = std::path::PathBuf::from(tmp_os);
    {
        let mut tmp = BufWriter::new(File::create(&tmp_path)?);
        tmp.write_all(&body)?;
        tmp.flush()?;
        let file = tmp.into_inner().map_err(|e| e.into_error())?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// 根据配置键生成默认值。
///
/// 根据键名后缀推断合适的默认值类型：
/// - `*Switch` / `*Enabled`: 返回 `Boolean(false)`
/// - `*Slice` / `*List` / `*Array`: 返回空列表
/// - 其他: 返回空字符串
///
/// # 参数
///
/// - `key`: 配置键名
///
/// # 返回值
///
/// 根据键名推断的默认值
fn zero_value_for_key(key: &str) -> Value {
    if key.ends_with("Switch") || key.ends_with("Enabled") {
        Value::Boolean(false)
    } else if key.ends_with("Slice") || key.ends_with("List") || key.ends_with("Array") {
        Value::List(vec![])
    } else {
        // default to empty string for other scalar-like values
        Value::String(String::new())
    }
}

/// 从 Value 中提取布尔值。
///
/// 支持两种格式：
/// - 直接的 `Boolean` 变体
/// - 嵌套映射格式 `Map({"value": Boolean(...)})`
///
/// # 参数
///
/// - `value`: 要提取的配置值
///
/// # 返回值
///
/// - `Some(true/false)`: 成功提取布尔值
/// - `None`: 无法提取布尔值
///
/// # 示例
///
/// ```rust,ignore
/// let val = Value::Boolean(true);
/// assert_eq!(extract_bool(&val), Some(true));
///
/// let nested = Value::Map({
///     let mut m = HashMap::new();
///     m.insert("value".to_string(), Value::Boolean(false));
///     m
/// });
/// assert_eq!(extract_bool(&nested), Some(false));
/// ```
pub fn extract_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Boolean(b) => Some(*b),
        Value::Map(m) => {
            if let Some(Value::Boolean(b)) = m.get("value") {
                Some(*b)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 从配置 Value 中提取整数。
///
/// 前端 `putConfigByIpc` 一律写入 `Value::Map({"value": ...})`，本函数只认这一种格式。
pub fn extract_int(value: &Value) -> Option<i64> {
    if let Value::Map(m) = value {
        if let Some(Value::Integer(n)) = m.get("value") {
            return Some(*n);
        }
    }
    None
}

/// 从配置 Value 中提取字符串。
///
/// 与 [`extract_bool`] 一样容忍两种格式：前端 `putConfigByIpc` 写入的
/// `Value::Map({"value": String})`，以及后端直接写入的裸 `Value::String`。
/// 空字符串按"未设置"处理返回 `None`（避免把默认空串当成有效路径）。
pub fn extract_string(value: &Value) -> Option<String> {
    let s = match value {
        Value::String(s) => Some(s.clone()),
        Value::Map(m) => match m.get("value") {
            Some(Value::String(s)) => Some(s.clone()),
            _ => None,
        },
        _ => None,
    }?;
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// 同步读取布尔配置（启动期专用）。
///
/// 直接读取 `config.yaml`，**不经过** async 的 Moka 缓存层，因此可以在 Tauri
/// 运行时尚未启动、无 tokio runtime 的 `main()` 早期调用——例如在 `sentry::init`
/// 之前判断用户是否开启了错误上报。
///
/// # 参数
///
/// - `key`: 配置键名（如 `errorReportingEnabled`）
///
/// # 返回值
///
/// 配置中该键解析出的布尔值；文件不存在、键缺失或类型不符时返回 `false`。
pub fn read_bool_sync(key: &str) -> bool {
    read_config(&config_path())
        .ok()
        .and_then(|m| m.get(key).and_then(extract_bool))
        .unwrap_or(false)
}

/// 备份/同步黑名单:文件导出与云同步**都**排除的键。
///
/// 设备凭据(cloudSyncSession)、本机路径(gameInstallPath)、设备级开关与标记
/// (cloudSyncEnabled / 弹窗记录 / 同步标记)跨设备无意义甚至有害;playerNotes
/// 在备份文件里是独立顶层字段、在云端走独立合并通道,不进 appConfig 快照。
/// 新增敏感/设备级键时必须同步登记此表(黑名单制:漏登记 = 被同步出去)。
///
/// `cloudSyncNoticeShown` 对应的「云同步功能一次性告知」弹窗已在前端砍掉,
/// 新安装不会再写这个键;但已升级用户本地 config.yaml 里可能仍留有旧值,
/// 该键本质仍是设备级弹窗记录,继续留在黑名单里防止这个无意义的历史遗留
/// 布尔值被同步出去,不因为写入端消失就摘除。
pub const BACKUP_BLACKLIST: &[&str] = &[
    "cloudSyncSession",
    "gameInstallPath",
    "cloudSyncEnabled",
    "errorReportingConsentShown",
    "cloudSyncNoticeShown",
    "configSyncedOnce",
    "configLastSyncAt",
    "playerNotes",
];

/// 仅云端额外排除的键:云端按 puuid 寻址、任何人可读,API key 放上去等于公开;
/// 文件备份由用户自己保管,保留。
pub const CLOUD_ONLY_BLACKLIST: &[&str] = &["dashscopeApiKey", "ai.apiKey"];

/// 该键是否允许进入文件备份
pub fn allowed_in_backup(key: &str) -> bool {
    !BACKUP_BLACKLIST.contains(&key)
}

/// 该键是否允许上云
pub fn allowed_in_cloud(key: &str) -> bool {
    allowed_in_backup(key) && !CLOUD_ONLY_BLACKLIST.contains(&key)
}

/// 取黑名单过滤后的配置快照(值保持存储形状原样,含 `{value:...}` 包装)。
///
/// - `for_cloud = false`:文件备份口径(保留 dashscopeApiKey)
/// - `for_cloud = true`:云同步口径(额外剔除 CLOUD_ONLY_BLACKLIST)
///
/// 过滤收口在 Rust 侧:前端拿不到未过滤快照,杜绝前端漏过滤导致凭据外泄。
pub async fn config_snapshot(for_cloud: bool) -> HashMap<String, Value> {
    let allowed: fn(&str) -> bool = if for_cloud {
        allowed_in_cloud
    } else {
        allowed_in_backup
    };
    get_cache()
        .await
        .iter()
        .filter(|(k, _)| allowed(k.as_ref()))
        .map(|(k, v)| (k.as_ref().clone(), v.clone()))
        .collect()
}

/// 从外来快照中筛出允许写入本地的键值对(纯函数,供 apply 与单测共用)。
///
/// 拆出纯函数是为了可测性:apply 本体经 put_config 落盘,单测直接调用会
/// 重写真实 config.yaml,故只对过滤逻辑做单元覆盖。
fn filter_snapshot_for_apply(snapshot: HashMap<String, Value>) -> Vec<(String, Value)> {
    snapshot
        .into_iter()
        .filter(|(key, _)| allowed_in_backup(key))
        .collect()
}

/// 把一份外来快照(备份文件 appConfig / 云端 config)逐键写入本地配置。
///
/// 黑名单键即使出现在快照里也跳过(防云端脏数据/手改备份文件覆盖设备凭据);
/// 写入走 [`put_config_batch`] 批量落盘一次,自然触发变更回调(自动化模块热更新、
/// config-changed 事件),值按原样写入——快照里的值已是 `{value:...}` 存储形状,
/// 不重复包装。
pub async fn apply_config_snapshot_map(snapshot: HashMap<String, Value>) -> Result<(), String> {
    put_config_batch(filter_snapshot_for_apply(snapshot)).await
}

/// 从缓存获取配置值。
///
/// 如果键不存在，返回根据键名推断的默认值。
///
/// # 参数
///
/// - `key`: 配置键名
///
/// # 返回值
///
/// - `Ok(Value)`: 配置值或默认值
/// - `Err(String)`: 缓存访问错误
///
/// # 示例
///
/// ```rust,ignore
/// match get_config("settings.theme").await {
///     Ok(value) => println!("Theme: {:?}", value),
///     Err(e) => eprintln!("Error: {}", e),
/// }
/// ```
pub async fn get_config(key: &str) -> Result<Value, String> {
    match get_cache().await.get(key).await {
        Some(v) => {
            log::debug!("Config get: {} = {:?}", key, v);
            Ok(v)
        }
        None => {
            let zero_val = zero_value_for_key(key);
            log::debug!("Config get (default): {} = {:?}", key, zero_val);
            Ok(zero_val)
        }
    }
}

/// 设置配置值并持久化。
///
/// 将配置值写入缓存，触发所有变更回调，并保存到配置文件。
///
/// # 参数
///
/// - `key`: 配置键名
/// - `value`: 配置值
///
/// # 返回值
///
/// - `Ok(())`: 设置成功
/// - `Err(String)`: 写入文件时发生错误
///
/// # 副作用
///
/// - 更新内存缓存
/// - 触发所有注册的变更回调
/// - 写入 YAML 配置文件
///
/// # 示例
///
/// ```rust,ignore
/// put_config(
///     "settings.theme".to_string(),
///     Value::String("dark".to_string())
/// ).await?;
/// ```
pub async fn put_config(key: String, value: Value) -> Result<(), String> {
    get_cache().await.insert(key.clone(), value.clone()).await;
    // 先落盘成功再广播：写盘失败时前端不应收到「已变更」事件，
    // 否则云同步会按一个磁盘上并不存在的状态发起推送。
    write_config().await.map_err(|e| e.to_string())?;
    fire_change_callbacks(&key, &value);
    Ok(())
}

/// 批量写入多个配置键，只落盘一次。
///
/// 逐键走 [`put_config`] 会对每个键做一次全量 YAML 序列化 + 覆盖写（恢复 50 键
/// 的快照 = 50 次全量 I/O）；批量版先把全部键写入缓存，再统一落盘一次，
/// 回调仍逐键触发、时序不变。供快照恢复（[`apply_config_snapshot_map`]）等场景使用。
pub async fn put_config_batch(pairs: Vec<(String, Value)>) -> Result<(), String> {
    if pairs.is_empty() {
        return Ok(());
    }
    let cache = get_cache().await;
    for (key, value) in &pairs {
        cache.insert(key.clone(), value.clone()).await;
    }
    write_config().await.map_err(|e| e.to_string())?;
    for (key, value) in &pairs {
        fire_change_callbacks(key, value);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn should_extract_bool_from_boolean_value() {
        let value = Value::Boolean(true);
        assert_eq!(extract_bool(&value), Some(true));

        let value = Value::Boolean(false);
        assert_eq!(extract_bool(&value), Some(false));
    }

    #[test]
    fn should_extract_bool_from_map_value() {
        let mut map = HashMap::new();
        map.insert("value".to_string(), Value::Boolean(true));
        let value = Value::Map(map);
        assert_eq!(extract_bool(&value), Some(true));
    }

    #[test]
    fn should_return_none_for_non_boolean_value() {
        let value = Value::String("true".to_string());
        assert_eq!(extract_bool(&value), None);

        let value = Value::Integer(1);
        assert_eq!(extract_bool(&value), None);

        let value = Value::Null;
        assert_eq!(extract_bool(&value), None);
    }

    #[test]
    fn should_return_none_for_map_without_boolean() {
        let mut map = HashMap::new();
        map.insert("other".to_string(), Value::Boolean(true));
        let value = Value::Map(map);
        assert_eq!(extract_bool(&value), None);
    }

    #[test]
    fn should_extract_string_from_both_formats() {
        // 前端包装格式 Map{value: String}
        let mut map = HashMap::new();
        map.insert(
            "value".to_string(),
            Value::String(r"C:\WeGameApps\英雄联盟".to_string()),
        );
        assert_eq!(
            extract_string(&Value::Map(map)),
            Some(r"C:\WeGameApps\英雄联盟".to_string())
        );

        // 后端裸值格式 String
        assert_eq!(
            extract_string(&Value::String("D:\\LOL".to_string())),
            Some("D:\\LOL".to_string())
        );
    }

    #[test]
    fn should_return_none_for_empty_or_wrong_type_string() {
        // 空串按"未设置"处理（get_config 缺键时默认返回空串）
        assert_eq!(extract_string(&Value::String(String::new())), None);
        let mut map = HashMap::new();
        map.insert("value".to_string(), Value::String(String::new()));
        assert_eq!(extract_string(&Value::Map(map)), None);
        // 类型不符
        assert_eq!(extract_string(&Value::Integer(42)), None);
        assert_eq!(extract_string(&Value::Boolean(true)), None);
    }

    #[test]
    fn should_create_value_variants() {
        let null_val = Value::Null;
        let string_val = Value::String("test".to_string());
        let int_val = Value::Integer(42);
        let float_val = Value::Float(std::f64::consts::PI);
        let bool_val = Value::Boolean(true);

        // 验证可以创建各种变体
        match null_val {
            Value::Null => (),
            _ => panic!("Expected Null"),
        }

        match string_val {
            Value::String(s) => assert_eq!(s, "test"),
            _ => panic!("Expected String"),
        }

        match int_val {
            Value::Integer(i) => assert_eq!(i, 42),
            _ => panic!("Expected Integer"),
        }

        match float_val {
            Value::Float(f) => assert_eq!(f, std::f64::consts::PI),
            _ => panic!("Expected Float"),
        }

        match bool_val {
            Value::Boolean(b) => assert!(b),
            _ => panic!("Expected Boolean"),
        }
    }

    #[test]
    fn should_create_list_value() {
        let list = Value::List(vec![
            Value::Integer(1),
            Value::Integer(2),
            Value::Integer(3),
        ]);

        match list {
            Value::List(items) => {
                assert_eq!(items.len(), 3);
                assert_eq!(items[0], Value::Integer(1));
            }
            _ => panic!("Expected List"),
        }
    }

    #[test]
    fn should_create_map_value() {
        let mut map = HashMap::new();
        map.insert("key1".to_string(), Value::String("value1".to_string()));
        map.insert("key2".to_string(), Value::Integer(42));

        let value = Value::Map(map);

        match value {
            Value::Map(m) => {
                assert_eq!(m.len(), 2);
                assert_eq!(m.get("key1"), Some(&Value::String("value1".to_string())));
                assert_eq!(m.get("key2"), Some(&Value::Integer(42)));
            }
            _ => panic!("Expected Map"),
        }
    }

    #[test]
    fn should_clone_value() {
        let original = Value::String("test".to_string());
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn should_serialize_and_deserialize_value() {
        let value = Value::String("test".to_string());
        let yaml = serde_yaml::to_string(&value).unwrap();
        let deserialized: Value = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(value, deserialized);

        let value = Value::Integer(42);
        let yaml = serde_yaml::to_string(&value).unwrap();
        let deserialized: Value = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(value, deserialized);

        let value = Value::Boolean(true);
        let yaml = serde_yaml::to_string(&value).unwrap();
        let deserialized: Value = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(value, deserialized);
    }

    #[test]
    fn should_serialize_and_deserialize_map() {
        let mut map = HashMap::new();
        map.insert("key".to_string(), Value::String("value".to_string()));
        map.insert("number".to_string(), Value::Integer(42));

        let yaml = serde_yaml::to_string(&map).unwrap();
        let deserialized: HashMap<String, Value> = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(map, deserialized);
    }

    #[test]
    fn should_exclude_blacklist_keys_from_backup_and_cloud() {
        // 设备凭据/本机路径/设备级标记:两边都排除
        for key in [
            "cloudSyncSession",
            "gameInstallPath",
            "cloudSyncEnabled",
            "errorReportingConsentShown",
            "cloudSyncNoticeShown",
            "configSyncedOnce",
            "configLastSyncAt",
            "playerNotes",
        ] {
            assert!(!allowed_in_backup(key), "{key} 不应进文件备份");
            assert!(!allowed_in_cloud(key), "{key} 不应上云");
        }
        // API key:文件保留、云端排除
        assert!(allowed_in_backup("dashscopeApiKey"));
        assert!(!allowed_in_cloud("dashscopeApiKey"));
        assert!(allowed_in_backup("ai.apiKey"));
        assert!(!allowed_in_cloud("ai.apiKey"));
        // 普通键:两边都进
        assert!(allowed_in_backup("theme"));
        assert!(allowed_in_cloud("theme"));
    }

    #[tokio::test]
    async fn snapshot_should_filter_by_blacklist() {
        // 全局 cache 在测试间共享:用带前缀的唯一键断言"包含/不包含",不断言总量
        get_cache()
            .await
            .insert("snapTest.theme".to_string(), Value::String("dark".into()))
            .await;
        get_cache()
            .await
            .insert(
                "cloudSyncSession".to_string(),
                Value::String("secret".into()),
            )
            .await;
        get_cache()
            .await
            .insert(
                "dashscopeApiKey".to_string(),
                Value::String("sk-xxx".into()),
            )
            .await;
        get_cache()
            .await
            .insert("ai.apiKey".to_string(), Value::String("sk-openai".into()))
            .await;

        let file_snap = config_snapshot(false).await;
        assert!(file_snap.contains_key("snapTest.theme"));
        assert!(file_snap.contains_key("dashscopeApiKey"));
        assert!(file_snap.contains_key("ai.apiKey"));
        assert!(!file_snap.contains_key("cloudSyncSession"));

        let cloud_snap = config_snapshot(true).await;
        assert!(cloud_snap.contains_key("snapTest.theme"));
        assert!(!cloud_snap.contains_key("dashscopeApiKey"));
        assert!(!cloud_snap.contains_key("ai.apiKey"));
        assert!(!cloud_snap.contains_key("cloudSyncSession"));
    }

    #[test]
    fn apply_filter_should_skip_blacklist_and_keep_others() {
        let mut snap = HashMap::new();
        snap.insert("theme".to_string(), Value::String("dark".into()));
        snap.insert("cloudSyncSession".to_string(), Value::String("evil".into()));
        snap.insert("dashscopeApiKey".to_string(), Value::String("sk".into()));
        snap.insert("ai.apiKey".to_string(), Value::String("sk-ai".into()));
        let kept = filter_snapshot_for_apply(snap);
        let keys: Vec<&str> = kept.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"theme"));
        // 备份文件允许恢复 API key(黑名单只挡设备级键)
        assert!(keys.contains(&"dashscopeApiKey"));
        assert!(keys.contains(&"ai.apiKey"));
        assert!(!keys.contains(&"cloudSyncSession"));
    }

    /// 回归测试：macOS 上「配置存不下来」的直接成因就是写入时父目录不存在
    /// （`~/Library/Application Support/<bundle id>/` 首次运行时尚未创建），
    /// 叠加 CWD 为只读的 `/`。这里锁住「目录不存在也能写成功并读回」。
    #[test]
    fn write_config_to_should_create_missing_parent_dirs_and_round_trip() {
        let root = std::env::temp_dir().join(format!("ra-cfg-test-{}", std::process::id()));
        let path = root.join("nested").join("config.yaml");
        let _ = std::fs::remove_dir_all(&root);
        let mut config = HashMap::new();
        config.insert("theme".to_string(), Value::String("dark".to_string()));

        write_config_to(&path, &config).expect("父目录不存在时也应写入成功");

        assert!(path.is_file(), "配置文件应已落盘: {:?}", path);
        let read_back = read_config(&path).expect("应能读回刚写入的配置");
        assert_eq!(
            read_back.get("theme"),
            Some(&Value::String("dark".to_string()))
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
