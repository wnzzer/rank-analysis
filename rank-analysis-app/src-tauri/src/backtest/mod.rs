//! # 决策回测（backtest，战场二 / ADR-6）
//!
//! 赛后把"赛前建议 vs 实际选择"做成**描述性对位对比**，而不是因果反事实：
//! 单人替换英雄有蝴蝶效应，静态胜率表算出的"胜率变化 X%"是虚假精确。
//! 因此本模块只输出「建议英雄 vs 实际英雄，在当前敌方对位下各自的历史表现
//! 差异」（`matchup_delta`），`confidence` 封顶且恒带 caveats。
//!
//! **纪律**：
//! - 胜率基准主链用**本地历史**（本机该英雄+位置+分段的表现样本）；外部
//!   counter 数据（OP.GG 等）仅作增强，缺样本即降级，绝不编造。
//! - 数据不足阈值写死：本地对位样本 <5 局 或 双方对位样本 <3 局 → `数据不足`。
//! - 采纳/未采纳对账由 [`store`] 持久化，防幸存者偏差。

pub mod store;

/// 数据不足判定阈值（§路线图 v1.3）：本地对位样本低于该值 → 数据不足。
pub const MIN_LOCAL_SAMPLES: usize = 5;
/// 双方对位样本下限（任一方低于该值 → 数据不足）。
pub const MIN_MATCHUP_SAMPLES: usize = 3;
/// 置信度封顶（初始占位 0.4；最终值经校准实验确定，见路线图 §6.5.3）。
pub const CONFIDENCE_CAP: f64 = 0.4;

/// 一名玩家的对位历史样本（本地沉淀数据，一局一条）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupSample {
    /// 该玩家使用的英雄
    pub champion_id: i32,
    /// 分路（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY；缺失按 ""）
    pub position: String,
    /// 对位敌方英雄
    pub enemy_champion_id: i32,
    /// 本局是否获胜
    pub win: bool,
    /// 本局 17 分制总分（表现分）
    pub score: f64,
}

/// 赛前的一条建议（建议英雄 + 实际英雄 + 敌方对位 + 本地样本）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestInput {
    /// 建议的英雄（选人期引擎推荐）
    pub suggestion_champion_id: i32,
    /// 实际选择的英雄
    pub actual_champion_id: i32,
    /// 对位敌方英雄（实际对局中与我对线的）
    pub enemy_champion_id: i32,
    /// 建议英雄的本地历史样本
    pub suggestion_samples: Vec<MatchupSample>,
    /// 实际英雄的本地历史样本
    pub actual_samples: Vec<MatchupSample>,
}

/// 回测结果：描述性对位差异（非因果）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestResult {
    pub suggestion_champion_id: i32,
    pub actual_champion_id: i32,
    /// 建议英雄与实选英雄的（胜率 / 表现分）历史差异——**描述性对比，非因果**。
    pub matchup_delta: f64,
    /// 胜率（建议 vs 实际）历史均值之差，0~1 标度。
    pub win_rate_gap: f64,
    /// 表现分（17 分制）历史均值之差。
    pub score_gap: f64,
    /// 封顶置信度（[`CONFIDENCE_CAP`]；随样本量上升）。
    pub confidence: f64,
    /// 恒非空：口径声明（"基于分段平均，非因果推断"）+ 样本量说明。
    pub caveats: Vec<String>,
    /// 数据不足（样本未达阈值）时为 true，delta 无意义。
    pub insufficient_data: bool,
}

/// 对一组样本求均值（空样本返回 None，纪律：不编造）。
fn mean(samples: &[MatchupSample], pick: impl Fn(&MatchupSample) -> f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let sum: f64 = samples.iter().map(&pick).sum();
    Some(sum / samples.len() as f64)
}

/// 胜率均值（0~1）。
fn win_rate(samples: &[MatchupSample]) -> Option<f64> {
    mean(samples, |s| f64::from(s.win))
}

/// 描述性对位对比（纯函数）。
///
/// - 样本不足（建议/实选任一侧 < [`MIN_MATCHUP_SAMPLES`]，或合计 <
///   [`MIN_LOCAL_SAMPLES`]）→ `insufficient_data=true`，delta 记 0 且 caveats
///   说明"数据不足"，前端按"无回测"降级。
/// - 输出恒带 [`CONFIDENCE_CAP`] 封顶的置信度与口径 caveats。
pub fn compute_backtest(input: &BacktestInput) -> BacktestResult {
    let suggestion_win = win_rate(&input.suggestion_samples);
    let actual_win = win_rate(&input.actual_samples);
    let suggestion_score = mean(&input.suggestion_samples, |s| s.score);
    let actual_score = mean(&input.actual_samples, |s| s.score);

    let total_samples = input.suggestion_samples.len() + input.actual_samples.len();
    let insufficient = total_samples < MIN_LOCAL_SAMPLES
        || input.suggestion_samples.len() < MIN_MATCHUP_SAMPLES
        || input.actual_samples.len() < MIN_MATCHUP_SAMPLES;

    let (win_rate_gap, score_gap, matchup_delta, confidence) = match (suggestion_win, actual_win, suggestion_score, actual_score) {
        (Some(s_win), Some(a_win), Some(s_score), Some(a_score)) if !insufficient => {
            let wr_gap = s_win - a_win;
            let sc_gap = s_score - a_score;
            // 综合差异：胜率差为主、表现分差为辅（都归一化到 ±1 内）。
            let delta = wr_gap * 0.7 + (sc_gap / 17.0) * 0.3;
            let confidence = (CONFIDENCE_CAP * total_samples as f64 / (MIN_LOCAL_SAMPLES * 2) as f64).min(CONFIDENCE_CAP);
            (wr_gap, sc_gap, delta, confidence)
        }
        _ => (0.0, 0.0, 0.0, 0.0),
    };

    let mut caveats = vec![
        "基于分段平均的历史表现差异，非因果推断".to_string(),
        format!("样本：建议 {} 局 / 实际 {} 局", input.suggestion_samples.len(), input.actual_samples.len()),
    ];
    if insufficient {
        caveats.push(format!(
            "数据不足（阈值：本地 ≥{MIN_LOCAL_SAMPLES} 局且双方各 ≥{MIN_MATCHUP_SAMPLES} 局），本结果不作建议依据"
        ));
    }

    BacktestResult {
        suggestion_champion_id: input.suggestion_champion_id,
        actual_champion_id: input.actual_champion_id,
        matchup_delta,
        win_rate_gap,
        score_gap,
        confidence,
        caveats,
        insufficient_data: insufficient,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(champion: i32, win: bool, score: f64) -> MatchupSample {
        MatchupSample {
            champion_id: champion,
            position: "MIDDLE".to_string(),
            enemy_champion_id: 1,
            win,
            score,
        }
    }

    fn input(
        suggestion: Vec<MatchupSample>,
        actual: Vec<MatchupSample>,
    ) -> BacktestInput {
        BacktestInput {
            suggestion_champion_id: 1,
            actual_champion_id: 2,
            enemy_champion_id: 3,
            suggestion_samples: suggestion,
            actual_samples: actual,
        }
    }

    #[test]
    fn sufficient_data_produces_delta_with_capped_confidence() {
        // 建议英雄 60% 胜率、实际英雄 40% 胜率 → 正向 gap，置信度封顶 0.4
        let suggestion: Vec<_> = (0..6).map(|i| sample(1, i < 4, 11.0)).collect();
        let actual: Vec<_> = (0..6).map(|i| sample(2, i < 2, 9.0)).collect();
        let r = compute_backtest(&input(suggestion, actual));
        assert!(!r.insufficient_data);
        assert!(r.win_rate_gap > 0.0);
        assert!(r.score_gap > 0.0);
        assert!(r.matchup_delta > 0.0);
        assert!(r.confidence <= CONFIDENCE_CAP, "置信度必须封顶");
        assert!(r.confidence > 0.0, "样本充足时置信度应 > 0");
        assert!(r.caveats.iter().any(|c| c.contains("非因果")));
    }

    #[test]
    fn insufficient_samples_degrades_honestly() {
        // 双方各 2 局 → 数据不足，delta=0，不编造
        let suggestion = vec![sample(1, true, 11.0), sample(1, false, 9.0)];
        let actual = vec![sample(2, true, 10.0), sample(2, false, 8.0)];
        let r = compute_backtest(&input(suggestion, actual));
        assert!(r.insufficient_data);
        assert_eq!(r.matchup_delta, 0.0);
        assert!(r.caveats.iter().any(|c| c.contains("数据不足")));
    }

    #[test]
    fn one_side_below_matchup_minimum_is_insufficient() {
        let suggestion: Vec<_> = (0..6).map(|i| sample(1, i < 3, 10.0)).collect();
        let actual = vec![sample(2, true, 10.0), sample(2, false, 8.0)];
        let r = compute_backtest(&input(suggestion, actual));
        assert!(r.insufficient_data);
    }

    #[test]
    fn empty_samples_never_panic() {
        let r = compute_backtest(&input(vec![], vec![]));
        assert!(r.insufficient_data);
        assert!(r.matchup_delta.is_finite());
        assert!(r.confidence.is_finite());
    }

    #[test]
    fn zero_win_rates_still_produce_finite_delta() {
        let suggestion: Vec<_> = (0..6).map(|i| sample(1, false, 5.0)).collect();
        let actual: Vec<_> = (0..6).map(|i| sample(2, false, 5.0)).collect();
        let r = compute_backtest(&input(suggestion, actual));
        assert!(!r.insufficient_data);
        assert_eq!(r.win_rate_gap, 0.0);
        assert!(r.matchup_delta.is_finite());
    }
}