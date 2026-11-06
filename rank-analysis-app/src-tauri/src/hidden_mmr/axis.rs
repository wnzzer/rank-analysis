//! # 段位 ↔ 分数轴
//!
//! 把段位线性展开成一条整数轴，LP 加减分和隐藏分偏移都在这条轴上计算，
//! 晋级 / 掉段跨小段时差值依然正确。

use crate::constant::game::get_tier_en_to_cn;

/// 大师以下的大段，从低到高；下标 × [`TIER_SPAN`] 即该大段 IV 0LP 的分数。
const TIERS: [&str; 7] = [
    "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND",
];

/// 不分小段的顶尖段位，统一按 [`APEX_BASE`] + LP 计。
const APEX_TIERS: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];

/// 小段从低到高；下标 × [`DIVISION_SPAN`] 为小段内起点。
const DIVISIONS: [&str; 4] = ["IV", "III", "II", "I"];

/// 一个大段 = 4 个小段 × 100 LP。
const TIER_SPAN: i32 = 400;

/// 一个小段 = 100 LP（LP 达到 100 即晋级）。
const DIVISION_SPAN: i32 = 100;

/// 大师 0LP 在轴上的位置：7 个大段 × 400 = 2800。
pub const APEX_BASE: i32 = 2800;

/// 把段位换算成轴上的分数。
///
/// # 参数
/// - `tier`: LCU 段位英文名（大小写不敏感），如 `"DIAMOND"`
/// - `division`: 小段 `"IV"`..`"I"`；大师以上忽略
/// - `lp`: 当前 LP；大师以下钳到 0..=99，大师以上只钳下限 0
///
/// # 返回值
/// 未定级 / 未知段位 / 非法小段时返回 `None`。
pub fn to_score(tier: &str, division: &str, lp: i32) -> Option<i32> {
    let tier = tier.to_ascii_uppercase();
    if APEX_TIERS.contains(&tier.as_str()) {
        return Some(APEX_BASE + lp.max(0));
    }
    let tier_index = TIERS.iter().position(|t| *t == tier)? as i32;
    let division_index = DIVISIONS.iter().position(|d| *d == division)? as i32;
    Some(tier_index * TIER_SPAN + division_index * DIVISION_SPAN + lp.clamp(0, DIVISION_SPAN - 1))
}

/// 把轴上的分数换回中文等效段位文案。
///
/// # 参数
/// - `score`: 轴上的分数，负数按 0 处理
///
/// # 返回值
/// 如 `"璀璨钻石 II 40LP"`；≥ [`APEX_BASE`] 统一为 `"大师以上 {lp}LP"`，
/// 不去猜宗师 / 王者门槛（它们随大区人数浮动）。
pub fn format_score(score: i32) -> String {
    let score = score.max(0);
    if score >= APEX_BASE {
        return format!("大师以上 {}LP", score - APEX_BASE);
    }
    let tier = TIERS[(score / TIER_SPAN) as usize];
    let division = DIVISIONS[((score % TIER_SPAN) / DIVISION_SPAN) as usize];
    let lp = score % DIVISION_SPAN;
    let tier_cn = get_tier_en_to_cn(tier).unwrap_or(tier);
    format!("{} {} {}LP", tier_cn, division, lp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_map_lowest_rank_to_zero() {
        assert_eq!(to_score("IRON", "IV", 0), Some(0));
    }

    #[test]
    fn should_map_tier_and_division_linearly() {
        assert_eq!(to_score("DIAMOND", "II", 40), Some(2640));
        assert_eq!(to_score("EMERALD", "III", 5), Some(2105));
        assert_eq!(to_score("diamond", "IV", 40), Some(2440));
    }

    #[test]
    fn should_put_apex_tiers_on_shared_base() {
        assert_eq!(to_score("MASTER", "I", 233), Some(3033));
        assert_eq!(to_score("GRANDMASTER", "", 500), Some(3300));
        assert_eq!(to_score("CHALLENGER", "NA", 1234), Some(4034));
    }

    #[test]
    fn should_return_none_for_unranked_or_unknown() {
        assert_eq!(to_score("UNRANKED", "", 0), None);
        assert_eq!(to_score("", "", 0), None);
        assert_eq!(to_score("GOLD", "V", 10), None);
    }

    #[test]
    fn should_clamp_lp_inside_division() {
        assert_eq!(to_score("GOLD", "IV", 100), Some(1299));
        assert_eq!(to_score("GOLD", "IV", -5), Some(1200));
    }

    #[test]
    fn should_format_score_back_to_rank() {
        assert_eq!(format_score(2640), "璀璨钻石 II 40LP");
        assert_eq!(format_score(0), "坚韧黑铁 IV 0LP");
        assert_eq!(format_score(2799), "璀璨钻石 I 99LP");
        assert_eq!(format_score(2580), "璀璨钻石 III 80LP");
    }

    #[test]
    fn should_format_apex_without_guessing_tier() {
        assert_eq!(format_score(2800), "大师以上 0LP");
        assert_eq!(format_score(3033), "大师以上 233LP");
    }

    #[test]
    fn should_clamp_negative_score_to_lowest_rank() {
        assert_eq!(format_score(-30), "坚韧黑铁 IV 0LP");
    }

    #[test]
    fn should_roundtrip_every_division_start() {
        for tier in [
            "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND",
        ] {
            for division in ["IV", "III", "II", "I"] {
                let score = to_score(tier, division, 37).unwrap();
                let tier_cn = get_tier_en_to_cn(tier).unwrap();
                assert_eq!(format_score(score), format!("{tier_cn} {division} 37LP"));
            }
        }
    }
}
