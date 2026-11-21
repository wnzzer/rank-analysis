//! # 隐藏分命令
//!
//! 读取本地记录、结合当前段位，返回算好的隐藏分估算。采集逻辑见 `hidden_mmr::collector`。
//! 加减分记录不足时，改用上一局全员平均段位作初步估算（见 `hidden_mmr::lobby`）。

use crate::hidden_mmr::estimate::{estimate, with_lobby_fallback, HiddenMmr};
use crate::hidden_mmr::store::{self, LpRecord};
use crate::hidden_mmr::{axis, collector, lobby};
use crate::lcu::api::rank::Rank;

/// 获取某召唤师某排位队列的隐藏分估算。
///
/// # 参数
/// - `puuid`: 召唤师 PUUID（前端只对当前登录的召唤师调用）
/// - `queue_type`: `RANKED_SOLO_5x5` 或 `RANKED_FLEX_SR`
///
/// # 错误
/// 队列不支持，或拉段位失败时返回错误信息。
#[tauri::command]
pub async fn get_hidden_mmr(puuid: String, queue_type: String) -> Result<HiddenMmr, String> {
    if !collector::is_ranked_queue(&queue_type) {
        return Err(format!("不支持的队列: {}", queue_type));
    }
    let rank = Rank::get_rank_by_puuid(&puuid).await?;
    let file = store::load(&store::default_dir(), &puuid);
    let result = build(&rank, &queue_type, file.records(&queue_type));
    // 只在记录不足时才去取上一局十个人的段位：正式估算不需要它，省掉这十来个请求
    if !matches!(result, HiddenMmr::Collecting { .. }) {
        return Ok(result);
    }
    let lobby = lobby::last_game_lobby(&puuid, &queue_type).await;
    Ok(with_lobby_fallback(
        result,
        current_score(&rank, &queue_type),
        lobby,
    ))
}

/// 当前段位在分数轴上的值；未定级为 `None`。
fn current_score(rank: &Rank, queue_type: &str) -> Option<i32> {
    let info = collector::queue_info(rank, queue_type)?;
    axis::to_score(&info.tier, &info.division, info.league_points)
}

/// 由段位和记录算出估算结果（纯函数，便于测试）。
pub fn build(rank: &Rank, queue_type: &str, records: &[LpRecord]) -> HiddenMmr {
    let Some(info) = collector::queue_info(rank, queue_type) else {
        return HiddenMmr::Hidden;
    };
    estimate(
        records,
        current_score(rank, queue_type),
        info.is_provisional,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hidden_mmr::estimate::CollectingReason;
    use crate::hidden_mmr::store::Source;

    fn ranked(tier: &str, division: &str, lp: i32) -> Rank {
        let mut rank = Rank::default();
        let solo = &mut rank.queue_map.ranked_solo_5x5;
        solo.tier = tier.into();
        solo.division = division.into();
        solo.league_points = lp;
        rank
    }

    fn rec(game_id: i64, delta: i32) -> LpRecord {
        LpRecord {
            game_id,
            queue_type: "RANKED_SOLO_5x5".into(),
            delta,
            tier_after: "DIAMOND".into(),
            division_after: "IV".into(),
            lp_after: 40,
            timestamp: 0,
            source: Source::Notification,
        }
    }

    #[test]
    fn should_hide_unranked_queue() {
        assert_eq!(
            build(&Rank::default(), "RANKED_SOLO_5x5", &[]),
            HiddenMmr::Hidden
        );
    }

    #[test]
    fn should_collect_when_ranked_without_records() {
        assert_eq!(
            build(&ranked("DIAMOND", "IV", 40), "RANKED_SOLO_5x5", &[]),
            HiddenMmr::Collecting {
                reason: CollectingReason::TooFew,
                have: 0,
                need: 3
            }
        );
    }

    #[test]
    fn should_anchor_on_current_rank() {
        let records = [rec(1, 28), rec(2, -14), rec(3, 28)];
        let HiddenMmr::Ready { score, .. } =
            build(&ranked("DIAMOND", "IV", 40), "RANKED_SOLO_5x5", &records)
        else {
            panic!("expected ready");
        };
        assert_eq!(score, 2580);
    }

    #[test]
    fn should_fall_back_to_lobby_average_when_records_are_too_few() {
        use crate::hidden_mmr::estimate::Direction;
        use crate::hidden_mmr::lobby::LobbyAverage;

        // 钻石 IV 40LP = 2440；上一局十人平均 2600（钻石 II 0LP）
        let rank = ranked("DIAMOND", "IV", 40);
        let collecting = build(&rank, "RANKED_SOLO_5x5", &[rec(1, 20)]);

        let result = with_lobby_fallback(
            collecting,
            current_score(&rank, "RANKED_SOLO_5x5"),
            Some(LobbyAverage {
                game_id: 1,
                score: 2600,
                players: 9,
            }),
        );

        let HiddenMmr::Lobby {
            score,
            offset,
            direction,
            players,
            have,
            need,
            reason,
            ..
        } = result
        else {
            panic!("expected lobby fallback");
        };
        assert_eq!((score, offset, players), (2600, 160, 9));
        assert_eq!(direction, Direction::Up);
        assert_eq!((have, need, reason), (1, 3, CollectingReason::TooFew));
    }

    #[test]
    fn should_fall_back_to_lobby_average_when_results_are_one_sided() {
        use crate::hidden_mmr::lobby::LobbyAverage;

        let rank = ranked("DIAMOND", "IV", 40);
        let collecting = build(
            &rank,
            "RANKED_SOLO_5x5",
            &[rec(1, 20), rec(2, 21), rec(3, 22)],
        );

        let result = with_lobby_fallback(
            collecting,
            current_score(&rank, "RANKED_SOLO_5x5"),
            Some(LobbyAverage {
                game_id: 3,
                score: 2440,
                players: 10,
            }),
        );

        assert!(matches!(
            result,
            HiddenMmr::Lobby {
                offset: 0,
                reason: CollectingReason::OneSided,
                ..
            }
        ));
    }

    #[test]
    fn should_keep_collecting_when_lobby_average_is_unavailable() {
        let rank = ranked("DIAMOND", "IV", 40);
        let collecting = build(&rank, "RANKED_SOLO_5x5", &[]);

        let result = with_lobby_fallback(
            collecting.clone(),
            current_score(&rank, "RANKED_SOLO_5x5"),
            None,
        );

        assert_eq!(result, collecting);
    }

    #[test]
    fn should_not_replace_a_real_estimate_with_lobby_average() {
        use crate::hidden_mmr::lobby::LobbyAverage;

        let rank = ranked("DIAMOND", "IV", 40);
        let ready = build(
            &rank,
            "RANKED_SOLO_5x5",
            &[rec(1, 28), rec(2, -14), rec(3, 28)],
        );

        let result = with_lobby_fallback(
            ready.clone(),
            current_score(&rank, "RANKED_SOLO_5x5"),
            Some(LobbyAverage {
                game_id: 3,
                score: 1000,
                players: 10,
            }),
        );

        assert_eq!(result, ready);
    }

    #[test]
    fn should_not_show_lobby_average_for_unranked_queue() {
        use crate::hidden_mmr::lobby::LobbyAverage;

        let hidden = build(&Rank::default(), "RANKED_SOLO_5x5", &[]);

        let result = with_lobby_fallback(
            hidden,
            None,
            Some(LobbyAverage {
                game_id: 1,
                score: 2000,
                players: 10,
            }),
        );

        assert_eq!(result, HiddenMmr::Hidden);
    }

    #[test]
    fn should_hide_provisional_queue() {
        let mut rank = ranked("GOLD", "IV", 0);
        rank.queue_map.ranked_solo_5x5.is_provisional = true;
        assert_eq!(build(&rank, "RANKED_SOLO_5x5", &[]), HiddenMmr::Hidden);
    }
}
