//! # 隐藏分采集
//!
//! 每局排位结算后取本局 LP 加减分写入 [`super::store`]：
//!
//! 1. **主路径**：`current-lp-change-notification`，`gameId` 与本局一致才用
//! 2. **兜底**：主路径 2 分钟没等到时，用对局前（InProgress）与结算后的段位快照相减
//!
//! 剔除挂机 / 安慰分 / 定级赛 / 掉段保护等不反映隐藏分的局，规则集中在本文件的纯函数里。

use super::axis;
use super::store::{LpRecord, Source};
use crate::lcu::api::rank::{LpChangeNotification, QueueInfo, Rank};

/// 参与隐藏分估算的排位队列。
pub const RANKED_QUEUES: [&str; 2] = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"];

/// 是否为参与估算的排位队列。
pub fn is_ranked_queue(queue_type: &str) -> bool {
    RANKED_QUEUES.contains(&queue_type)
}

/// 从段位概览里取指定队列的段位；非排位队列返回 `None`。
pub fn queue_info<'a>(rank: &'a Rank, queue_type: &str) -> Option<&'a QueueInfo> {
    match queue_type {
        "RANKED_SOLO_5x5" => Some(&rank.queue_map.ranked_solo_5x5),
        "RANKED_FLEX_SR" => Some(&rank.queue_map.ranked_flex_sr),
        _ => None,
    }
}

/// 对一条 LP 变化通知的判定结果。
#[derive(Debug, PartialEq)]
pub enum NotificationOutcome {
    /// 是本局且有效
    Accepted(LpRecord),
    /// 是本局但不计入，附原因（用于日志）
    Rejected(&'static str),
    /// 还是上一局的通知，继续等
    NotYet,
}

/// 判定通知是否可以记为本局记录。
///
/// # 参数
/// - `n`: 刚拉到的通知
/// - `expected_game_id`: 本局 gameId
/// - `now_ms`: 记录时间（Unix 毫秒）
pub fn judge_notification(
    n: &LpChangeNotification,
    expected_game_id: i64,
    now_ms: i64,
) -> NotificationOutcome {
    if n.game_id != expected_game_id {
        return NotificationOutcome::NotYet;
    }
    if !is_ranked_queue(&n.queue_type) {
        return NotificationOutcome::Rejected("非排位队列");
    }
    if n.change_reason != "GAME_END" {
        return NotificationOutcome::Rejected("非对局结算");
    }
    if n.afk_lp_penalty_amount != 0 || n.was_afk_or_leaver {
        return NotificationOutcome::Rejected("挂机或逃跑惩罚");
    }
    if n.consolation_lp_used != 0 {
        return NotificationOutcome::Rejected("使用了安慰分");
    }
    if n.provisional_games_remaining > 0 {
        return NotificationOutcome::Rejected("定级赛");
    }
    if n.league_points_delta == 0 {
        return NotificationOutcome::Rejected("LP 无变化（掉段保护等）");
    }
    NotificationOutcome::Accepted(LpRecord {
        game_id: n.game_id,
        queue_type: n.queue_type.clone(),
        delta: n.league_points_delta,
        tier_after: n.tier.clone(),
        division_after: n.division.clone(),
        lp_after: n.league_points,
        timestamp: now_ms,
        source: Source::Notification,
    })
}

/// 用对局前后的段位快照算本局记录（兜底路径）。
///
/// 只有胜 + 负场数**恰好增加 1** 才算一局（秒退、掉分、连打两局都会被过滤）；
/// 定级赛、LP 无变化（掉段保护）时返回 `None`。
pub fn snapshot_record(
    game_id: i64,
    queue_type: &str,
    before: &QueueInfo,
    after: &QueueInfo,
    now_ms: i64,
) -> Option<LpRecord> {
    if before.is_provisional || after.is_provisional {
        return None;
    }
    let played = (after.wins + after.losses) - (before.wins + before.losses);
    if played != 1 {
        return None;
    }
    let from = axis::to_score(&before.tier, &before.division, before.league_points)?;
    let to = axis::to_score(&after.tier, &after.division, after.league_points)?;
    let delta = to - from;
    if delta == 0 {
        return None;
    }
    Some(LpRecord {
        game_id,
        queue_type: queue_type.to_string(),
        delta,
        tier_after: after.tier.clone(),
        division_after: after.division.clone(),
        lp_after: after.league_points,
        timestamp: now_ms,
        source: Source::Snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification() -> LpChangeNotification {
        LpChangeNotification {
            game_id: 301_056_769_722,
            queue_type: "RANKED_SOLO_5x5".to_string(),
            league_points_delta: 19,
            tier: "EMERALD".to_string(),
            division: "III".to_string(),
            league_points: 5,
            change_reason: "GAME_END".to_string(),
            ..Default::default()
        }
    }

    fn queue(tier: &str, division: &str, lp: i32, wins: i32, losses: i32) -> QueueInfo {
        QueueInfo {
            queue_type: "RANKED_SOLO_5x5".to_string(),
            tier: tier.to_string(),
            division: division.to_string(),
            league_points: lp,
            wins,
            losses,
            ..Default::default()
        }
    }

    #[test]
    fn should_accept_matching_game_end_notification() {
        let NotificationOutcome::Accepted(r) =
            judge_notification(&notification(), 301_056_769_722, 42)
        else {
            panic!("expected accepted");
        };
        assert_eq!(r.delta, 19);
        assert_eq!(r.tier_after, "EMERALD");
        assert_eq!(r.lp_after, 5);
        assert_eq!(r.timestamp, 42);
        assert_eq!(r.source, Source::Notification);
    }

    #[test]
    fn should_wait_when_notification_is_from_previous_game() {
        assert_eq!(
            judge_notification(&notification(), 999, 0),
            NotificationOutcome::NotYet
        );
    }

    #[test]
    fn should_reject_abnormal_games() {
        let cases: Vec<LpChangeNotification> = vec![
            LpChangeNotification {
                queue_type: "CHERRY".into(),
                ..notification()
            },
            LpChangeNotification {
                change_reason: "DECAY".into(),
                ..notification()
            },
            LpChangeNotification {
                afk_lp_penalty_amount: 5,
                ..notification()
            },
            LpChangeNotification {
                was_afk_or_leaver: true,
                ..notification()
            },
            LpChangeNotification {
                consolation_lp_used: 4,
                ..notification()
            },
            LpChangeNotification {
                provisional_games_remaining: 2,
                ..notification()
            },
            LpChangeNotification {
                league_points_delta: 0,
                ..notification()
            },
        ];
        for n in cases {
            assert!(
                matches!(
                    judge_notification(&n, n.game_id, 0),
                    NotificationOutcome::Rejected(_)
                ),
                "{n:?}"
            );
        }
    }

    #[test]
    fn should_diff_snapshot_across_division_boundary() {
        let before = queue("EMERALD", "IV", 90, 258, 258);
        let after = queue("EMERALD", "III", 5, 259, 258);
        let r = snapshot_record(1, "RANKED_SOLO_5x5", &before, &after, 7).unwrap();
        assert_eq!(r.delta, 15);
        assert_eq!(r.division_after, "III");
        assert_eq!(r.source, Source::Snapshot);
    }

    #[test]
    fn should_diff_snapshot_on_demotion() {
        let before = queue("DIAMOND", "IV", 0, 10, 10);
        let after = queue("EMERALD", "I", 82, 10, 11);
        assert_eq!(
            snapshot_record(1, "RANKED_SOLO_5x5", &before, &after, 0)
                .unwrap()
                .delta,
            -18
        );
    }

    #[test]
    fn should_drop_snapshot_unless_exactly_one_game_played() {
        let before = queue("GOLD", "II", 50, 10, 10);
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "II", 30, 10, 10),
            0
        )
        .is_none());
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "II", 90, 12, 10),
            0
        )
        .is_none());
    }

    #[test]
    fn should_drop_snapshot_for_shield_or_placement() {
        let before = queue("GOLD", "IV", 0, 10, 10);
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "IV", 0, 10, 11),
            0
        )
        .is_none());
        let placement = QueueInfo {
            is_provisional: true,
            ..queue("GOLD", "IV", 0, 1, 0)
        };
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &placement,
            &queue("GOLD", "IV", 20, 2, 0),
            0
        )
        .is_none());
    }

    #[test]
    fn should_pick_queue_info_by_type() {
        let mut rank = Rank::default();
        rank.queue_map.ranked_flex_sr.tier = "GOLD".into();
        assert_eq!(queue_info(&rank, "RANKED_FLEX_SR").unwrap().tier, "GOLD");
        assert!(queue_info(&rank, "CHERRY").is_none());
    }
}
