use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio::time::interval;

use crate::lcu::api::phase::get_phase;
use crate::lcu::api::summoner::Summoner;

#[derive(Debug, Clone, serde::Serialize)]
pub struct GameStateEvent {
    pub connected: bool,
    pub phase: Option<String>,
    pub summoner: Option<Summoner>,
}

static GAME_STATE_MONITOR: tokio::sync::OnceCell<Arc<RwLock<GameStateMonitor>>> =
    tokio::sync::OnceCell::const_new();

pub struct GameStateMonitor {
    app_handle: AppHandle,
    last_state: GameStateEvent,
    last_push_time: SystemTime,
}

impl GameStateMonitor {
    fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            last_state: GameStateEvent {
                connected: false,
                phase: None,
                summoner: None,
            },
            last_push_time: SystemTime::now(),
        }
    }

    async fn check_and_emit(&mut self) {
        // 尝试获取 summoner 信息
        let summoner_result = Summoner::get_my_summoner().await;
        let phase_result = get_phase().await;

        let new_state = GameStateEvent {
            connected: summoner_result.is_ok(),
            phase: phase_result.ok(),
            summoner: summoner_result.ok(),
        };

        // 检查状态是否改变
        let state_changed = new_state.connected != self.last_state.connected
            || new_state.phase != self.last_state.phase;
        let now = SystemTime::now();
        let diff_time = now.duration_since(self.last_push_time).unwrap();

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
        }
    }
}

/// 初始化并启动游戏状态监听器
pub async fn start_game_state_monitor(app_handle: AppHandle) {
    log::info!("Starting game state monitor");

    let monitor = Arc::new(RwLock::new(GameStateMonitor::new(app_handle)));
    GAME_STATE_MONITOR.set(monitor.clone()).ok();

    // 启动监听循环
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(2));

        loop {
            ticker.tick().await;

            let mut monitor = monitor.write().await;
            monitor.check_and_emit().await;
        }
    });

    log::info!("Game state monitor started");
}
