//! # 对局级缓存策略
//!
//! 战绩列表、段位、用户标签三类缓存按「对局」管理生命周期：
//!
//! - **对局中写入**（选人 → 游戏结束前）：存 [`IN_GAME_TTL`]。选人期 LCU 事件每秒
//!   数次触发 session 全量重建，这段时间内 10 名玩家的档案基本不变，缓存久一点可以
//!   让重建几乎不打 LCU。
//! - **其余阶段写入**（大厅、结算界面、战绩页浏览）：存 [`OUT_OF_GAME_TTL`]，与改造前
//!   的 60s 一致。结算界面也归这一类：LCU 要过一会儿才查得到刚打完的局，短缓存能让
//!   它像以前一样一分钟内出现在战绩页。
//! - **阶段切换时整体清空**（见 [`should_invalidate`]）：进入选人 = 新的一局；离开
//!   对局阶段（进结算 / 秒退）= 本局结束。对局中的长缓存因此不会延续到结算和大厅。
//! - **重新连上客户端时清空**：覆盖切换账号 / 客户端重启。
//!
//! 对局详情（`GameDetail`）按 gameId 缓存且内容不可变，不参与这里的失效。

use std::time::{Duration, Instant};

/// 对局中写入的缓存条目存活时间（兜底：万一漏清也不会长期滞留）。
pub const IN_GAME_TTL: Duration = Duration::from_secs(20 * 60);

/// 对局外写入的缓存条目存活时间，与改造前战绩缓存的 60s 保持一致。
pub const OUT_OF_GAME_TTL: Duration = Duration::from_secs(60);

/// 使用长缓存的 gameflow 阶段：从选人到游戏结束前。
///
/// 结算阶段（`PreEndOfGame` / `EndOfGame`）刻意不在内，理由见模块文档。
const IN_GAME_PHASES: [&str; 5] = [
    "ChampSelect",
    "GameStart",
    "InProgress",
    "Reconnect",
    "WaitingForStats",
];

/// 判断阶段是否处于一局游戏之内。
pub fn is_in_game_phase(phase: &str) -> bool {
    IN_GAME_PHASES.contains(&phase)
}

/// 阶段从 `old` 切到 `new` 时，是否需要清空对局级缓存。
///
/// - 进入选人（新的一局，含秒退后重进）
/// - 离开对局阶段（进入结算 / 秒退）：本局的长缓存到此为止
///
/// # 示例
/// ```
/// use rank_analysis_lib::game_cache::should_invalidate;
/// assert!(should_invalidate("Lobby", "ChampSelect"));
/// assert!(should_invalidate("InProgress", "PreEndOfGame"));
/// assert!(!should_invalidate("ChampSelect", "InProgress"));
/// ```
pub fn should_invalidate(old: &str, new: &str) -> bool {
    if old == new {
        return false;
    }
    let entering_champ_select = new == "ChampSelect";
    let leaving_game = is_in_game_phase(old) && !is_in_game_phase(new);
    entering_champ_select || leaving_game
}

/// 清空全部对局级缓存（战绩列表、段位、用户标签）。
///
/// # 参数
/// - `reason`: 写进日志的触发原因，便于排查缓存命中情况
pub fn invalidate_all(reason: &str) {
    log::info!("清空对局级缓存: {}", reason);
    crate::lcu::api::match_history::invalidate_cache();
    crate::lcu::api::rank::invalidate_cache();
    crate::command::user_tag::invalidate_cache();
}

/// gameflow 阶段变化的钩子（由 phase 缓存在值变化时调用）。
pub fn on_phase_changed(old: &str, new: &str) {
    if should_invalidate(old, new) {
        invalidate_all(&format!("阶段 {} -> {}", old, new));
    }
}

/// 按写入时的阶段决定条目存活时间的 moka 过期策略。
///
/// 阶段读的是 phase 缓存里的最近值（WebSocket 事件与 2s 轮询共同维护），
/// 不发 LCU 请求。
pub struct GameScopedExpiry;

impl<K, V> moka::Expiry<K, V> for GameScopedExpiry {
    fn expire_after_create(&self, _key: &K, _value: &V, _created_at: Instant) -> Option<Duration> {
        let phase = crate::lcu::api::phase::cached_phase();
        Some(if is_in_game_phase(&phase) {
            IN_GAME_TTL
        } else {
            OUT_OF_GAME_TTL
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_invalidate_when_entering_champ_select() {
        assert!(should_invalidate("Lobby", "ChampSelect"));
        assert!(should_invalidate("", "ChampSelect"));
        assert!(should_invalidate("EndOfGame", "ChampSelect"));
    }

    #[test]
    fn should_invalidate_when_leaving_game() {
        assert!(should_invalidate("InProgress", "PreEndOfGame"));
        assert!(should_invalidate("WaitingForStats", "PreEndOfGame"));
        // 秒退：选人 → 大厅
        assert!(should_invalidate("ChampSelect", "Lobby"));
    }

    #[test]
    fn should_keep_cache_within_one_game() {
        assert!(!should_invalidate("ChampSelect", "GameStart"));
        assert!(!should_invalidate("GameStart", "InProgress"));
        assert!(!should_invalidate("InProgress", "Reconnect"));
        assert!(!should_invalidate("Reconnect", "InProgress"));
    }

    #[test]
    fn should_keep_cache_outside_game() {
        assert!(!should_invalidate("None", "Lobby"));
        assert!(!should_invalidate("Lobby", "Matchmaking"));
        assert!(!should_invalidate("Matchmaking", "ReadyCheck"));
        assert!(!should_invalidate("Lobby", "Lobby"));
        // 结算阶段写入的本就是短缓存，离开时无需再清
        assert!(!should_invalidate("PreEndOfGame", "EndOfGame"));
        assert!(!should_invalidate("EndOfGame", "Lobby"));
    }
}
