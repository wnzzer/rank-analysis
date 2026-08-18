//! # 双层令牌桶限流（riot/rate_limit，ADR-6）
//!
//! Riot dev key 官方限速：**20 req/s** 与 **100 req/2min**。单层桶挡不住
//! 短爆（100/2min 不限制 1s 内打 50 发），双层桶两个都挡：
//! burst 管每秒、sustained 管两分钟滑动。全部按 `Instant` 注入计算，
//! 纯函数可测、无 IO、无阻塞。

use std::sync::Mutex;
use std::time::Instant;

/// 单层令牌桶：容量 `capacity`，每秒回填 `refill_per_sec`。
///
/// 非阻塞：`try_acquire` 拿不到令牌立刻返回 false，调用方自行降级
/// （M1 纪律：限流不排队不阻塞主流程）。
pub struct TokenBucket {
    capacity: f64,
    refill_per_sec: f64,
    tokens: f64,
    last_refill: Instant,
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_sec: f64) -> Self {
        Self {
            capacity: f64::from(capacity),
            refill_per_sec,
            tokens: f64::from(capacity),
            last_refill: Instant::now(),
        }
    }

    /// 按 `now` 回填后尝试取 1 个令牌。
    pub fn try_acquire(&mut self, now: Instant) -> bool {
        let elapsed = now
            .saturating_duration_since(self.last_refill)
            .as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// 归还一个令牌（双层桶中第二层失败时把第一层扣掉的还回去）。
    pub fn refund_one(&mut self) {
        self.tokens = (self.tokens + 1.0).min(self.capacity);
    }
}

/// 双层桶：burst 与 sustained 都放行才算通过（防止"还桶"破坏跨层守恒）。
pub struct RateLimiter {
    burst: Mutex<TokenBucket>,
    sustained: Mutex<TokenBucket>,
}

impl RateLimiter {
    /// - `burst_capacity` / `burst_per_sec`：短期桶（如 20 / 20.0）
    /// - `sustained_capacity` / `sustained_per_sec`：长期桶（如 100 / 100.0/120.0）
    pub fn new(
        burst_capacity: u32,
        burst_per_sec: f64,
        sustained_capacity: u32,
        sustained_per_sec: f64,
    ) -> Self {
        Self {
            burst: Mutex::new(TokenBucket::new(burst_capacity, burst_per_sec)),
            sustained: Mutex::new(TokenBucket::new(sustained_capacity, sustained_per_sec)),
        }
    }

    /// 尝试取一个请求额度。两桶都成功才放行；sustained 失败时归还 burst 令牌。
    pub fn try_acquire(&self, now: Instant) -> bool {
        let mut b = self.burst.lock().unwrap_or_else(|e| e.into_inner());
        let mut s = self.sustained.lock().unwrap_or_else(|e| e.into_inner());
        if !b.try_acquire(now) {
            return false;
        }
        if s.try_acquire(now) {
            true
        } else {
            b.refund_one();
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start() -> Instant {
        Instant::now()
    }

    #[test]
    fn burst_allows_capacity_then_blocks() {
        let mut bucket = TokenBucket::new(3, 1.0);
        let t0 = start();
        assert!(bucket.try_acquire(t0));
        assert!(bucket.try_acquire(t0));
        assert!(bucket.try_acquire(t0));
        assert!(!bucket.try_acquire(t0), "容量耗尽应立即拒绝");
    }

    #[test]
    fn burst_refills_over_time() {
        let mut bucket = TokenBucket::new(1, 1.0);
        let t0 = start();
        assert!(bucket.try_acquire(t0));
        assert!(!bucket.try_acquire(t0));
        let t1 = t0 + std::time::Duration::from_millis(500);
        assert!(!bucket.try_acquire(t1), "回填未满 1 个仍拒绝");
        let t2 = t0 + std::time::Duration::from_secs(1);
        assert!(bucket.try_acquire(t2), "满 1s 应回填 1 个");
    }

    #[test]
    fn refund_restores_token_within_capacity() {
        let mut bucket = TokenBucket::new(2, 1.0);
        let t0 = start();
        assert!(bucket.try_acquire(t0));
        bucket.refund_one();
        assert!(bucket.try_acquire(t0), "归还后可立即再取");
        assert!(bucket.try_acquire(t0));
        assert!(!bucket.try_acquire(t0), "归还不超容量");
    }

    #[test]
    fn double_bucket_sustained_caps_burst() {
        // burst 容量大、sustained 容量 2：sustained 用尽后 burst 有票也拒
        let limiter = RateLimiter::new(10, 10.0, 2, 1.0);
        let t0 = start();
        assert!(limiter.try_acquire(t0));
        assert!(limiter.try_acquire(t0));
        assert!(!limiter.try_acquire(t0), "sustained 耗尽应拒绝");
    }

    #[test]
    fn double_bucket_recovers_after_sustained_refill() {
        let limiter = RateLimiter::new(10, 10.0, 2, 1.0);
        let t0 = start();
        assert!(limiter.try_acquire(t0));
        assert!(limiter.try_acquire(t0));
        assert!(!limiter.try_acquire(t0));
        let t1 = t0 + std::time::Duration::from_secs(1);
        assert!(limiter.try_acquire(t1), "sustained 满 1s 回填后放行");
        assert!(!limiter.try_acquire(t1), "回填 1 个只够 1 次");
    }

    #[test]
    fn sustained_refill_is_proportional_to_window() {
        // 100/2min 的持续速率 ≈ 0.833/s：20s 回填 ~16.7 → 可放行 16 次
        let limiter = RateLimiter::new(100, 100.0, 100, 100.0 / 120.0);
        let t0 = start();
        for _ in 0..30 {
            assert!(limiter.try_acquire(t0));
        }
        let t1 = t0 + std::time::Duration::from_secs(20);
        let mut allowed = 0;
        for _ in 0..50 {
            if limiter.try_acquire(t1) {
                allowed += 1;
            }
        }
        assert!(
            allowed >= 15 && allowed <= 18,
            "20s 应回填 ~16.7 个，实际 {allowed}"
        );
    }
}
