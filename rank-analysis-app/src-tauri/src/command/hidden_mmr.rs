//! # 隐藏分命令
//!
//! 读取本地记录、结合当前段位，返回算好的隐藏分估算。采集逻辑见 `hidden_mmr::collector`。

use crate::hidden_mmr::estimate::{estimate, HiddenMmr};
use crate::hidden_mmr::store::{self, LpRecord};
use crate::hidden_mmr::{axis, collector};
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
    Ok(build(&rank, &queue_type, file.records(&queue_type)))
}

/// 由段位和记录算出估算结果（纯函数，便于测试）。
pub fn build(rank: &Rank, queue_type: &str, records: &[LpRecord]) -> HiddenMmr {
    let Some(info) = collector::queue_info(rank, queue_type) else {
        return HiddenMmr::Hidden;
    };
    let score = axis::to_score(&info.tier, &info.division, info.league_points);
    estimate(records, score, info.is_provisional)
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
    fn should_hide_provisional_queue() {
        let mut rank = ranked("GOLD", "IV", 0);
        rank.queue_map.ranked_solo_5x5.is_provisional = true;
        assert_eq!(build(&rank, "RANKED_SOLO_5x5", &[]), HiddenMmr::Hidden);
    }
}
