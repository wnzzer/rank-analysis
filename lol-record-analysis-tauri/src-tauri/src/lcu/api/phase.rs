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

/// 获取游戏阶段，使用缓存机制
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

    // 更新缓存
    {
        let mut cache = PHASE_CACHE.lock().unwrap();
        cache.last_phase = phase.clone();
        cache.last_fetch_time = Some(Instant::now());
    }

    Ok(phase)
}
