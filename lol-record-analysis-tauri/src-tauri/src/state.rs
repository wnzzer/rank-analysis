//! # 应用状态管理模块
//!
//! 定义 Tauri 应用程序的共享状态结构。
//!
//! ## 主要功能
//!
//! - **HTTP 服务端口**: 存储前端用于访问静态资源的 HTTP 服务器端口
//! - **Fandom 数据缓存**: 缓存从 Fandom 获取的大乱斗英雄平衡数据
//!
//! ## 设计说明
//!
//! `AppState` 被设计为 Tauri 的托管状态（Managed State），通过 `tauri::State`
//! 在命令处理器中访问。这种设计允许：
//!
//! - 跨请求的状态共享
//! - 线程安全的并发访问
//! - 懒加载的缓存初始化
//!
//! ## 架构
//!
//! ```text
//! AppState (Tauri Managed State)
//!     ├── http_port: OnceLock<u16>
//!     │       └── 延迟初始化的 HTTP 服务端口
//!     └── fandom_cache: Cache<i32, AramBalanceData>
//!             └── Moka 缓存 (2 小时 TTL)
//! ```
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 在 Tauri 应用构建时注册状态
//! pub fn run() {
//!     tauri::Builder::default()
//!         .manage(AppState::default())
//!         ...
//! }
//!
//! // 在命令中访问状态
//! #[tauri::command]
//! pub async fn get_aram_balance(
//!     id: i32,
//!     state: State<'_, AppState>,
//! ) -> Result<Option<AramBalanceData>, String> {
//!     Ok(state.fandom_cache.get(&id).await)
//! }
//! ```

use crate::fandom::data::AramBalanceData;
use moka::future::Cache;
use std::sync::OnceLock;
use std::time::Duration;

/// 应用程序共享状态。
///
/// 通过 Tauri 的状态管理系统在应用程序生命周期内共享数据。
///
/// # 字段说明
///
/// - `http_port`: HTTP 静态资源服务器的端口，使用 `OnceLock` 实现延迟初始化
/// - `fandom_cache`: 大乱斗英雄平衡数据缓存，使用 Moka 实现带 TTL 的内存缓存
///
/// # 线程安全
///
/// 所有字段都是线程安全的：
/// - `OnceLock<u16>`: 线程安全的延迟初始化
/// - `Cache<K, V>`: Moka 缓存内部使用原子操作，线程安全
pub struct AppState {
    /// HTTP 静态资源服务器端口。
    ///
    /// 使用 `OnceLock` 确保只设置一次，通常在应用程序启动时
    /// 由 HTTP 服务器初始化代码设置。
    pub http_port: OnceLock<u16>,

    /// Fandom 大乱斗平衡数据缓存。
    ///
    /// 缓存键为英雄 ID，值为平衡数据。
    /// 使用 2 小时的 TTL（生存时间）自动过期数据。
    pub fandom_cache: Cache<i32, AramBalanceData>,

    /// OP.GG 快照内存缓存。
    ///
    /// 键为模式（"ranked" / "aram"），值为完整快照，与磁盘缓存
    /// （`opgg::cache`）互为补充：内存快、磁盘跨重启。
    ///
    /// # 为什么不设 TTL
    ///
    /// 内存须保留"最后已知快照"供拉取失败时降级（`ensure_opgg_snapshot`
    /// 的过期缓存回退分支）。若设 moka TTL，条目一到期即被驱逐，降级分支
    /// 永远拿不到数据。新鲜度由 `opgg::cache::is_fresh` 单独裁决；键至多
    /// 2 个（"ranked"/"aram"），无内存压力。
    pub opgg_cache: Cache<String, std::sync::Arc<crate::opgg::data::OpggSnapshot>>,
}

impl Default for AppState {
    /// 创建默认的应用状态实例。
    ///
    /// # 初始化值
    ///
    /// - `http_port`: 未初始化的 `OnceLock`
    /// - `fandom_cache`: 2 小时 TTL 的 Moka 缓存
    /// - `opgg_cache`: 无 TTL 的 Moka 缓存（理由见字段文档）
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let state = AppState::default();
    /// // 设置 HTTP 端口
    /// state.http_port.set(8080).unwrap();
    /// ```
    fn default() -> Self {
        Self {
            http_port: OnceLock::new(),
            fandom_cache: Cache::builder()
                .time_to_live(Duration::from_secs(2 * 60 * 60))
                .build(),
            opgg_cache: Cache::builder().build(),
        }
    }
}
