//! # LCU 游戏阶段 API
//!
//! 对应 `lol-gameflow/v1/gameflow-phase`，返回当前阶段（如 ChampSelect、InProgress、EndOfGame 等）；带短时缓存。
//! WebSocket 事件可直接更新缓存，避免重复 HTTP 请求。

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::lcu::util::http::lcu_get;

#[derive(Debug, Clone)]
struct PhaseCache {
    last_phase: String,
    last_fetch_time: Option<Instant>,
}

impl PhaseCache {
    fn new() -> Self {
        Self {
            last_phase: String::new(),
            last_fetch_time: None,
        }
    }
}

static PHASE_CACHE: LazyLock<Mutex<PhaseCache>> = LazyLock::new(|| Mutex::new(PhaseCache::new()));

/// 写入新阶段；值发生变化时返回旧值。
///
/// WebSocket 事件与 [`get_phase`] 轮询两条路径都经过这里，阶段切换只会被
/// 其中先到的一条检测到一次。
fn store_phase(phase: &str) -> Option<String> {
    let mut cache = PHASE_CACHE.lock().unwrap();
    cache.last_fetch_time = Some(Instant::now());
    if cache.last_phase == phase {
        return None;
    }
    Some(std::mem::replace(&mut cache.last_phase, phase.to_string()))
}

/// 写入新阶段，并在阶段变化时通知对局级缓存（锁已释放后再调用，避免持锁做清理）。
fn set_phase(phase: &str) {
    if let Some(old) = store_phase(phase) {
        crate::game_cache::on_phase_changed(&old, phase);
    }
}

/// 更新 phase 缓存（供 WebSocket 事件调用）
pub fn update_phase_cache(phase: String) {
    set_phase(&phase);
    log::debug!("Phase cache updated via WebSocket: {}", phase);
}

/// 最近一次已知的阶段（不发请求，未知时为空串）。
///
/// 供缓存过期策略这类不能 await、也不值得为此打 LCU 的地方使用。
pub fn cached_phase() -> String {
    PHASE_CACHE.lock().unwrap().last_phase.clone()
}

/// 获取当前游戏流程阶段（2 秒内使用缓存）。
pub async fn get_phase() -> Result<String, String> {
    {
        let cache = PHASE_CACHE.lock().unwrap();

        // 检查缓存是否在2秒内
        if let Some(last_fetch_time) = cache.last_fetch_time {
            if last_fetch_time.elapsed() <= Duration::from_millis(2000) {
                return Ok(cache.last_phase.clone());
            }
        }
    }

    // 获取新的阶段
    let uri = "lol-gameflow/v1/gameflow-phase";
    let phase = lcu_get::<String>(uri).await?;

    set_phase(&phase);

    Ok(phase)
}
