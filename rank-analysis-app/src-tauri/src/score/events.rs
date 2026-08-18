//! # L3 事件级归因引擎（score/events）
//!
//! 把 9 维 L2 维度分回溯到**具体事件**（时间轴级证据），供 UI 三级下钻
//! 与 AI 复盘 prompt 引用。数据源是 SGP DETAILS timeline（`SgpGameDetail`，
//! LCU `get_game_by_id` 不返回 frames，已确认）。
//!
//! **纪律**（与 `command/score.rs` 一致）：
//! - 本模块是纯确定性计算，无 LLM、无随机、无 IO；输入即输出。
//! - 归因规则是**启发式**：事件只做"定位"（哪一时段哪一维度表现差），
//!   `delta` 是固定权重的扣分估计，**不是精确分数**；正确性由
//!   `score/golden.rs` 的 golden test 评测集兜底（ADR-7）。
//! - 数据不足宁缺毋滥：帧缺失 / 事件缺失的维度**不产出证据**，绝不编造。
//!
//! 时间单位约定：`ScoreEvent.timestamp_secs` 为**对局内秒**（与前端
//! `formatGameClock(secs)` 一致）；SGP 原始事件时间为毫秒，入口处统一换算。

use std::collections::{HashMap, HashSet};

use crate::lcu::api::sgp::{SgpFrame, SgpFrameEvent, SgpGameDetail};

/// 维度枚举：与 `command::score::PlayerScoreBreakdown` 字段一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScoreDimension {
    Kda,
    Win,
    Damage,
    DamageTaken,
    Heal,
    Cs,
    Gold,
    Participation,
    Vision,
}

/// 一条事件级归因证据。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreEvent {
    pub dimension: ScoreDimension,
    /// 对局内秒（0 起）；帧级证据取该时段的起始秒。
    pub timestamp_secs: i64,
    /// 人类可读的中文描述（UI 时间轴与 AI prompt 共用）。
    pub description: String,
    /// 该证据对维分的扣分估计（启发式固定权重，非精确分数）。
    pub delta: f64,
}

/// 单场对局单名玩家的三级下钻结果（L1 总分 + L2 维度分 + L3 事件证据）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdownDrilldown {
    pub participant_id: i32,
    pub champion_id: i32,
    pub total: f64,
    pub breakdown: crate::command::score::PlayerScoreBreakdown,
    pub events: Vec<ScoreEvent>,
    /// false = timeline 不可用，事件列表为空且不应展示为"低分原因"。
    pub timeline_available: bool,
}

/// 单次团战聚类（45s 窗口、≥3 死亡即一团，与前端 `teamfightClusters` 同语义）。
struct TeamfightCluster<'a> {
    /// 窗口内最后一死的秒（用于时间轴定位）。
    start_secs: i64,
    end_secs: i64,
    /// 窗口内全部死亡事件（含双方）。
    deaths: Vec<&'a SgpFrameEvent>,
}

/// 单局事件证据上限（防长局刷屏）。
const MAX_EVENTS: usize = 12;

/// 团战判定窗口（秒）。
const TEAMFIGHT_WINDOW_SECS: i64 = 45;
/// 团战最少死亡数（窗口内 ChampionKill 计数）。
const TEAMFIGHT_MIN_DEATHS: usize = 3;

/// 视野：相邻插眼间隔超过该秒数 → "连续未插眼"证据。
const VISION_GAP_SECS: i64 = 300;

/// 帧级停滞判定：本人增量 < 队均增量 × 该系数，且持续 ≥ 该帧数。
const STALL_RATIO: f64 = 0.5;
const STALL_MIN_FRAMES: usize = 2;

// 各事件类型的启发式扣分权重（delta 语义：扣分估计，非精确）。
const DELTA_PARTICIPATION_MISS: f64 = 0.5;
const DELTA_DEATH: f64 = 0.1;
const DELTA_CS_STALL: f64 = 0.1;
const DELTA_VISION_GAP: f64 = 0.15;
const DELTA_GOLD_STALL: f64 = 0.1;
const DELTA_DAMAGE_DIP: f64 = 0.1;

/// 毫秒 → 对局内秒。
fn ms_to_secs(ms: i64) -> i64 {
    ms / 1000
}

/// 秒 → `mm:ss`。
fn fmt_mmss(secs: i64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

/// 帧事件是否为击杀（死亡）事件。
fn is_champion_kill(e: &SgpFrameEvent) -> bool {
    e.r#type.as_deref() == Some("CHAMPION_KILL")
}

/// 事件参与者是否包含某玩家（击杀者/受害者/助攻任一）。
fn event_involves(e: &SgpFrameEvent, pid: i32) -> bool {
    e.participant_id == Some(pid)
        || e.killer_id == Some(pid)
        || e.victim_id == Some(pid)
        || e.assisting_participant_ids
            .as_ref()
            .is_some_and(|ids| ids.contains(&pid))
}

/// 把帧事件流聚合成团战（45s 窗口贪婪聚类，≥3 死才算团）。
fn cluster_teamfights(frames: &[SgpFrame]) -> Vec<TeamfightCluster<'_>> {
    let mut deaths: Vec<(i64, &SgpFrameEvent)> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e))
        .filter_map(|e| e.timestamp.map(|ms| (ms_to_secs(ms), e)))
        .collect();
    deaths.sort_by_key(|(t, _)| *t);

    let mut clusters: Vec<TeamfightCluster<'_>> = Vec::new();
    for (t, e) in deaths {
        let need_new = clusters
            .last()
            .is_none_or(|c: &TeamfightCluster<'_>| t - c.end_secs > TEAMFIGHT_WINDOW_SECS);
        if need_new {
            clusters.push(TeamfightCluster {
                start_secs: t,
                end_secs: t,
                deaths: Vec::new(),
            });
        }
        if let Some(last) = clusters.last_mut() {
            last.end_secs = t;
            last.deaths.push(e);
        }
    }
    clusters.retain(|c| c.deaths.len() >= TEAMFIGHT_MIN_DEATHS);
    clusters
}

/// 视野维：连续未插眼（本人 WARD_PLACED 间隔超阈值）。
fn vision_gap_events(frames: &[SgpFrame], pid: i32) -> Vec<ScoreEvent> {
    let mut placed: Vec<i64> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| e.r#type.as_deref() == Some("WARD_PLACED") && e.participant_id == Some(pid))
        .filter_map(|e| e.timestamp.map(ms_to_secs))
        .collect();
    placed.sort_unstable();

    let mut out = Vec::new();
    for w in placed.windows(2) {
        let gap = w[1] - w[0];
        if gap > VISION_GAP_SECS {
            out.push(ScoreEvent {
                dimension: ScoreDimension::Vision,
                timestamp_secs: w[0],
                description: format!(
                    "{}–{} 连续 {} 分钟未插眼",
                    fmt_mmss(w[0]),
                    fmt_mmss(w[1]),
                    gap / 60
                ),
                delta: DELTA_VISION_GAP,
            });
        }
    }
    out
}

/// 事件是否涉及集合中任一玩家（击杀者/受害者/助攻/事件主体任一命中）。
fn event_involves_any(e: &SgpFrameEvent, pids: &HashSet<i32>) -> bool {
    e.killer_id.is_some_and(|k| pids.contains(&k))
        || e.victim_id.is_some_and(|v| pids.contains(&v))
        || e.participant_id.is_some_and(|p| pids.contains(&p))
        || e.assisting_participant_ids
            .as_ref()
            .is_some_and(|ids| ids.iter().any(|a| pids.contains(a)))
}

/// 参团维：本队有参与的团战（窗口内我方有人击杀/被击杀/助攻）而本人完全未参与。
fn teamfight_miss_events(
    clusters: &[TeamfightCluster<'_>],
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    let mut out = Vec::new();
    for c in clusters {
        let my_team_involved = c.deaths.iter().any(|e| event_involves_any(e, team_pids));
        if !my_team_involved {
            continue;
        }
        let participated = c.deaths.iter().any(|e| event_involves(e, pid));
        if !participated {
            out.push(ScoreEvent {
                dimension: ScoreDimension::Participation,
                timestamp_secs: c.start_secs,
                description: format!(
                    "{} 团战（{}s 内 {} 人死亡）本队有参战，但未参与",
                    fmt_mmss(c.start_secs),
                    c.end_secs - c.start_secs,
                    c.deaths.len()
                ),
                delta: DELTA_PARTICIPATION_MISS,
            });
        }
    }
    out
}

/// KDA 维：本人全部阵亡事件。
fn death_events(frames: &[SgpFrame], pid: i32) -> Vec<ScoreEvent> {
    let mut deaths: Vec<i64> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e) && e.victim_id == Some(pid))
        .filter_map(|e| e.timestamp.map(ms_to_secs))
        .collect();
    deaths.sort_unstable();

    deaths
        .iter()
        .enumerate()
        .map(|(i, t)| ScoreEvent {
            dimension: ScoreDimension::Kda,
            timestamp_secs: *t,
            description: format!("{} 阵亡（本局第 {} 次）", fmt_mmss(*t), i + 1),
            delta: DELTA_DEATH,
        })
        .collect()
}

/// 帧级增量序列（相邻帧差值；负增量/缺帧视为脏数据跳过）。
fn frame_increments(
    detail: &SgpGameDetail,
    pid: i32,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
) -> Vec<(i64, i64, i32)> {
    let mut frames: Vec<&SgpFrame> = detail.frames.iter().filter(|f| f.timestamp.is_some()).collect();
    frames.sort_by_key(|f| f.timestamp.unwrap());

    let mut out = Vec::new();
    let mut prev: Option<(i64, i32)> = None;
    for f in frames {
        let Some(stats) = f.participant_frames.get(&pid) else { continue };
        let cur = field(stats);
        if let Some((prev_t, prev_v)) = prev {
            let inc = cur - prev_v;
            if inc >= 0 {
                out.push((prev_t, ms_to_secs(f.timestamp.unwrap()), inc));
            }
        }
        prev = Some((ms_to_secs(f.timestamp.unwrap()), cur));
    }
    out
}

/// 帧级"队均增量"：同队成员各自帧增量的均值（按帧对齐）。
fn team_avg_increment(
    detail: &SgpGameDetail,
    team_pids: &HashSet<i32>,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
) -> HashMap<i64, f64> {
    let mut acc: HashMap<i64, (f64, usize)> = HashMap::new();
    for pid in team_pids {
        for (t, _, inc) in frame_increments(detail, *pid, &field) {
            let e = acc.entry(t).or_insert((0.0, 0));
            e.0 += inc as f64;
            e.1 += 1;
        }
    }
    acc.into_iter()
        .filter(|(_, (_, n))| *n > 0)
        .map(|(t, (sum, n))| (t, sum / n as f64))
        .collect()
}

/// 帧级停滞：本人增量长期低于队均（补刀/经济）。
fn frame_stall_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
    dimension: ScoreDimension,
    label: &str,
    delta: f64,
) -> Vec<ScoreEvent> {
    let mine = frame_increments(detail, pid, &field);
    let team = team_avg_increment(detail, team_pids, &field);
    if mine.is_empty() || team.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut run: Option<(i64, i64)> = None;
    for (t, t_end, inc) in mine {
        let avg = team.get(&t).copied().unwrap_or(0.0);
        if avg > 0.0 && inc as f64 < avg * STALL_RATIO {
            run = Some(match run {
                Some((start, _)) => (start, t_end),
                None => (t, t_end),
            });
        } else if let Some((start, end)) = run.take() {
            if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
                out.push(ScoreEvent {
                    dimension,
                    timestamp_secs: start,
                    description: format!(
                        "{}–{} {label}低于队均 {}%",
                        fmt_mmss(start),
                        fmt_mmss(end),
                        (100.0 - STALL_RATIO * 100.0) as i64
                    ),
                    delta,
                });
            }
        }
    }
    if let Some((start, end)) = run.take() {
        if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
            out.push(ScoreEvent {
                dimension,
                timestamp_secs: start,
                description: format!(
                    "{}–{} {label}低于队均 {}%",
                    fmt_mmss(start),
                    fmt_mmss(end),
                    (100.0 - STALL_RATIO * 100.0) as i64
                ),
                delta,
            });
        }
    }
    out
}

/// 伤害维：输出低谷（帧伤害增量低于队均，持续多帧；需 SGP 独有 damage_stats）。
fn damage_dip_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    let dmg_of = |s: &crate::lcu::api::sgp::SgpFrameParticipantStats| -> i32 {
        s.damage_stats
            .as_ref()
            .and_then(|d| d.total_damage_done_to_champions)
            .map(|v| v as i32)
            .unwrap_or(0)
    };
    let mine = frame_increments(detail, pid, dmg_of);
    if mine.is_empty() {
        return Vec::new();
    }
    let team = team_avg_increment(detail, team_pids, dmg_of);
    let mut out = Vec::new();
    let mut run: Option<(i64, i64)> = None;
    for (t, t_end, inc) in mine {
        let avg = team.get(&t).copied().unwrap_or(0.0);
        if avg > 0.0 && inc as f64 < avg * STALL_RATIO {
            run = Some(match run {
                Some((start, _)) => (start, t_end),
                None => (t, t_end),
            });
        } else if let Some((start, end)) = run.take() {
            if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
                out.push(ScoreEvent {
                    dimension: ScoreDimension::Damage,
                    timestamp_secs: start,
                    description: format!(
                        "{}–{} 输出低谷（低于队均 {}%）",
                        fmt_mmss(start),
                        fmt_mmss(end),
                        (100.0 - STALL_RATIO * 100.0) as i64
                    ),
                    delta: DELTA_DAMAGE_DIP,
                });
            }
        }
    }
    out
}

/// 对单名玩家的帧事件流做全维归因（时间升序，截断 [`MAX_EVENTS`]）。
///
/// `team_pids`：本队 5 人 participantId 集合（用于队均基准与"本队参与团战"判定；
/// 帧数据本身不带 team 信息，必须由调用方从 LCU 详情提供）。
pub fn compute_score_events(
    detail: &SgpGameDetail,
    participant_id: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    if detail.frames.is_empty() || team_pids.is_empty() {
        return Vec::new();
    }
    let clusters = cluster_teamfights(&detail.frames);
    let mut events = Vec::new();
    events.extend(vision_gap_events(&detail.frames, participant_id));
    events.extend(teamfight_miss_events(&clusters, participant_id, team_pids));
    events.extend(death_events(&detail.frames, participant_id));
    events.extend(frame_stall_events(
        detail,
        participant_id,
        team_pids,
        |s| s.minions_killed,
        ScoreDimension::Cs,
        "补刀",
        DELTA_CS_STALL,
    ));
    events.extend(frame_stall_events(
        detail,
        participant_id,
        team_pids,
        |s| s.total_gold,
        ScoreDimension::Gold,
        "经济增速",
        DELTA_GOLD_STALL,
    ));
    events.extend(damage_dip_events(detail, participant_id, team_pids));

    events.sort_by_key(|e| e.timestamp_secs);
    events.truncate(MAX_EVENTS);
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::sgp::SgpFrameParticipantStats;

    fn ev(r#type: &str, ms: i64, pid: Option<i32>, killer: Option<i32>, victim: Option<i32>) -> SgpFrameEvent {
        SgpFrameEvent {
            r#type: Some(r#type.to_string()),
            timestamp: Some(ms),
            participant_id: pid,
            killer_id: killer,
            victim_id: victim,
            ..Default::default()
        }
    }

    fn frame(ms: i64, stats: HashMap<i32, SgpFrameParticipantStats>, events: Vec<SgpFrameEvent>) -> SgpFrame {
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

    fn detail(frames: Vec<SgpFrame>) -> SgpGameDetail {
        SgpGameDetail {
            frames,
            ..Default::default()
        }
    }

    const ME: i32 = 1;
    const MATE_A: i32 = 2;
    const MATE_B: i32 = 3;

    fn my_team() -> HashSet<i32> {
        HashSet::from([ME, MATE_A, MATE_B])
    }

    #[test]
    fn empty_frames_yield_no_events() {
        let d = detail(vec![]);
        assert!(compute_score_events(&d, ME, &my_team()).is_empty());
    }

    #[test]
    fn death_events_are_recorded_with_order() {
        let d = detail(vec![
            frame(0, HashMap::new(), vec![]),
            frame(
                1_200_000,
                HashMap::new(),
                vec![ev("CHAMPION_KILL", 1_200_000, Some(9), Some(9), Some(ME))],
            ),
            frame(
                2_400_000,
                HashMap::new(),
                vec![ev("CHAMPION_KILL", 2_400_000, Some(9), Some(9), Some(ME))],
            ),
        ]);
        let events = compute_score_events(&d, ME, &my_team());
        let deaths: Vec<_> = events
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Kda)
            .collect();
        assert_eq!(deaths.len(), 2);
        assert_eq!(deaths[0].timestamp_secs, 1200);
        assert!(deaths[0].description.contains("第 1 次"));
        assert_eq!(deaths[1].timestamp_secs, 2400);
    }

    #[test]
    fn teamfight_without_me_is_participation_miss() {
        // 4 次击杀集中在 30s 内：我方击杀 2 次（MATE_A 与 MATE_B），我方无死亡
        let events = vec![
            ev("CHAMPION_KILL", 600_000, Some(MATE_A), Some(MATE_A), Some(50)),
            ev("CHAMPION_KILL", 615_000, Some(MATE_B), Some(MATE_B), Some(51)),
            ev("CHAMPION_KILL", 630_000, Some(52), Some(52), Some(MATE_B)),
            ev("CHAMPION_KILL", 645_000, Some(53), Some(53), Some(MATE_A)),
        ];
        let d = detail(vec![frame(700_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        let miss: Vec<_> = evs
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Participation)
            .collect();
        assert_eq!(miss.len(), 1, "本队参战而我缺席 → 1 条未参团证据");
        assert_eq!(miss[0].delta, DELTA_PARTICIPATION_MISS);
    }

    #[test]
    fn teamfight_where_i_die_counts_as_participation() {
        let events = vec![
            ev("CHAMPION_KILL", 600_000, Some(50), Some(50), Some(ME)),
            ev("CHAMPION_KILL", 615_000, Some(MATE_A), Some(MATE_A), Some(51)),
            ev("CHAMPION_KILL", 630_000, Some(52), Some(52), Some(MATE_B)),
        ];
        let d = detail(vec![frame(700_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(
            !evs.iter().any(|e| e.dimension == ScoreDimension::Participation),
            "我阵亡也算参团，不应产出未参团证据"
        );
    }

    #[test]
    fn cs_stall_detected_over_two_frames() {
        // 队均每帧 +100 刀（MATE_A/B 各 100）；我 2 帧只 +10 → 停滞证据
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
        let d = detail(vec![
            mk(60_000, 0, 0),
            mk(120_000, 10, 100),
            mk(180_000, 20, 200),
        ]);
        let evs = compute_score_events(&d, ME, &my_team());
        let stalls: Vec<_> = evs.iter().filter(|e| e.dimension == ScoreDimension::Cs).collect();
        assert_eq!(stalls.len(), 1);
        assert!(stalls[0].description.contains("补刀"));
    }

    #[test]
    fn stall_requires_two_consecutive_frames() {
        // 只有一帧低于队均 → 不产出（防止单帧抖动误报）
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
        let d = detail(vec![
            mk(60_000, 0, 0),
            mk(120_000, 10, 50),
            mk(180_000, 60, 100),
        ]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Cs));
    }

    #[test]
    fn vision_gap_over_five_minutes() {
        let events = vec![
            ev("WARD_PLACED", 300_000, Some(ME), None, None),
            ev("WARD_PLACED", 700_000, Some(ME), None, None),
        ];
        let d = detail(vec![frame(800_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        let gaps: Vec<_> = evs.iter().filter(|e| e.dimension == ScoreDimension::Vision).collect();
        assert_eq!(gaps.len(), 1);
        assert!(gaps[0].description.contains("6 分钟"));
    }

    #[test]
    fn missing_participant_frames_are_skipped_not_fabricated() {
        // 帧 participant_frames 里没有我 → 帧级维度不产出（而非当 0 处理）
        let mk = |t: i64, mate_cs: i32| {
            frame(
                t,
                HashMap::from([
                    (MATE_A, stats(mate_cs, 1000, None)),
                    (MATE_B, stats(mate_cs, 1000, None)),
                ]),
                vec![],
            )
        };
        let d = detail(vec![mk(60_000, 0), mk(120_000, 50)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Cs));
    }

    #[test]
    fn damage_dip_requires_sgp_damage_stats() {
        // damage_stats 缺失（LCU 源）→ 伤害维不产出
        let mk = |t: i64, mine: i32| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(mine, 1000, None)),
                    (MATE_A, stats(mine + 100, 1000, Some(0.0))),
                    (MATE_B, stats(mine + 100, 1000, Some(0.0))),
                ]),
                vec![],
            )
        };
        let d = detail(vec![mk(60_000, 0), mk(120_000, 5), mk(180_000, 10)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Damage));
    }

    #[test]
    fn events_are_sorted_ascending_and_capped() {
        let d = detail(vec![frame(
            0,
            HashMap::new(),
            vec![
                ev("CHAMPION_KILL", 900_000, Some(9), Some(9), Some(ME)),
                ev("CHAMPION_KILL", 300_000, Some(9), Some(9), Some(ME)),
                ev("CHAMPION_KILL", 600_000, Some(9), Some(9), Some(ME)),
            ],
        )]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(evs.windows(2).all(|w| w[0].timestamp_secs <= w[1].timestamp_secs));
        assert!(evs.len() <= MAX_EVENTS);
    }

    #[test]
    fn fmt_mmss_pads_zeroes() {
        assert_eq!(fmt_mmss(5), "00:05");
        assert_eq!(fmt_mmss(600), "10:00");
        assert_eq!(fmt_mmss(3600), "60:00");
    }
}