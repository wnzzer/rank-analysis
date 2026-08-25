//! # 游戏状态监听模块
//!
//! 实时监控英雄联盟客户端（LCU）的连接状态和游戏阶段变化。
//!
//! ## 主要功能
//!
//! - **连接检测**: 检测 LCU 客户端是否运行
//! - **阶段监听**: 监控游戏阶段变化（大厅、选人、对局中、结算等）
//! - **事件推送**: 通过 Tauri 事件向前端推送状态变更
//! - **WebSocket 启动**: 在 LCU 连接时自动启动 WebSocket 监听
//!
//! ## 监听机制
//!
//! ```text
//! ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
//! │   Tokio Ticker  │────▶│  check_and_emit  │────▶│  Tauri Event    │
//! │  (每 2 秒轮询)   │     │  (状态检测逻辑)   │     │  game-state-changed
//! └─────────────────┘     └──────────────────┘     └─────────────────┘
//!                                │
//!                                ▼
//!                         ┌──────────────────┐
//!                         │  WebSocket 启动   │
//!                         │  (首次连接时)     │
//!                         └──────────────────┘
//! ```
//!
//! ## 事件类型
//!
//! - `game-state-changed`: 游戏状态变更事件，包含连接状态、当前阶段和召唤师信息
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 在 Tauri 应用启动时初始化监听器
//! pub fn run() {
//!     tauri::Builder::default()
//!         .setup(|app| {
//!             let handle = app.handle().clone();
//!             let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
//!             tauri::async_runtime::spawn(async move {
//!                 start_game_state_monitor(handle, stop).await;
//!             });
//!             Ok(())
//!         })
//!         ...
//! }
//! ```

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio::time::{interval, MissedTickBehavior};

use crate::lcu::api::phase::get_phase;
use crate::lcu::api::summoner::Summoner;

/// 游戏状态事件数据结构。
///
/// 通过 `game-state-changed` 事件推送给前端，包含当前 LCU 连接状态、
/// 游戏阶段和当前登录的召唤师信息。
///
/// # 字段说明
///
/// - `connected`: LCU 客户端是否已连接
/// - `phase`: 当前游戏阶段（如 "Lobby", "ChampSelect", "InProgress" 等），未连接时为 None
/// - `summoner`: 当前登录的召唤师信息，未连接时为 None
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateEvent {
    /// LCU 客户端连接状态
    pub connected: bool,
    /// 当前游戏阶段
    pub phase: Option<String>,
    /// 当前登录的召唤师信息
    pub summoner: Option<Summoner>,
    /// 未连接时的失败归类码（`NOT_RUNNING` / `ACCESS_DENIED` / `OTHER`）。
    ///
    /// 已连接或仅是 API 短暂抖动时为 `None`。前端据此决定是否展示"以管理员
    /// 身份重启"等引导。
    pub reason_code: Option<String>,
    /// 未连接时面向用户的失败说明（与 `reason_code` 同源）。
    pub reason_message: Option<String>,
}

/// 全局游戏状态监听器实例。
///
/// 使用 `OnceCell` 确保只有一个监听器实例存在，使用 `Arc<RwLock<...>>`
/// 实现线程安全的共享状态访问。
static GAME_STATE_MONITOR: tokio::sync::OnceCell<Arc<RwLock<GameStateMonitor>>> =
    tokio::sync::OnceCell::const_new();

/// 游戏状态监听器。
///
/// 负责定期检测 LCU 状态变化并向前端推送事件。
///
/// # 字段说明
///
/// - `app_handle`: Tauri 应用句柄，用于发送事件
/// - `last_state`: 上次检测到的游戏状态，用于对比变化
/// - `last_push_time`: 上次推送事件的时间，用于实现最小推送间隔
pub struct GameStateMonitor {
    /// Tauri 应用句柄
    app_handle: AppHandle,
    /// 上次状态快照
    last_state: GameStateEvent,
    /// 上次推送事件的时间，用于实现最小推送间隔
    last_push_time: SystemTime,
    /// 连续召唤师探测失败次数（恢复成功即清零）。
    /// 达到 [`DISCONNECT_FAIL_STREAK`] 才允许把 connected 翻转为 false，
    /// 豁免一局结束前后 LCU 忙/重启窗口的单次误报。
    consecutive_failures: u32,
}

/// 断连判定的连续失败次数阈值（含首次）。
///
/// 权限不足（ACCESS_DENIED）不受此阈值保护——那是持久状态，需要立即
/// 上报以引导用户提权重启。
const DISCONNECT_FAIL_STREAK: u32 = 2;

impl GameStateMonitor {
    /// 创建新的游戏状态监听器实例。
    ///
    /// # 参数
    ///
    /// - `app_handle`: Tauri 应用句柄
    ///
    /// # 返回值
    ///
    /// 新创建的 `GameStateMonitor` 实例，初始状态为未连接
    fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            last_state: GameStateEvent {
                connected: false,
                phase: None,
                summoner: None,
                reason_code: None,
                reason_message: None,
            },
            last_push_time: SystemTime::now(),
            consecutive_failures: 0,
        }
    }

    /// 检测当前游戏状态并发送事件。
    ///
    /// 核心检测逻辑：
    /// 1. 尝试获取当前召唤师信息（判断 LCU 是否连接）
    /// 2. 获取当前游戏阶段
    /// 3. 对比上次状态，如有变化则发送事件
    /// 4. 首次连接时启动 WebSocket 监听
    /// 5. 每 10 秒至少推送一次心跳事件
    ///
    /// # 异步操作
    ///
    /// - 调用 LCU API 获取召唤师信息
    /// - 调用 LCU API 获取游戏阶段
    /// - 可能启动 WebSocket 监听任务
    async fn check_and_emit(&mut self) {
        // 单请求包一层短超时：LCU HTTP 客户端超时 50s，两次串行最坏 ~100s，
        // 期间状态事件停发、前端「已连接」判断冻结。本机接口正常亚秒级返回，
        // 5s 足够；超时按「未连接（OTHER）」归类，下一轮 tick 会自动恢复。
        let summoner_result =
            match tokio::time::timeout(Duration::from_secs(5), Summoner::get_my_summoner()).await {
                Ok(result) => result,
                Err(_) => Err("状态检测超时".to_string()),
            };
        let phase_result = match tokio::time::timeout(Duration::from_secs(5), get_phase()).await {
            Ok(result) => result,
            Err(_) => Err("阶段检测超时".to_string()),
        };
        let connected_raw = summoner_result.is_ok();
        if connected_raw {
            self.consecutive_failures = 0;
        } else {
            self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        }

        // 未连接时进一步归类原因：区分"游戏没开"（正常等待）与"权限不足"
        // （需引导用户提权）。已连接，或仅是 API 短暂抖动（进程在但请求失败）时
        // 不展示任何告警，避免误导。
        let (fail_reason_code, fail_reason_message) = if connected_raw {
            (None, None)
        } else {
            match crate::lcu::util::token::get_auth_detailed() {
                Ok(_) => (None, None),
                Err(e) => (Some(e.code().to_string()), Some(e.to_string())),
            }
        };

        // 断连去抖：上次已连接且失败未达阈值（或权限类需立即上报）时，
        // 维持 connected=true 并沿用上次已知的召唤师/阶段，避免对局结束
        // 前后 LCU 忙/重启窗口的单次误报把前端从对局页/战绩页踢走。
        let deny_immediate = fail_reason_code.as_deref() == Some("ACCESS_DENIED");
        let connected = resolved_connected(
            self.last_state.connected,
            self.consecutive_failures,
            connected_raw,
            if deny_immediate { Some("ACCESS_DENIED") } else { None },
        );

        let (reason_code, reason_message) = if connected {
            (None, None)
        } else {
            (fail_reason_code, fail_reason_message)
        };

        let new_state = GameStateEvent {
            connected,
            phase: phase_result.ok().or_else(|| {
                if connected {
                    self.last_state.phase.clone()
                } else {
                    None
                }
            }),
            summoner: summoner_result.ok().or_else(|| {
                if connected {
                    self.last_state.summoner.clone()
                } else {
                    None
                }
            }),
            reason_code,
            reason_message,
        };

        // 检查状态是否改变（含 reason_code，使提权引导能及时出现/消失）
        let state_changed = new_state.connected != self.last_state.connected
            || new_state.phase != self.last_state.phase
            || new_state.reason_code != self.last_state.reason_code;
        let now = SystemTime::now();
        let diff_time = now
            .duration_since(self.last_push_time)
            .unwrap_or(Duration::from_secs(0));

        // 如果刚连接上（之前未连接，现在连接了），补全资源缓存并启动 WebSocket 监听
        if new_state.connected && !self.last_state.connected {
            // 记忆游戏安装目录：此刻客户端在线，可反推安装根目录并持久化，
            // 之后即便游戏关闭也能免 WeGame 一键启动（见 command::launcher）。
            tokio::spawn(async {
                crate::command::launcher::remember_install_root().await;
                // 顺手清除登录客户端注册的 LOL 开机自启项：能连上国服客户端说明
                // 本工具已提权，此刻删 HKLM 值必然有权限（见 command::launcher）。
                crate::command::launcher::purge_login_client_autostart();
            });

            // 维度标签：把当前登录大区（HN1/TJ100…）挂到 Sentry 全局 scope，
            // 错误/日志可按大区切片（粗粒度非 PII；上报关闭时为 no-op）。
            tokio::spawn(async {
                if let Ok(pid) = crate::lcu::api::sgp::get_current_platform_id().await {
                    crate::observability::set_region_tag(&pid);
                }
            });

            if crate::lcu::api::asset::champion_cache_is_empty() {
                log::info!("LCU 已连接，正在补全静态资源缓存...");
                tokio::spawn(async move {
                    crate::lcu::api::asset::init().await;
                });
            }
            // 队列表同为「连上客户端才拿得到」的静态数据，与资源缓存同一时机拉取。
            // 失败不影响功能——所有解析点都会回落到硬编码表。
            if crate::lcu::api::game_queue::cache_is_empty() {
                tokio::spawn(async move {
                    crate::lcu::api::game_queue::init().await;
                });
            }
            log::info!("LCU 已连接，正在启动 WebSocket 监听...");
            let app_handle = self.app_handle.clone();
            // LcuListener 内部自带代际去重与每轮现取认证：这里只管在
            // 「未连接 → 已连接」跳变时 spawn，旧实例会自行退出。
            tokio::spawn(async move {
                crate::lcu::listener::LcuListener::new(app_handle)
                    .start()
                    .await;
            });
        }

        // 刚断开（之前连接，现在断开）：客户端退出时可能重新注册了 LOL 开机
        // 自启，再清一次，避免"最后一局退出后残留自启项"。
        if !new_state.connected && self.last_state.connected {
            tokio::spawn(async {
                crate::command::launcher::purge_login_client_autostart();
            });
        }

        // 状态变化或超过 10 秒未推送时，发送事件
        if state_changed || diff_time > Duration::from_secs(10) {
            log::info!(
                "Game state changed: connected={}, phase={:?}",
                new_state.connected,
                new_state.phase
            );

            // 发送事件到前端
            if let Err(e) = self.app_handle.emit("game-state-changed", &new_state) {
                log::error!("Failed to emit game-state-changed event: {}", e);
            }

            self.last_state = new_state;
            self.last_push_time = now;
        }
    }
}

/// 初始化并启动游戏状态监听器。
///
/// 这是模块的主要入口函数，应在应用程序启动时调用（由 [`crate::shard::GameStateShard`] 驱动）。
///
/// # 参数
///
/// - `app_handle`: Tauri 应用句柄
/// - `stop`: 停止标记，由 shard `on_dispose` 置位；循环在下一次检查点收敛退出
///   （最长 2 秒），避免进程退出前留下无法收敛的常驻任务
///
/// # 行为
///
/// 1. 创建全局监听器实例
/// 2. 启动 Tokio 定时任务（每 2 秒执行一次检测，积压 tick 用 Delay 丢弃而非补帧）
/// 3. 持续监控直到应用程序退出或收到停止标记
///
/// # 示例
///
/// ```rust,ignore
/// pub fn run() {
///     tauri::Builder::default()
///         .setup(|app| {
///             let handle = app.handle().clone();
///             let stop = Arc::new(AtomicBool::new(false));
///             tauri::async_runtime::spawn(async move {
///                 start_game_state_monitor(handle, stop).await;
///             });
///             Ok(())
///         })
///         ...
/// }
/// ```
pub async fn start_game_state_monitor(app_handle: AppHandle, stop: Arc<AtomicBool>) {
    log::info!("Starting game state monitor");

    let monitor = Arc::new(RwLock::new(GameStateMonitor::new(app_handle)));
    GAME_STATE_MONITOR.set(monitor.clone()).ok();

    // 启动监听循环
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(2));
        // 检测耗时超过 2s 时默认 Burst 行为会把积压的 tick 连发补跑，
        // 造成 LCU 卡顿恢复后的事件风暴；Delay 语义改为「顺延到下一个整周期」。
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            if stop.load(Ordering::Relaxed) {
                log::info!("[shard] game-state-monitor stopped");
                return;
            }
            ticker.tick().await;

            // 写锁只覆盖内存状态更新与事件发射（HTTP 检测在锁内但已限 5s 超时），
            // 不再出现「持锁等待最长 100s」的窗口。
            let mut monitor = monitor.write().await;
            monitor.check_and_emit().await;
        }
    });

    log::info!("Game state monitor started");
}

/// 断连去抖纯函数：给定上次连接态、连续失败次数、本次探测成败与失败归类，
/// 返回对外呈现的 connected。
///
/// 规则：
/// - 探测成功 → 恒为 true（计数清零由调用方负责）
/// - 失败且归类为 ACCESS_DENIED → 恒为 false（持久权限问题需立即引导提权）
/// - 其余失败：上次已连接且未达阈值时维持 true（宽限），否则 false
fn resolved_connected(
    last_connected: bool,
    consecutive_failures: u32,
    probe_ok: bool,
    fail_reason_code: Option<&str>,
) -> bool {
    if probe_ok {
        return true;
    }
    if fail_reason_code == Some("ACCESS_DENIED") {
        return false;
    }
    last_connected && consecutive_failures < DISCONNECT_FAIL_STREAK
}

#[cfg(test)]
mod tests {
    use super::{resolved_connected, DISCONNECT_FAIL_STREAK};

    const DENIED: Option<&str> = Some("ACCESS_DENIED");
    const OTHER: Option<&str> = Some("OTHER");

    #[test]
    fn probe_success_is_always_connected() {
        assert!(resolved_connected(false, 0, true, None));
        assert!(resolved_connected(true, 3, true, OTHER));
    }

    #[test]
    fn access_denied_disconnects_immediately_even_on_first_failure() {
        assert!(!resolved_connected(true, 1, false, DENIED));
    }

    #[test]
    fn first_failure_while_connected_stays_in_grace() {
        assert!(resolved_connected(true, 1, false, OTHER));
    }

    #[test]
    fn failure_at_threshold_flips_disconnected() {
        assert!(!resolved_connected(true, DISCONNECT_FAIL_STREAK, false, OTHER));
    }

    #[test]
    fn grace_never_applies_when_previously_disconnected() {
        // 冷启动即失败（客户端没开）：不宽限，立即如实上报未连接
        assert!(!resolved_connected(false, 1, false, OTHER));
        assert!(!resolved_connected(false, 5, false, None));
    }
}
