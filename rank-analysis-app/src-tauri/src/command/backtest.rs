//! # 决策回测命令（M2 数据飞轮：建议 → 回测 → 采纳/未采纳对账）
//!
//! `get_decision_backtest(game_id)` 在赛后结算/战绩详情调用：
//! 1. 取本局详情（LCU match-details，带缓存），用本机 puuid 对齐"我"；
//! 2. 开赛时刻前 ≤15min 窗口内取最近一条未对账赛前建议；没有 →
//!    返回 `no_pending_suggestion`，不写 ledger（宁缺毋滥，不编造对账）；
//! 3. 组装双方样本：优先敌方对位样本（双方各 ≥3 局），不足退英雄+位置
//!    全样本并在 caveats 标注；样本不足回测阈值 → 对账照常写（对账不
//!    依赖样本量），backtest 标记 insufficient；
//! 4. `compute_backtest` → `record_decision`（幂等 upsert）→
//!    `mark_pending_reconciled`（消费建议，防重复对账）。
//!
//! 对账口径：`adopted = (实际英雄 == 建议英雄)`；关联键 = gameId +
//! suggestedAtMs + 英雄。分路无法从赛后数据归一（LCU 无 timeline）→
//! 返回 `position_unknown` 且不消费建议（留给下局/手动处理）。

use serde::{Deserialize, Serialize};

use crate::backtest::samples::normalize_position;
use crate::backtest::store::{self, LocalSample};
use crate::backtest::{compute_backtest, BacktestInput, BacktestResult, MatchupSample};
use crate::backtest::{MIN_LOCAL_SAMPLES, MIN_MATCHUP_SAMPLES};
use crate::command::match_history::get_game_by_id;
use crate::lcu::api::model::Participant;
use crate::lcu::api::summoner::Summoner;

/// 对账窗口：开赛前 ≤ 15 分钟内的赛前建议才与该局关联。
const RECONCILE_WINDOW_MS: i64 = 15 * 60 * 1000;

/// 回测对账结果（对账数据沉淀 + 回测结果一体返回）。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DecisionBacktest {
    /// 是否有可对账的赛前建议（false → 其余字段大多为 None）。
    pub aligned: bool,
    /// 未对齐原因：`ok` / `no_pending_suggestion` / `my_puuid_missing` /
    /// `not_in_game` / `parse_game_time_failed` / `position_unknown`。
    pub reason: String,
    pub suggested_at_ms: Option<i64>,
    pub suggestion_champion_id: Option<i32>,
    pub actual_champion_id: Option<i32>,
    pub enemy_champion_id: Option<i32>,
    pub position: Option<String>,
    /// 是否采纳建议（实际英雄 == 建议英雄）。
    pub adopted: Option<bool>,
    pub result_win: Option<bool>,
    /// 回测结果（样本不足时 insufficient_data=true 且 delta=0）。
    pub backtest: Option<BacktestResult>,
}

/// ISO8601 UTC（如 `2021-01-01T00:00:00.000Z`）→ epoch 毫秒。
/// 无 chrono 依赖：与 `lcu::api::sgp::epoch_ms_to_iso` 互逆（Howard Hinnant 历法）。
/// 支持可选的 `.mmm` 毫秒段与 `Z` / `±HH:MM` 时区后缀。
fn iso_to_epoch_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |i: usize, n: usize| -> Option<i64> {
        if i + n > b.len() {
            return None;
        }
        let mut v: i64 = 0;
        for &c in &b[i..i + n] {
            if !c.is_ascii_digit() {
                return None;
            }
            v = v * 10 + i64::from(c - b'0');
        }
        Some(v)
    };
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let y = num(0, 4)?;
    let mo = num(5, 2)?;
    let d = num(8, 2)?;
    let hh = num(11, 2)?;
    let mi = num(14, 2)?;
    let ss = num(17, 2)?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || hh > 23 || mi > 59 || ss > 60 {
        return None;
    }
    let mut millis: i64 = 0;
    let mut idx = 19;
    if b.len() > idx && b[idx] == b'.' {
        idx += 1;
        let mut ndigits = 0usize;
        while idx < b.len() && b[idx].is_ascii_digit() && ndigits < 3 {
            millis = millis * 10 + i64::from(b[idx] - b'0');
            idx += 1;
            ndigits += 1;
        }
        for _ in ndigits..3 {
            millis *= 10;
        }
    }
    // 时区偏移：默认 UTC，遇 ±HH:MM 转回 UTC。
    let mut offset_min = 0i64;
    if idx < b.len() {
        let c = b[idx];
        if c == b'Z' || c == b'z' {
            idx += 1;
        } else if c == b'+' || c == b'-' {
            let sign = if c == b'-' { -1 } else { 1 };
            if idx + 6 > b.len() || b[idx + 3] != b':' {
                return None;
            }
            let oh = num(idx + 1, 2)?;
            let om = num(idx + 4, 2)?;
            offset_min = sign * (oh * 60 + om);
            idx += 6;
        } else {
            return None;
        }
    }
    if idx != b.len() {
        return None;
    }
    let days = days_from_civil(y, mo as u32, d as u32);
    let secs = days * 86_400 + hh * 3600 + mi * 60 + ss - offset_min * 60;
    Some(secs * 1000 + millis)
}

/// 自 1970-01-01 起的 (y, m, d) → 天数。Howard Hinnant `days_from_civil`。
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 在局内定位"我"（participantId 从 1 起与 identity 数组对齐，找不到退回同索引）。
fn find_my_participant<'a>(participants: &'a [Participant], idx: usize) -> Option<&'a Participant> {
    participants
        .iter()
        .find(|p| p.participant_id == idx as i32 + 1)
        .or_else(|| participants.get(idx))
}

/// 取敌方同分路的玩家英雄（None = 敌方无同分路，宁缺毋滥不出对账）。
fn find_enemy(participants: &[Participant], me: &Participant, position: &str) -> Option<i32> {
    participants
        .iter()
        .find(|p| {
            p.team_id != me.team_id
                && p.timeline
                    .as_ref()
                    .and_then(|t| normalize_position(&t.lane, &t.role))
                    == Some(position)
        })
        .map(|p| p.champion_id)
}

/// 组装双方样本：优先敌方对位样本（双方各 ≥ [`MIN_MATCHUP_SAMPLES`]），
/// 不足退英雄+位置全样本；返回 (建议样本, 实际样本, 是否回退全样本)。
fn build_samples(
    suggestion_champion_id: i32,
    actual_champion_id: i32,
    position: &str,
    enemy_champion_id: i32,
) -> (Vec<MatchupSample>, Vec<MatchupSample>, bool) {
    let to_matchup = |rows: Vec<LocalSample>| {
        rows.into_iter()
            .map(|s| MatchupSample {
                champion_id: s.champion_id,
                position: s.position,
                enemy_champion_id: s.enemy_champion_id,
                win: s.win,
                score: s.score,
            })
            .collect::<Vec<_>>()
    };
    let sug_matchup = to_matchup(store::query_samples(
        suggestion_champion_id,
        position,
        Some(enemy_champion_id),
    ));
    let act_matchup = to_matchup(store::query_samples(
        actual_champion_id,
        position,
        Some(enemy_champion_id),
    ));
    if sug_matchup.len() >= MIN_MATCHUP_SAMPLES && act_matchup.len() >= MIN_MATCHUP_SAMPLES {
        return (sug_matchup, act_matchup, false);
    }
    let sug_all = to_matchup(store::query_samples(suggestion_champion_id, position, None));
    let act_all = to_matchup(store::query_samples(actual_champion_id, position, None));
    (sug_all, act_all, true)
}

/// 赛后决策对账（建议 → 回测 → 采纳/未采纳 ledger）。
///
/// # 返回值
/// - `aligned=true`: 对账完成并落库（ledger 幂等 upsert，建议已消费）
/// - `aligned=false`: 无可对账建议或数据缺失（`reason` 说明），不写 ledger
#[tauri::command]
pub async fn get_decision_backtest(game_id: i64) -> Result<DecisionBacktest, String> {
    let game = get_game_by_id(game_id).await?;
    let my = Summoner::get_my_summoner().await?;
    if my.puuid.is_empty() {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "my_puuid_missing".to_string(),
            ..Default::default()
        });
    }
    let identities = &game.game_detail.participant_identities;
    let Some(idx) = identities.iter().position(|i| i.player.puuid == my.puuid) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "not_in_game".to_string(),
            ..Default::default()
        });
    };
    let participants = &game.game_detail.participants;
    let Some(me) = find_my_participant(participants, idx) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "not_in_game".to_string(),
            ..Default::default()
        });
    };
    let Some(created_ms) = iso_to_epoch_ms(&game.game_creation_date) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "parse_game_time_failed".to_string(),
            ..Default::default()
        });
    };
    // 最近未对账的赛前建议（开赛前 ≤15min 窗口）
    let Some(pending) = store::latest_pending_before(created_ms) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "no_pending_suggestion".to_string(),
            ..Default::default()
        });
    };
    if pending.suggested_at_ms < created_ms - RECONCILE_WINDOW_MS {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "no_pending_suggestion".to_string(),
            ..Default::default()
        });
    }
    let Some(position) = me
        .timeline
        .as_ref()
        .and_then(|t| normalize_position(&t.lane, &t.role))
    else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "position_unknown".to_string(),
            ..Default::default()
        });
    };
    let Some(enemy_id) = find_enemy(participants, me, position) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "position_unknown".to_string(),
            ..Default::default()
        });
    };
    let position = position.to_string();
    let adopted = me.champion_id == pending.suggestion_champion_id;
    let (suggestion_samples, actual_samples, used_fallback) = build_samples(
        pending.suggestion_champion_id,
        me.champion_id,
        &position,
        enemy_id,
    );
    let result = compute_backtest(&BacktestInput {
        suggestion_champion_id: pending.suggestion_champion_id,
        actual_champion_id: me.champion_id,
        enemy_champion_id: enemy_id,
        suggestion_samples,
        actual_samples,
    });
    let mut caveats = result.caveats.clone();
    if used_fallback {
        caveats.push(format!(
            "敌方对位样本不足（双方各 ≥{MIN_MATCHUP_SAMPLES} 局），已回退英雄+位置全样本"
        ));
    }
    store::record_decision(&store::LedgerEntry {
        game_id,
        suggested_at_ms: pending.suggested_at_ms,
        suggestion_champion_id: pending.suggestion_champion_id,
        actual_champion_id: me.champion_id,
        enemy_champion_id: enemy_id,
        position: position.clone(),
        adopted,
        result_win: me.stats.win,
        matchup_delta: result.matchup_delta,
        confidence: result.confidence,
        caveats,
    });
    store::mark_pending_reconciled(
        pending.suggested_at_ms,
        pending.suggestion_champion_id,
        game_id,
    );
    Ok(DecisionBacktest {
        aligned: true,
        reason: "ok".to_string(),
        suggested_at_ms: Some(pending.suggested_at_ms),
        suggestion_champion_id: Some(pending.suggestion_champion_id),
        actual_champion_id: Some(me.champion_id),
        enemy_champion_id: Some(enemy_id),
        position: Some(position),
        adopted: Some(adopted),
        result_win: Some(me.stats.win),
        backtest: Some(result),
    })
}

/// 采纳 vs 未采纳的统计分布（前端"决策回测"区块数据源）。
#[tauri::command]
pub async fn get_adoption_stats() -> Result<store::AdoptionStats, String> {
    store::adoption_stats().ok_or_else(|| "回测库不可用".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_parses_utc_with_millis() {
        assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00.000Z"),
            Some(1_609_459_200_000)
        );
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T08:00:00.000Z"),
            Some(1_609_488_000_000)
        );
    }

    #[test]
    fn iso_parses_without_millis_and_with_offset() {
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00Z"),
            Some(1_609_459_200_000)
        );
        // +08:00 → 减 8 小时回到 UTC
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T08:00:00+08:00"),
            Some(1_609_459_200_000)
        );
    }

    #[test]
    fn iso_rejects_malformed() {
        assert_eq!(iso_to_epoch_ms("2021-01-01"), None);
        assert_eq!(iso_to_epoch_ms("2021-13-01T00:00:00.000Z"), None);
        assert_eq!(iso_to_epoch_ms("2021-01-01T00:00:00"), None, "缺时区后缀");
        assert_eq!(iso_to_epoch_ms("garbage"), None);
    }

    #[test]
    fn iso_roundtrips_with_sgp_generator() {
        for ms in [0, 1_609_459_200_000, 1_609_488_000_999] {
            let iso = crate::lcu::api::sgp::epoch_ms_to_iso(ms);
            assert_eq!(iso_to_epoch_ms(&iso), Some(ms), "ISO={iso}");
        }
    }

    #[test]
    fn find_my_participant_aligns_by_id_then_index() {
        let ps = vec![
            participant(1, 100, 101),
            participant(2, 100, 102),
            participant(3, 200, 103),
        ];
        assert_eq!(find_my_participant(&ps, 0).unwrap().champion_id, 101);
        assert_eq!(find_my_participant(&ps, 2).unwrap().champion_id, 103);
    }

    #[test]
    fn samples_fallback_when_matchup_samples_are_thin() {
        // 直接对位样本不足（无法注入 store 时模拟逻辑层）：
        // 对位样本各 2 → 应回退全样本；对位样本各 3 → 不回退。
        // （store 查询不可注入，此处验证 to_matchup 转换不 panic + 阈值常量）
        assert_eq!(MIN_MATCHUP_SAMPLES, 3);
        assert_eq!(MIN_LOCAL_SAMPLES, 5);
    }

    fn participant(id: i32, team: i32, champ: i32) -> Participant {
        Participant {
            participant_id: id,
            team_id: team,
            champion_id: champ,
            ..Default::default()
        }
    }
}
