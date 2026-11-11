//! # 隐藏分估算
//!
//! 思路：隐藏分高于段位时赢得多、输得少，反之亦然。用最近若干局
//! 「平均赢分 − 平均输分」的差折算成偏移量，叠加到当前段位上。

use serde::Serialize;

use super::axis;
use super::store::{LpRecord, Source};

/// 参与估算的最近记录数。
pub const WINDOW: usize = 10;

/// 至少要有这么多条记录才给出估算。
pub const MIN_RECORDS: usize = 3;

/// 「平均赢分 − 平均输分」每差 1 LP，折算成多少 LP 的隐藏分偏移。
///
/// 经验取值，不是拳头公开的算法：+28/−14 这种明显不对称时偏移约 140，
/// 即约一个半小段（取 10 即得 140）；后续可按实测数据调整。
pub const OFFSET_PER_LP_GAP: f64 = 10.0;

/// |偏移| 不超过该值视为「持平」，避免一两分的波动来回翻箭头。
pub const FLAT_THRESHOLD: i32 = 50;

/// 双倍胜点判定：本局赢分至少是其余赢局中位数的这么多倍才怀疑是双倍。
///
/// 国服有双倍胜点卡等活动（2026-11-08 实测一局 +40，前后正常赢局都是 +20），
/// LP 变化通知里暂未找到能标记双倍的字段，只能按数值识别。
pub const DOUBLE_MIN_RATIO: f64 = 1.6;

/// 双倍胜点判定：本局赢分与「其余赢局中位数 × 2」的最大偏差（LP），
/// 取 4 LP 与 15% 中的较大者，容纳相邻几局之间自然的一两分浮动。
pub const DOUBLE_TOLERANCE_LP: f64 = 4.0;
pub const DOUBLE_TOLERANCE_RATIO: f64 = 0.15;

/// 最近一局的加减分，供 tooltip 展示。
///
/// - `delta`: 实际加减分（双倍局为翻倍后的原值，便于和客户端对照）
/// - `doubled`: 是否判定为双倍胜点；为 true 时估算按 `delta / 2` 计
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentDelta {
    pub delta: i32,
    pub source: Source,
    pub doubled: bool,
}

/// 隐藏分相对当前段位的方向。
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Flat,
    Down,
}

/// 「数据收集中」的原因：记录不够，或者只有一种胜负结果。
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectingReason {
    TooFew,
    OneSided,
}

/// 估算结果，序列化后与前端 `services/hiddenMmr.ts` 的 `HiddenMmr` 一一对应。
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HiddenMmr {
    /// 未定级 / 定级赛中：不显示
    Hidden,
    /// 数据不足
    Collecting {
        reason: CollectingReason,
        have: usize,
        need: usize,
    },
    /// 已给出估算
    Ready {
        /// 隐藏分在分数轴上的值
        score: i32,
        /// 等效段位文案，如「璀璨钻石 II 40LP」
        equivalent: String,
        /// 等效段位短文案，如「钻石 II 40LP」，用于卡片隐藏分行
        equivalent_short: String,
        /// 等效大段英文键（大师以上统一 `MASTER`），用于查段位图标
        equivalent_tier: String,
        /// 相对当前段位的偏移（LP）
        offset: i32,
        direction: Direction,
        /// 平均赢分（保留一位小数）
        avg_win: f64,
        /// 平均输分的绝对值（保留一位小数）
        avg_loss: f64,
        /// 窗口内的记录，新 → 旧
        recent: Vec<RecentDelta>,
    },
}

fn mean(values: &[i32]) -> f64 {
    values.iter().map(|v| *v as f64).sum::<f64>() / values.len() as f64
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn median(values: &mut [i32]) -> f64 {
    values.sort_unstable();
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2] as f64
    } else {
        (values[n / 2 - 1] + values[n / 2]) as f64 / 2.0
    }
}

/// 识别窗口内的双倍胜点局。
///
/// 只看赢局：双倍胜点卡只作用于赢局。一局赢分 ≥ 其余赢局中位数 × 1.6，
/// 且接近中位数的 2 倍（偏差不超过容差）才算双倍；没有其余赢局时无从比较，不判定。
///
/// # 返回值
/// 与 `deltas` 等长，true 表示该局判定为双倍。
pub fn detect_doubled(deltas: &[i32]) -> Vec<bool> {
    deltas
        .iter()
        .enumerate()
        .map(|(i, &d)| {
            if d <= 0 {
                return false;
            }
            let mut others: Vec<i32> = deltas
                .iter()
                .enumerate()
                .filter(|(j, v)| *j != i && **v > 0)
                .map(|(_, v)| *v)
                .collect();
            if others.is_empty() {
                return false;
            }
            let base = median(&mut others);
            let expected = base * 2.0;
            let tolerance = DOUBLE_TOLERANCE_LP.max(expected * DOUBLE_TOLERANCE_RATIO);
            d as f64 >= base * DOUBLE_MIN_RATIO && (d as f64 - expected).abs() <= tolerance
        })
        .collect()
}

/// 由记录和当前段位算出隐藏分。
///
/// # 参数
/// - `records`: 该队列的记录，旧 → 新
/// - `current_score`: 当前段位在轴上的分数；`None` 表示未定级
/// - `provisional`: 是否在定级赛中
///
/// # 返回值
/// 见 [`HiddenMmr`] 各分支。
pub fn estimate(records: &[LpRecord], current_score: Option<i32>, provisional: bool) -> HiddenMmr {
    let Some(current) = current_score else {
        return HiddenMmr::Hidden;
    };
    if provisional {
        return HiddenMmr::Hidden;
    }
    let window = &records[records.len().saturating_sub(WINDOW)..];
    if window.len() < MIN_RECORDS {
        return HiddenMmr::Collecting {
            reason: CollectingReason::TooFew,
            have: window.len(),
            need: MIN_RECORDS,
        };
    }
    let raw: Vec<i32> = window.iter().map(|r| r.delta).collect();
    let doubled = detect_doubled(&raw);
    // 双倍局按一半计：保留这局「赢了、正常该加多少」的信息，而不是整局丢掉
    let effective: Vec<i32> = raw
        .iter()
        .zip(&doubled)
        .map(|(d, dbl)| {
            if *dbl {
                (*d as f64 / 2.0).round() as i32
            } else {
                *d
            }
        })
        .collect();
    let wins: Vec<i32> = effective.iter().copied().filter(|d| *d > 0).collect();
    let losses: Vec<i32> = effective
        .iter()
        .copied()
        .filter(|d| *d < 0)
        .map(i32::abs)
        .collect();
    if wins.is_empty() || losses.is_empty() {
        return HiddenMmr::Collecting {
            reason: CollectingReason::OneSided,
            have: window.len(),
            need: MIN_RECORDS,
        };
    }
    let avg_win = mean(&wins);
    let avg_loss = mean(&losses);
    let offset = ((avg_win - avg_loss) * OFFSET_PER_LP_GAP).round() as i32;
    let score = (current + offset).max(0);
    let direction = if offset > FLAT_THRESHOLD {
        Direction::Up
    } else if offset < -FLAT_THRESHOLD {
        Direction::Down
    } else {
        Direction::Flat
    };
    HiddenMmr::Ready {
        score,
        equivalent: axis::format_score(score),
        equivalent_short: axis::format_score_short(score),
        equivalent_tier: axis::tier_of_score(score).to_string(),
        offset,
        direction,
        avg_win: round1(avg_win),
        avg_loss: round1(avg_loss),
        recent: window
            .iter()
            .zip(&doubled)
            .rev()
            .map(|(r, dbl)| RecentDelta {
                delta: r.delta,
                source: r.source,
                doubled: *dbl,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec(game_id: i64, delta: i32) -> LpRecord {
        LpRecord {
            game_id,
            queue_type: "RANKED_SOLO_5x5".to_string(),
            delta,
            tier_after: "DIAMOND".to_string(),
            division_after: "IV".to_string(),
            lp_after: 40,
            timestamp: 0,
            source: Source::Notification,
        }
    }

    fn recs(deltas: &[i32]) -> Vec<LpRecord> {
        deltas
            .iter()
            .enumerate()
            .map(|(i, d)| rec(i as i64, *d))
            .collect()
    }

    #[test]
    fn should_hide_when_unranked() {
        assert_eq!(
            estimate(&recs(&[20, -20, 20]), None, false),
            HiddenMmr::Hidden
        );
    }

    #[test]
    fn should_hide_during_placements() {
        assert_eq!(
            estimate(&recs(&[20, -20, 20]), Some(2440), true),
            HiddenMmr::Hidden
        );
    }

    #[test]
    fn should_collect_when_too_few_records() {
        assert_eq!(
            estimate(&recs(&[20, -20]), Some(2440), false),
            HiddenMmr::Collecting {
                reason: CollectingReason::TooFew,
                have: 2,
                need: 3
            }
        );
        assert_eq!(
            estimate(&[], Some(2440), false),
            HiddenMmr::Collecting {
                reason: CollectingReason::TooFew,
                have: 0,
                need: 3
            }
        );
    }

    #[test]
    fn should_collect_when_only_wins_or_only_losses() {
        assert_eq!(
            estimate(&recs(&[20, 22, 25]), Some(2440), false),
            HiddenMmr::Collecting {
                reason: CollectingReason::OneSided,
                have: 3,
                need: 3
            }
        );
        assert_eq!(
            estimate(&recs(&[-20, -22, -25]), Some(2440), false),
            HiddenMmr::Collecting {
                reason: CollectingReason::OneSided,
                have: 3,
                need: 3
            }
        );
    }

    #[test]
    fn should_shift_score_by_win_loss_gap() {
        let HiddenMmr::Ready {
            score,
            equivalent,
            equivalent_short,
            equivalent_tier,
            offset,
            direction,
            avg_win,
            avg_loss,
            ..
        } = estimate(&recs(&[28, -14, 28]), Some(2440), false)
        else {
            panic!("expected ready");
        };
        assert_eq!(avg_win, 28.0);
        assert_eq!(avg_loss, 14.0);
        assert_eq!(offset, 140);
        assert_eq!(score, 2580);
        assert_eq!(equivalent, "璀璨钻石 III 80LP");
        assert_eq!(equivalent_tier, "DIAMOND");
        assert_eq!(equivalent_short, "钻石 III 80LP");
        assert_eq!(direction, Direction::Up);
    }

    #[test]
    fn should_use_only_latest_window() {
        let mut deltas = vec![90, 90];
        for i in 0..WINDOW {
            deltas.push(if i % 2 == 0 { 20 } else { -20 });
        }
        let HiddenMmr::Ready { offset, recent, .. } = estimate(&recs(&deltas), Some(2440), false)
        else {
            panic!("expected ready");
        };
        assert_eq!(offset, 0);
        assert_eq!(recent.len(), WINDOW);
    }

    #[test]
    fn should_classify_direction_with_threshold() {
        let dir = |deltas: &[i32]| match estimate(&recs(deltas), Some(2440), false) {
            HiddenMmr::Ready { direction, .. } => direction,
            other => panic!("expected ready, got {other:?}"),
        };
        assert_eq!(dir(&[22, -18, 22, -18]), Direction::Flat);
        assert_eq!(dir(&[24, -18, 24, -18]), Direction::Up);
        assert_eq!(dir(&[14, -20, 14, -20]), Direction::Down);
    }

    #[test]
    fn should_list_recent_newest_first() {
        let HiddenMmr::Ready { recent, .. } = estimate(&recs(&[20, -15, 18]), Some(2440), false)
        else {
            panic!("expected ready");
        };
        assert_eq!(recent[0].delta, 18);
        assert_eq!(recent[2].delta, 20);
    }

    #[test]
    fn should_halve_doubled_win_in_estimate() {
        // 2026-11-08 实测序列：最后一局双倍胜点 +40
        let HiddenMmr::Ready {
            avg_win,
            avg_loss,
            offset,
            recent,
            ..
        } = estimate(&recs(&[-20, 20, -20, -20, 20, 40]), Some(2440), false)
        else {
            panic!("expected ready");
        };
        assert_eq!(avg_win, 20.0);
        assert_eq!(avg_loss, 20.0);
        assert_eq!(offset, 0);
        assert_eq!(recent[0].delta, 40);
        assert!(recent[0].doubled);
        assert!(!recent[1].doubled);
    }

    #[test]
    fn should_detect_doubled_only_near_twice_the_median_win() {
        assert_eq!(detect_doubled(&[20, -20, 40]), vec![false, false, true]);
        // 自然浮动：+26 对 +20 不到 1.6 倍
        assert_eq!(detect_doubled(&[20, 26, -18]), vec![false, false, false]);
        // 远超 2 倍（如 +60 对 +20）不像双倍，不处理
        assert_eq!(detect_doubled(&[20, 60, -18]), vec![false, false, false]);
        // 2 倍附近有容差：+38 对 +19
        assert_eq!(
            detect_doubled(&[19, 18, 38, -20]),
            vec![false, false, true, false]
        );
        // 只有一局赢：无从比较
        assert_eq!(detect_doubled(&[40, -20, -20]), vec![false, false, false]);
        // 输局不判定
        assert_eq!(detect_doubled(&[-20, -40, 20]), vec![false, false, false]);
    }

    #[test]
    fn should_never_go_below_zero() {
        let HiddenMmr::Ready { score, .. } = estimate(&recs(&[5, -30, 5]), Some(10), false) else {
            panic!("expected ready");
        };
        assert_eq!(score, 0);
    }

    #[test]
    fn should_serialize_with_status_tag_and_camel_case() {
        assert_eq!(
            serde_json::to_value(HiddenMmr::Hidden).unwrap(),
            json!({ "status": "hidden" })
        );
        assert_eq!(
            serde_json::to_value(HiddenMmr::Collecting {
                reason: CollectingReason::OneSided,
                have: 3,
                need: 3
            })
            .unwrap(),
            json!({ "status": "collecting", "reason": "one_sided", "have": 3, "need": 3 })
        );
        let ready =
            serde_json::to_value(estimate(&recs(&[28, -14, 28]), Some(2440), false)).unwrap();
        assert_eq!(ready["status"], "ready");
        assert_eq!(ready["avgWin"], 28.0);
        assert_eq!(ready["direction"], "up");
        assert_eq!(ready["equivalentTier"], "DIAMOND");
        assert_eq!(ready["equivalentShort"], "钻石 III 80LP");
        assert_eq!(ready["recent"][0]["source"], "notification");
        assert_eq!(ready["recent"][0]["doubled"], false);
    }
}
