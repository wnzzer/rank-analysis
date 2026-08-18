//! 轻量生命周期管理（P1-4）：shard 式 `on_init / on_dispose`。
//!
//! 背景：启动期后台任务（自动化、游戏状态监听、Fandom 2h 数据循环等）全部在
//! `main.rs` 的 setup 里裸 spawn，没有任何退出/回收钩子——进程退出时循环任务
//! 没有机会优雅停止。本模块提供统一契约：
//!
//! - [`AppShard`]：`on_init`（启动初始化，可异步）+ `on_dispose`（退出清理，同步）。
//!   `on_dispose` 设计为同步：只做「发停止信号 / 释放资源」这类立即可达的动作，
//!   长驻循环靠内部停止标记自行收敛，不应依赖异步清理。
//! - [`ShardManager`]：注册表 + 按注册序 `init_all` / 逆序 `dispose_all`。
//!   `init_all` / `dispose_all` 内部先快照 `Arc` 列表再遍历，绝不在 await 点上
//!   持有 `MutexGuard`（否则 future 非 `Send`，`tokio::spawn` 编译期报错）。
//!
//! 与 LeagueAkari `akari-shard` 的对应关系：`onInit/onDispose` 契约 + 注册表管理；
//! 不引入它的反射式 DI——本项目 shard 都是显式构造，反射是过度设计。

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use tauri::Manager;

use crate::state::AppState;

/// shard 生命周期契约。默认实现均为空操作，具体 shard 按需覆写。
///
/// `on_init` 以 boxed future 暴露：`async fn` 在 trait 中不满足 dyn 兼容
/// （E0038），手写 `Pin<Box<dyn Future + Send>>` 是当前 rustc 的标准姿势
/// （等价于 `#[async_trait]` / `#[trait_variant]` 生成物，零额外依赖）。
pub trait AppShard: Send + Sync {
    /// shard 名称（日志/排障用）。
    fn name(&self) -> &'static str;

    /// 启动初始化：在此 spawn 长驻循环或做预热。失败自行记录，不向调用方抛错
    /// （一个 shard 失败不应拖垮整个启动）。
    fn on_init<'a>(
        &'a self,
        _app: &'a tauri::AppHandle,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {})
    }

    /// 退出清理：发停止信号 / 释放资源（同步、立即返回）。
    fn on_dispose(&self) {}
}

/// 注册表 + 顺序调度。
struct ShardManager {
    shards: Mutex<Vec<Arc<dyn AppShard>>>,
}

static MANAGER: LazyLock<ShardManager> = LazyLock::new(|| ShardManager {
    shards: Mutex::new(Vec::new()),
});

/// 注册一个 shard（启动期调用，需在 [`init_all`] 之前）。
pub fn register(shard: Arc<dyn AppShard>) {
    MANAGER.shards.lock().unwrap().push(shard);
}

/// 按注册序逐个 `on_init`（先快照再遍历，await 期间不持锁）。
pub async fn init_all(app: &tauri::AppHandle) {
    let snapshot: Vec<Arc<dyn AppShard>> = MANAGER.shards.lock().unwrap().clone();
    for shard in &snapshot {
        log::info!("[shard] init: {}", shard.name());
        shard.on_init(app).await;
    }
}

/// 逆序逐个 `on_dispose`（依赖方后清理：先停后起的，符合 fork 顺序直觉）。
pub fn dispose_all() {
    let snapshot: Vec<Arc<dyn AppShard>> = MANAGER.shards.lock().unwrap().clone();
    for shard in snapshot.iter().rev() {
        log::info!("[shard] dispose: {}", shard.name());
        shard.on_dispose();
    }
}

/// 启动收尾 shard：自动化系统 + 资源缓存预热 + OP.GG 预热（一次性初始化）。
///
/// 对应原 `main.rs` setup 里的首块 spawn（三者原有执行顺序保持：自动化先起，
/// 资产缓存与 OP.GG 预热随后顺序 await）。
pub struct StartupShard;

impl StartupShard {
    /// 构造即装箱（`Arc<dyn AppShard>`），调用端直接交给注册表，无需二次包装。
    #[allow(clippy::new_ret_no_self)]
    pub fn new() -> Arc<dyn AppShard> {
        Arc::new(Self)
    }
}

impl AppShard for StartupShard {
    fn name(&self) -> &'static str {
        "startup"
    }

    fn on_init<'a>(
        &'a self,
        app: &'a tauri::AppHandle,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let automation_handle = app.clone();
            tokio::spawn(async move {
                crate::automation::start_automation(automation_handle).await;
            });

            crate::lcu::api::asset::init().await;

            // OP.GG 数据预热：失败仅告警，不阻塞启动（对局页/AI 会按需再触发）。
            let opgg_state = app.state::<AppState>();
            for mode in ["ranked", "aram"] {
                match crate::command::opgg::ensure_opgg_snapshot(&opgg_state, mode).await {
                    Ok((snap, stale)) => log::info!(
                        "OP.GG warmup {}: patch {}, stale={}",
                        mode,
                        snap.patch,
                        stale
                    ),
                    Err(e) => log::warn!("OP.GG warmup {} failed: {}", mode, e),
                }
            }
        })
    }
}

/// 游戏状态监听 shard（常驻 WebSocket 监听，依赖 lcu/listener 的自愈重连）。
pub struct GameStateShard;

impl GameStateShard {
    /// 构造即装箱（`Arc<dyn AppShard>`），调用端直接交给注册表，无需二次包装。
    #[allow(clippy::new_ret_no_self)]
    pub fn new() -> Arc<dyn AppShard> {
        Arc::new(Self)
    }
}

impl AppShard for GameStateShard {
    fn name(&self) -> &'static str {
        "game-state-monitor"
    }

    fn on_init<'a>(
        &'a self,
        app: &'a tauri::AppHandle,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let app_handle = app.clone();
            tokio::spawn(async move {
                crate::game_state_monitor::start_game_state_monitor(app_handle).await;
            });
        })
    }
}

/// Fandom 数据 shard：2h 周期性拉取 ARAM 平衡数据。
///
/// 原实现是裸 `loop` + 不可取消的 spawn；收编后 `on_dispose` 置停止标记，
/// 循环在下一次检查点收敛退出。
pub struct FandomShard {
    stop: Arc<AtomicBool>,
}

impl FandomShard {
    /// 构造即装箱（`Arc<dyn AppShard>`），调用端直接交给注册表，无需二次包装。
    #[allow(clippy::new_ret_no_self)]
    pub fn new() -> Arc<dyn AppShard> {
        Arc::new(Self {
            stop: Arc::new(AtomicBool::new(false)),
        })
    }
}

impl AppShard for FandomShard {
    fn name(&self) -> &'static str {
        "fandom"
    }

    fn on_init<'a>(
        &'a self,
        app: &'a tauri::AppHandle,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let stop = self.stop.clone();
            let handle = app.clone();
            tokio::spawn(async move {
                while !stop.load(Ordering::Relaxed) {
                    match crate::fandom::api::fetch_aram_balance_data().await {
                        Ok(data) => {
                            let state = handle.state::<AppState>();
                            let count = data.len();
                            for (id, balance) in data {
                                state.fandom_cache.insert(id, balance).await;
                            }
                            log::info!("Updated Fandom ARAM balance data. Count: {}", count);
                        }
                        Err(e) => {
                            log::error!("Failed to update Fandom data: {}", e);
                        }
                    }
                    // 停止标记在睡眠期间也可能被置位：睡醒后的下一次循环检查兜住
                    tokio::time::sleep(Duration::from_secs(2 * 60 * 60)).await;
                }
                log::info!("[shard] fandom loop stopped");
            });
        })
    }

    fn on_dispose(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeShard {
        name: &'static str,
    }

    impl AppShard for FakeShard {
        fn name(&self) -> &'static str {
            self.name
        }

        fn on_dispose(&self) {}
    }

    #[test]
    fn dispose_all_runs_in_reverse_registration_order() {
        let order: Arc<Mutex<Vec<&'static str>>> = Arc::new(Mutex::new(Vec::new()));

        struct OrderShard {
            name: &'static str,
            order: Arc<Mutex<Vec<&'static str>>>,
        }

        impl AppShard for OrderShard {
            fn name(&self) -> &'static str {
                self.name
            }
            fn on_dispose(&self) {
                self.order.lock().unwrap().push(self.name);
            }
        }

        let order_arc = order.clone();
        MANAGER.shards.lock().unwrap().push(Arc::new(OrderShard {
            name: "a",
            order: order_arc.clone(),
        }));
        MANAGER.shards.lock().unwrap().push(Arc::new(OrderShard {
            name: "b",
            order: order_arc.clone(),
        }));
        MANAGER.shards.lock().unwrap().push(Arc::new(OrderShard {
            name: "c",
            order: order_arc.clone(),
        }));

        dispose_all();

        let got: Vec<&str> = order.lock().unwrap().clone();
        assert_eq!(got, vec!["c", "b", "a"], "dispose 必须逆注册序执行");

        // 清空全局注册表，避免污染其他测试
        MANAGER.shards.lock().unwrap().clear();
    }

    #[test]
    fn fandom_shard_dispose_sets_stop_flag() {
        let stop = Arc::new(AtomicBool::new(false));
        let shard = FandomShard { stop: stop.clone() };
        shard.on_dispose();
        assert!(stop.load(Ordering::Relaxed));
    }

    #[test]
    fn register_and_snapshot_preserves_order() {
        let a: Arc<dyn AppShard> = Arc::new(FakeShard { name: "a" });
        let b: Arc<dyn AppShard> = Arc::new(FakeShard { name: "b" });
        register(a);
        register(b);
        let snapshot: Vec<Arc<dyn AppShard>> = MANAGER.shards.lock().unwrap().clone();
        assert_eq!(
            snapshot.iter().map(|s| s.name()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        MANAGER.shards.lock().unwrap().clear();
    }
}
