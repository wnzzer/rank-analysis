//! # 打野抓人节奏（Gank Pattern）命令
//!
//! 「敌方打野 80% 前 10 分钟抓下」这类行为模式分析：SGP 路径为主——拉被查玩家
//! 近 20 局摘要，筛出打野局，逐局取 SGP DETAILS（已带缓存）的帧事件，收集该玩家
//! **前 10 分钟参与击杀**的事件（击杀者或助攻含目标玩家）。victim 英雄分路归类、
//! 占比与文案在前端聚合（英雄→分路表在前端 `getChampionMeta`）。
//!
//! 为何没有 LCU 兜底：LCU 只能查本机账号的战绩，而本功能的分析对象是**敌方打野**
//! （LCU 无其数据）；本机账号不可能出现在敌方。故敌方打野场景 SGP 是唯一可行源，
//! LCU 兜底为空转，不实现。

use crate::lcu::api::match_history::Game;
use crate::lcu::api::sgp;
use serde::Serialize;
use std::collections::HashMap;

/// 前 10 分钟（毫秒）。
const EARLY_GAME_WINDOW_MS: i64 = 600_000;

/// 打野局样本下限：不足则数据不可信，整体返回 `None`（前端静默不展示）。
const JUNGLE_MIN_GAMES: usize = 3;

/// 单条「该玩家参与的前 10 分钟击杀」事件。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GankKillEventRaw {
    /// 距对局开始的时间（毫秒）。
    pub timestamp_ms: i64,
    /// 被击杀英雄的 ID（victim 位置由前端按 OP.GG meta 归类）。
    pub victim_champion_id: i64,
}

/// 打野节奏原始统计（aggregation 在前端）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GankPatternRaw {
    /// 参与分析的摘要局数（DETAILS 拉取失败的不计）。
    pub analyzed_games: i32,
    /// 其中目标玩家为打野的局数。
    pub jungle_games: i32,
    /// 最早一次参与击杀的时间（毫秒）；无击杀则为 `None`。
    pub first_kill_ms: Option<i64>,
    /// 该玩家参与的前 10 分钟击杀（victim 英雄）。
    pub kill_events: Vec<GankKillEventRaw>,
}

/// 该局目标玩家是否为打野（`participants[0]` 恒为被查玩家）。
pub fn is_jungle_game(game: &Game) -> bool {
    game.participants
        .first()
        .and_then(|p| p.timeline.as_ref())
        .map(|t| t.lane.trim().eq_ignore_ascii_case("JUNGLE"))
        .unwrap_or(false)
}

/// 从一局 DETAILS 的帧事件里提取「目标玩家前 10 分钟参与击杀」。
///
/// # 参数
/// - `events`: 全部帧事件（拍平）
/// - `target_id`: 目标玩家的 participantId（`None` 表示未找到，直接无击杀）
/// - `champ_of`: participantId → championId（来自摘要 `game_detail`，victim 归类用）
///
/// 击杀判定：`type == "CHAMPION_KILL"` 且（击杀者 == 目标 或 助攻含目标），
/// 且 `timestamp <= EARLY_GAME_WINDOW_MS`。一血/多杀等特殊击杀类型不含
/// killer/victim 对，不参与（避免重复计数）。
pub fn extract_early_kills(
    events: &[sgp::SgpFrameEvent],
    target_id: Option<i32>,
    champ_of: &HashMap<i32, i64>,
) -> Vec<GankKillEventRaw> {
    let Some(pid) = target_id else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ev in events {
        if ev.r#type.as_deref() != Some("CHAMPION_KILL") {
            continue;
        }
        let Some(ts) = ev.timestamp else { continue };
        if ts > EARLY_GAME_WINDOW_MS {
            continue;
        }
        let involved = ev.killer_id == Some(pid)
            || ev
                .assisting_participant_ids
                .as_ref()
                .is_some_and(|a| a.contains(&pid));
        if !involved {
            continue;
        }
        out.push(GankKillEventRaw {
            timestamp_ms: ts,
            victim_champion_id: ev
                .victim_id
                .and_then(|v| champ_of.get(&v).copied())
                .unwrap_or(0),
        });
    }
    out
}

/// SGP 路径主流程：近 20 局摘要 → 打野局 → 逐局 DETAILS 帧事件。
///
/// 降级约定：单局 DETAILS 拉取失败跳过（不计 analyzed_games），不整体失败；
/// 打野局 < [`JUNGLE_MIN_GAMES`] 或无法解析玩家身份时返回 `Ok(None)`。
pub async fn collect_gank_pattern(
    mh: &crate::lcu::api::match_history::MatchHistory,
    region: &str,
) -> Result<Option<GankPatternRaw>, String> {
    let games = &mh.games.games;
    if games.is_empty() {
        return Ok(None);
    }
    let target_puuid = games[0]
        .participant_identities
        .first()
        .map(|i| i.player.puuid.clone())
        .filter(|s| !s.is_empty());
    let Some(puuid) = target_puuid else {
        return Ok(None);
    };

    let mut pattern = GankPatternRaw::default();
    let mut jungle_games = 0usize;
    let mut first_kill_ms: Option<i64> = None;

    for game in games.iter().take(20) {
        if !is_jungle_game(game) {
            continue;
        }
        // 摘要 game_detail 全 10 人带 championId：participantId → championId
        let champ_of: HashMap<i32, i64> = game
            .game_detail
            .participants
            .iter()
            .map(|p| (p.participant_id, p.champion_id as i64))
            .collect();
        let detail = match sgp::fetch_match_detail(region, game.game_id).await {
            Ok(d) => d,
            Err(e) => {
                log::warn!("gank_pattern: 拉取局 {} DETAILS 失败: {}", game.game_id, e);
                continue;
            }
        };
        pattern.analyzed_games += 1;
        jungle_games += 1;

        // 目标 participantId：DETAILS participants 只含 { participantId, puuid }
        let target_id = detail
            .json
            .as_ref()
            .and_then(|j| {
                j.participants
                    .iter()
                    .find(|p| p.puuid.as_deref() == Some(&puuid))
            })
            .and_then(|p| p.participant_id);

        let events: Vec<sgp::SgpFrameEvent> = detail
            .json
            .iter()
            .flat_map(|j| j.frames.iter())
            .flat_map(|f| f.events.iter())
            .cloned()
            .collect();
        for ev in extract_early_kills(&events, target_id, &champ_of) {
            match first_kill_ms {
                Some(f) if f <= ev.timestamp_ms => {}
                _ => first_kill_ms = Some(ev.timestamp_ms),
            }
            pattern.kill_events.push(ev);
        }
    }

    if jungle_games < JUNGLE_MIN_GAMES {
        return Ok(None);
    }
    pattern.jungle_games = jungle_games as i32;
    pattern.first_kill_ms = first_kill_ms;
    Ok(Some(pattern))
}

/// SGP 路径入口 1：按 `名字#TAG` 跨区解析玩家后分析。
pub async fn fetch_jungle_gank_pattern_sgp(
    region: &str,
    name: &str,
) -> Result<Option<GankPatternRaw>, String> {
    crate::observability::track_feature("jungle_gank_pattern_sgp");
    let mh = sgp::get_match_history_by_name(region, name, 0, 20).await?;
    collect_gank_pattern(&mh, region).await
}

/// SGP 路径入口 2：按 puuid 直接分析（选人期敌方玩家只有 puuid，无 name#TAG）。
pub async fn fetch_jungle_gank_pattern_sgp_by_puuid(
    region: &str,
    puuid: &str,
) -> Result<Option<GankPatternRaw>, String> {
    crate::observability::track_feature("jungle_gank_pattern_sgp");
    let raw = sgp::fetch_match_history_summary(region, puuid, 0, 20).await?;
    let mh = sgp::map_sgp_to_match_history(&raw, region, puuid);
    collect_gank_pattern(&mh, region).await
}

/// 打野抓人节奏：敌方打野行为模式分析（SGP 路径，见模块注释）。
///
/// # 参数
/// - `region`: 目标大区 platformId（如 `HN10` / `NA1`）
/// - `puuid`: 目标玩家 puuid（选人期 LCU session 直接提供）；为空则用 `name`
/// - `name`: 完整 Riot ID `名字#TAG`（puuid 缺失时的兜底入口）
///
/// # 返回
/// `Ok(None)` = 数据不足（无战绩/打野局 < 3/身份解析失败），前端静默不展示。
#[tauri::command]
pub async fn get_jungle_gank_pattern(
    region: String,
    puuid: Option<String>,
    name: Option<String>,
) -> Result<Option<GankPatternRaw>, String> {
    match (
        puuid.filter(|p| !p.is_empty()),
        name.filter(|n| !n.is_empty()),
    ) {
        (Some(p), _) => fetch_jungle_gank_pattern_sgp_by_puuid(&region, &p).await,
        (None, Some(n)) => fetch_jungle_gank_pattern_sgp(&region, &n).await,
        (None, None) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::model::{Participant, ParticipantIdentity, ParticipantTimeline, Player};

    fn participant_identity(puuid: &str) -> ParticipantIdentity {
        ParticipantIdentity {
            player: Player {
                puuid: puuid.to_string(),
                ..Default::default()
            },
        }
    }

    fn participant(lane: &str) -> Participant {
        Participant {
            timeline: Some(ParticipantTimeline {
                lane: lane.to_string(),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn is_jungle_game_only_true_for_jungle_lane() {
        let jungle = Game {
            participants: vec![participant("JUNGLE")],
            ..Default::default()
        };
        assert!(is_jungle_game(&jungle));

        let mid = Game {
            participants: vec![participant("MIDDLE")],
            ..Default::default()
        };
        assert!(!is_jungle_game(&mid));

        // 摘要 participants 缺失/无 timeline：非打野（不误判）
        assert!(!is_jungle_game(&Game::default()));

        let no_tl = Game {
            participants: vec![Participant {
                timeline: None,
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(!is_jungle_game(&no_tl));
    }

    #[test]
    fn target_puuid_comes_from_identities_first() {
        let game = Game {
            participant_identities: vec![participant_identity("target-puuid")],
            ..Default::default()
        };
        // 走 fetch 主流程的身份解析路径（这里只验证身份字段映射可用）
        let puuid = game
            .participant_identities
            .first()
            .map(|i| i.player.puuid.clone())
            .filter(|s| !s.is_empty());
        assert_eq!(puuid.as_deref(), Some("target-puuid"));
    }

    #[test]
    fn extract_keeps_only_target_early_kills() {
        let mk =
            |t: i64, kind: &str, killer: i32, victim: i32, assists: Vec<i32>| sgp::SgpFrameEvent {
                r#type: Some(kind.to_string()),
                timestamp: Some(t),
                killer_id: Some(killer),
                victim_id: Some(victim),
                assisting_participant_ids: Some(assists),
                ..Default::default()
            };
        let champ_of: HashMap<i32, i64> = [(2, 202), (5, 51)].into_iter().collect();

        let events = vec![
            mk(300_000, "CHAMPION_KILL", 1, 2, vec![]), // 击杀者=目标 pid1，victim 202
            mk(250_000, "CHAMPION_KILL", 3, 2, vec![1]), // 助攻含目标，victim 202
            mk(90_000, "CHAMPION_KILL", 3, 5, vec![4]), // 与目标无关
            mk(700_000, "CHAMPION_KILL", 1, 5, vec![]), // 超过 10 分钟窗口
            mk(400_000, "FIRST_BLOOD", 1, 2, vec![]),   // 非 CHAMPION_KILL（特殊击杀）
            sgp::SgpFrameEvent {
                r#type: Some("CHAMPION_KILL".to_string()),
                timestamp: Some(500_000),
                ..Default::default()
            }, // 无 killer/victim 字段
        ];

        let kills = extract_early_kills(&events, Some(1), &champ_of);
        assert_eq!(kills.len(), 2);
        assert_eq!(kills[0].timestamp_ms, 300_000);
        assert_eq!(kills[0].victim_champion_id, 202);
        assert_eq!(kills[1].timestamp_ms, 250_000);
        assert_eq!(kills[1].victim_champion_id, 202);
    }

    #[test]
    fn extract_target_not_found_returns_empty() {
        let champ_of: HashMap<i32, i64> = HashMap::new();
        assert!(extract_early_kills(&[], None, &champ_of).is_empty());
        let events = [sgp::SgpFrameEvent {
            r#type: Some("CHAMPION_KILL".to_string()),
            timestamp: Some(100_000),
            killer_id: Some(9),
            ..Default::default()
        }];
        assert!(extract_early_kills(&events, Some(1), &champ_of).is_empty());
    }

    #[test]
    fn unknown_victim_falls_back_to_zero() {
        let champ_of: HashMap<i32, i64> = HashMap::new();
        let events = [sgp::SgpFrameEvent {
            r#type: Some("CHAMPION_KILL".to_string()),
            timestamp: Some(100_000),
            killer_id: Some(1),
            victim_id: Some(7),
            assisting_participant_ids: Some(vec![]),
            ..Default::default()
        }];
        let kills = extract_early_kills(&events, Some(1), &champ_of);
        assert_eq!(kills.len(), 1);
        assert_eq!(kills[0].victim_champion_id, 0);
    }
}
