//! # A3 触发→识别→打分→推送 管线编排
//!
//! 职责：把 capture（带活跃度）→ OCR 文本 → 词表匹配 → 打分 四段串成一次
//! `assist_tick`。OCR 引擎尚未接入时，tick 返回 `pushed:false` 与明确原因——
//! 前端调度器据此只报告不推送；引擎落地后仅需替换 [`recognize_bands`] 的实现。
//!
//! 检测阈值常量在此定义（Rust 侧权威）；前端 trigger.ts 的同名常量仅用于
//! UI 展示，两者需保持一致。

use serde::Serialize;
use serde_json::Value;

/// 标题带亮度标准差阈值（0-255）。与前端 BAND_ACTIVE_THRESHOLD 保持一致。
pub const BAND_ACTIVE_THRESHOLD: f64 = 18.0;
/// 判定「三选一出现」所需的活跃标题带数。与前端 ACTIVE_SLOTS_REQUIRED 一致。
pub const ACTIVE_SLOTS_REQUIRED: usize = 2;

/// 一次 assist tick 的结果（前端据此决定是否推送面板）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickOutcome {
    pub phase: String,
    pub pushed: bool,
    /// 未推送时的机器可读原因
    pub reason: Option<&'static str>,
    /// 活跃标题带数
    pub active_slots: usize,
    /// 推送成功时的三选一面板负载（契约见 features/overlay/panels.ts）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

/// 由标题带统计做检测判定（纯函数）。
pub fn detect_from_stats(stats: &[super::capture::BandStat]) -> bool {
    stats
        .iter()
        .filter(|s| s.stddev >= BAND_ACTIVE_THRESHOLD)
        .count()
        >= ACTIVE_SLOTS_REQUIRED
}

/// 对三个卡位的文本跑「词表匹配 → 打分」并组装面板负载。
///
/// OCR 引擎产出文本候选后调这里；手动调试可直接喂样例文本。
pub fn run_augment_round(
    texts: [Option<String>; 3],
    champion_id: i64,
    rerolls_left: Option<u8>,
) -> Result<Value, String> {
    let augments = super::store::read_local_json("augments.json")?;
    let lexicon = super::ocr::build_lexicon(&augments);
    let metas = super::score::CandidateMeta::map_from_augments(&augments);
    let tables = super::score::load_tables(champion_id)?;

    let hits = super::ocr::match_slots(&texts, &lexicon, 2);
    Ok(super::score::score_round(
        [hits[0].as_ref(), hits[1].as_ref(), hits[2].as_ref()],
        &metas,
        &tables,
        rerolls_left,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mayhem::capture::{BandStat, Rect};

    fn band(slot: u8, stddev: f64) -> BandStat {
        BandStat { slot, rect: Rect { x: 0, y: 0, w: 10, h: 10 }, stddev }
    }

    #[test]
    fn detection_should_require_two_active_bands() {
        assert!(!detect_from_stats(&[band(0, 30.0), band(1, 5.0), band(2, 4.0)]));
        assert!(detect_from_stats(&[
            band(0, BAND_ACTIVE_THRESHOLD),
            band(1, 99.0),
            band(2, 0.0)
        ]));
        // 阈值边界：恰好等于阈值算活跃
        assert!(detect_from_stats(&[band(0, BAND_ACTIVE_THRESHOLD), band(1, BAND_ACTIVE_THRESHOLD)]));
        assert!(!detect_from_stats(&[]));
    }
}
