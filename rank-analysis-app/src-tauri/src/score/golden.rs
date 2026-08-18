//! # L3 归因评测集（golden test，ADR-7）
//!
//! 归因规则是启发式——正确性必须可度量。"LLM 不编造"的前提是归因正确，
//! 因此把人工标注的评测集与命中率评测函数固化在这里：
//!
//! - **标注集格式**：[`GoldenCase`]（一局 / 一名玩家 / 该维度的真值证据）。
//!   合成样例内嵌在本模块测试中；真实对局标注（≥20 局，维护者本机历史局）
//!   按同一结构追加到 `tests`（双周重跑，见路线图 §5.6）。
//! - **评测**：[`evaluate`] 对每条真值证据找"维度一致 + 时间窗内 + 描述含
//!   关键字"的事件，输出 recall / precision / 失败明细。
//! - **门槛**：recall ≥ 0.8 才允许把 L3 事件链注入 AI prompt（§5.5.6 依赖此门槛）。

use std::collections::HashSet;

use crate::lcu::api::sgp::SgpGameDetail;
use crate::score::events::{compute_score_events, ScoreDimension};

/// 一条人工标注的真值证据：应识别出的"某维度、某时间窗、某种描述"的事件。
pub struct ExpectedEvidence {
    pub dimension: ScoreDimension,
    /// 允许的时间窗（对局内秒，闭区间）。
    pub window_secs: (i64, i64),
    /// 描述必须包含的关键字（任一命中即可，防措辞微调导致误判）。
    pub keywords: &'static [&'static str],
}

/// 一个评测用例：一局数据 + 目标玩家 + 真值证据集。
pub struct GoldenCase<'a> {
    pub name: &'a str,
    pub detail: SgpGameDetail,
    pub participant_id: i32,
    pub team_pids: HashSet<i32>,
    pub expected: Vec<ExpectedEvidence>,
}

/// 评测报告：recall（真值命中率）与 precision（产出中有效占比）。
pub struct GoldenReport {
    pub case_count: usize,
    pub expected_count: usize,
    pub matched_count: usize,
    /// 产出的事件总数（precision 分母；无产出时记 1 防除零）。
    pub produced_count: usize,
    pub recall: f64,
    pub precision: f64,
    /// 未命中的真值证据（按用例名分组描述）。
    pub failed: Vec<String>,
}

/// 对全部用例跑归因并对比真值。
pub fn evaluate(cases: &[GoldenCase<'_>]) -> GoldenReport {
    let mut matched = 0usize;
    let mut produced = 0usize;
    let mut failed = Vec::new();
    let mut expected_count = 0usize;

    for case in cases {
        expected_count += case.expected.len();
        let events = compute_score_events(&case.detail, case.participant_id, &case.team_pids);
        produced += events.len();

        for (i, exp) in case.expected.iter().enumerate() {
            let hit = events.iter().any(|e| {
                e.dimension == exp.dimension
                    && e.timestamp_secs >= exp.window_secs.0
                    && e.timestamp_secs <= exp.window_secs.1
                    && exp.keywords.iter().any(|k| e.description.contains(k))
            });
            if hit {
                matched += 1;
            } else {
                failed.push(format!(
                    "[{}] 真值 #{}（{:?} @ {}s）未命中",
                    case.name,
                    i + 1,
                    exp.dimension,
                    exp.window_secs.0
                ));
            }
        }
    }

    let recall = if expected_count > 0 {
        matched as f64 / expected_count as f64
    } else {
        1.0
    };
    let precision = if produced > 0 {
        matched as f64 / produced as f64
    } else {
        1.0
    };
    GoldenReport {
        case_count: cases.len(),
        expected_count,
        matched_count: matched,
        produced_count: produced,
        recall,
        precision,
        failed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::sgp::{SgpFrame, SgpFrameEvent, SgpFrameParticipantStats};
    use std::collections::HashMap;

    fn ev(
        r#type: &str,
        ms: i64,
        pid: Option<i32>,
        killer: Option<i32>,
        victim: Option<i32>,
    ) -> SgpFrameEvent {
        SgpFrameEvent {
            r#type: Some(r#type.to_string()),
            timestamp: Some(ms),
            participant_id: pid,
            killer_id: killer,
            victim_id: victim,
            ..Default::default()
        }
    }

    fn frame(
        ms: i64,
        stats: HashMap<i32, SgpFrameParticipantStats>,
        events: Vec<SgpFrameEvent>,
    ) -> SgpFrame {
        SgpFrame {
            timestamp: Some(ms),
            participant_frames: stats,
            events,
        }
    }

    fn stats(cs: i32, gold: i32, dmg: Option<f64>) -> SgpFrameParticipantStats {
        SgpFrameParticipantStats {
            minions_killed: cs,
            total_gold: gold,
            damage_stats: dmg.map(|v| crate::lcu::api::sgp::SgpFrameDamageStats {
                total_damage_done_to_champions: Some(v),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    const ME: i32 = 1;
    const MATE_A: i32 = 2;
    const MATE_B: i32 = 3;

    fn my_team() -> HashSet<i32> {
        HashSet::from([ME, MATE_A, MATE_B])
    }

    fn detail(frames: Vec<SgpFrame>) -> SgpGameDetail {
        SgpGameDetail {
            frames,
            ..Default::default()
        }
    }

    /// 真值：死亡 ×2（10:00 与 15:00 前后）。
    fn case_deaths() -> GoldenCase<'static> {
        GoldenCase {
            name: "death-2x",
            detail: detail(vec![
                frame(0, HashMap::new(), vec![]),
                frame(
                    1_000_000,
                    HashMap::new(),
                    vec![ev("CHAMPION_KILL", 950_000, Some(9), Some(9), Some(ME))],
                ),
                frame(
                    1_600_000,
                    HashMap::new(),
                    vec![ev("CHAMPION_KILL", 1_500_000, Some(9), Some(9), Some(ME))],
                ),
            ]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![
                ExpectedEvidence {
                    dimension: ScoreDimension::Kda,
                    window_secs: (940, 970),
                    keywords: &["阵亡"],
                },
                ExpectedEvidence {
                    dimension: ScoreDimension::Kda,
                    window_secs: (1490, 1520),
                    keywords: &["阵亡", "第 2 次"],
                },
            ],
        }
    }

    /// 真值：10:00 团战缺席（本队击杀 2、对面击杀 2，我全程未参与）。
    fn case_teamfight_miss() -> GoldenCase<'static> {
        GoldenCase {
            name: "teamfight-miss",
            detail: detail(vec![frame(
                700_000,
                HashMap::new(),
                vec![
                    ev("CHAMPION_KILL", 600_000, Some(MATE_A), Some(MATE_A), Some(50)),
                    ev("CHAMPION_KILL", 615_000, Some(MATE_B), Some(MATE_B), Some(51)),
                    ev("CHAMPION_KILL", 630_000, Some(52), Some(52), Some(MATE_B)),
                    ev("CHAMPION_KILL", 645_000, Some(53), Some(53), Some(MATE_A)),
                ],
            )]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![ExpectedEvidence {
                dimension: ScoreDimension::Participation,
                window_secs: (590, 650),
                keywords: &["团战", "未参与"],
            }],
        }
    }

    /// 真值：补刀停滞 3 帧（队均每帧 +100，我每帧 +10）。
    fn case_cs_stall() -> GoldenCase<'static> {
        let mk = |t: i64, mine_cs: i32, mate_cs: i32| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(mine_cs, 1000, None)),
                    (MATE_A, stats(mate_cs, 1000, None)),
                    (MATE_B, stats(mate_cs, 1000, None)),
                ]),
                vec![],
            )
        };
        GoldenCase {
            name: "cs-stall",
            detail: detail(vec![
                mk(60_000, 0, 0),
                mk(120_000, 10, 100),
                mk(180_000, 20, 200),
            ]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![ExpectedEvidence {
                dimension: ScoreDimension::Cs,
                window_secs: (55, 190),
                keywords: &["补刀"],
            }],
        }
    }

    /// 真值：5:00–11:40 连续 6 分多钟未插眼。
    fn case_vision_gap() -> GoldenCase<'static> {
        GoldenCase {
            name: "vision-gap",
            detail: detail(vec![frame(
                800_000,
                HashMap::new(),
                vec![
                    ev("WARD_PLACED", 300_000, Some(ME), None, None),
                    ev("WARD_PLACED", 700_000, Some(ME), None, None),
                ],
            )]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![ExpectedEvidence {
                dimension: ScoreDimension::Vision,
                window_secs: (290, 310),
                keywords: &["未插眼"],
            }],
        }
    }

    /// 真值：伤害低谷（damage_stats 在场，队均每帧 +100 伤害而我 +5）。
    fn case_damage_dip() -> GoldenCase<'static> {
        let mk = |t: i64, mine_dmg: f64, mate_dmg: f64| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(0, 1000, Some(mine_dmg))),
                    (MATE_A, stats(0, 1000, Some(mate_dmg))),
                    (MATE_B, stats(0, 1000, Some(mate_dmg))),
                ]),
                vec![],
            )
        };
        GoldenCase {
            name: "damage-dip",
            detail: detail(vec![
                mk(60_000, 0.0, 100.0),
                mk(120_000, 5.0, 200.0),
                mk(180_000, 10.0, 300.0),
            ]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![ExpectedEvidence {
                dimension: ScoreDimension::Damage,
                window_secs: (55, 190),
                keywords: &["输出低谷"],
            }],
        }
    }

    /// 负例：数据不足（无帧）→ 必须零产出。
    fn case_empty() -> GoldenCase<'static> {
        GoldenCase {
            name: "empty-no-fabrication",
            detail: detail(vec![]),
            participant_id: ME,
            team_pids: my_team(),
            expected: vec![],
        }
    }

    #[test]
    fn golden_cases_all_hit() {
        let cases = vec![
            case_deaths(),
            case_teamfight_miss(),
            case_cs_stall(),
            case_vision_gap(),
            case_damage_dip(),
            case_empty(),
        ];
        let report = evaluate(&cases);
        assert!(
            report.failed.is_empty(),
            "归因评测失败明细：\n{}",
            report.failed.join("\n")
        );
        assert_eq!(report.matched_count, report.expected_count, "recall 应为 1.0");
        assert!(report.recall >= 0.8, "recall {:.2} 低于门槛 0.8", report.recall);
        // 负例不产出 + 其余用例事件应有有效证据 → precision 高
        assert!(
            report.precision >= 0.5,
            "precision {:.2} 异常低（误报过多）",
            report.precision
        );
    }
}