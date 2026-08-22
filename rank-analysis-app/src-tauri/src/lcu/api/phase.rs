//! # LCU 游戏阶段 API
//!
//! 对应 `lol-gameflow/v1/gameflow-phase`，返回当前阶段（如 ChampSelect、InProgress、EndOfGame 等）；带短时缓存。
//! WebSocket 事件可直接更新缓存，避免重复 HTTP 请求。

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use crate::lcu::util::http::{auth_fingerprint, lcu_get};

#[derive(Debug, Clone)]
struct PhaseCache {
    last_phase: String,
    /// 产生该缓存时的 LCU 认证 (token 前缀, port)：客户端重启后端口/令牌变化，
    /// 沿用旧认证窗口内的缓存会返回上一局客户端的陈旧阶段（最长 2s）。
    auth_fingerprint: Option<(String, String)>,
    cached_at: Option<std::time::Instant>,
}

impl PhaseCache {
    fn new() -> Self {
        Self {
            last_phase: String::new(),
            auth_fingerprint: None,
            cached_at: None,
        }
    }

    /// 缓存是否仍可信：2 秒内且产生缓存时的认证未变。
    fn is_valid(&self, now_auth: &Option<(String, String)>) -> bool {
        let Some(cached_at) = self.cached_at else {
            return false;
        };
        if cached_at.elapsed() > Duration::from_millis(2000) {
            return false;
        }
        match (&self.auth_fingerprint, now_auth) {
            (Some(a), Some(b)) => a == b,
            // 拿不到当前认证（客户端未运行）时只信时间窗本身
            _ => true,
        }
    }
}

static PHASE_CACHE: LazyLock<Mutex<PhaseCache>> = LazyLock::new(|| Mutex::new(PhaseCache::new()));

/// 对已毒化的 Mutex 恢复：取回内部值继续使用。
///
/// phase 缓存被自动化/监控/会话流水线高频共享，任何一处持锁 panic 都会让
/// 后续 `lock().unwrap()` 级联中毒；这里与 lcu/util/http.rs 同款兜底。
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 更新 phase 缓存（供 WebSocket 事件调用）
pub fn update_phase_cache(phase: String) {
    let fingerprint = auth_fingerprint();
    let mut cache = lock_or_recover(&PHASE_CACHE);
    cache.last_phase = phase;
    cache.auth_fingerprint = fingerprint;
    cache.cached_at = Some(std::time::Instant::now());
    log::debug!("Phase cache updated via WebSocket: {}", cache.last_phase);
}

/// 获取当前游戏流程阶段（2 秒内且认证未变时使用缓存）。
pub async fn get_phase() -> Result<String, String> {
    // 认证指纹在锁外取（auth_fingerprint 内部有自己的锁，避免嵌套）
    let now_auth = auth_fingerprint();
    {
        let cache = lock_or_recover(&PHASE_CACHE);
        if cache.is_valid(&now_auth) {
            return Ok(cache.last_phase.clone());
        }
    }

    // 获取新的阶段
    let uri = "lol-gameflow/v1/gameflow-phase";
    let phase = lcu_get::<String>(uri).await?;

    // 更新缓存
    {
        let mut cache = lock_or_recover(&PHASE_CACHE);
        cache.last_phase = phase.clone();
        cache.auth_fingerprint = now_auth;
        cache.cached_at = Some(std::time::Instant::now());
    }

    Ok(phase)
}
