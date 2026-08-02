//! # BP 智能推荐命令模块
//!
//! 从近期战绩 + OP.GG 快照算出三类兜底池候选：
//! - frequent：常用英雄 → pick 池
//! - nemesis：败局中敌方高频英雄（常输给谁）→ ban 池
//! - hot_t0：版本 T0/T1，按熟练度分流 pick/ban
//!
//! 纯统计无 AI；聚合全部是纯函数，方便单测。
//! 主玩分路不用国服不可信的 lane 字段，改用常用英雄的 OP.GG 主分路加权众数。

use crate::config::{get_config, Value};
use crate::lcu::api::match_history::{Game, MatchHistory};
use crate::lcu::api::summoner::Summoner;
use crate::opgg::data::OpggSnapshot;
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

/// 参与统计的最大场次（LCU 可靠窗口 50 场内取近 30）。
const SAMPLE_GAMES: i32 = 30;
/// 样本下限：不足时返回空结果让前端显示「打几局再来」。
const MIN_SAMPLE_GAMES: usize = 10;
/// 常用英雄入选门槛（场次）。
const FREQUENT_MIN_GAMES: i32 = 3;
/// 常输英雄入选门槛（败局出现次数）。
const NEMESIS_MIN_ENCOUNTERS: i32 = 2;
/// 各分区候选上限。
const SECTION_CAP: usize = 8;
/// 「会玩」判据：≥3 场且胜率 ≥50%。
const PROFICIENT_MIN_GAMES: i32 = 3;
const PROFICIENT_MIN_WIN_RATE: f64 = 0.5;
/// 主玩分路投票的最低场次（≥2 场才算「玩过」）。
const POSITION_VOTE_MIN_GAMES: i32 = 2;
/// 排位队列（单双/灵活）。
const RANKED_QUEUES: [i32; 2] = [420, 440];

/// `get_bp_suggest` 的聚合结果：主玩分路 + 三类候选分区。
#[derive(Serialize, Debug, Clone)]
pub struct BpSuggestResult {
    /// 推断（或显式指定）的主玩分路："TOP"|"JUNGLE"|"MIDDLE"|"BOTTOM"|"UTILITY"|""（""=无法判定）
    pub main_position: String,
    /// 参与统计的样本场次。
    pub sample_games: i32,
    /// OP.GG 快照是否可用；false 时 `hot_t0` 恒空。
    pub opgg_ok: bool,
    /// 常用英雄 → pick 池候选。
    pub frequent: Vec<BpSuggestItem>,
    /// 常输给的敌方英雄 → ban 池候选。
    pub nemesis: Vec<BpSuggestItem>,
    /// 版本 T0/T1 英雄，按熟练度分流 pick/ban。
    pub hot_t0: Vec<BpSuggestItem>,
}

/// 单个候选英雄条目。
#[derive(Serialize, Debug, Clone)]
pub struct BpSuggestItem {
    /// 英雄 ID。
    pub champion_id: i32,
    /// 建议去向池："pick" | "ban"。
    pub suggested_pool: String,
    /// 是否已在对应的兜底池中。
    pub already_in_pool: bool,
    /// 支撑本条建议的统计证据。
    pub evidence: BpSuggestEvidence,
}

/// 候选条目的统计证据；全 Option，缺失字段序列化时省略。
#[derive(Serialize, Debug, Clone, Default)]
pub struct BpSuggestEvidence {
    /// 我玩该英雄的场次。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub games: Option<i32>,
    /// 我玩该英雄的胜率（0~1）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub win_rate: Option<f64>,
    /// 败局中出现次数（nemesis 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub losses_against: Option<i32>,
    /// 败局总数（nemesis 专用，作为 `losses_against` 的分母参考）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_games: Option<i32>,
    /// OP.GG T 级（hot_t0 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opgg_tier: Option<i32>,
    /// OP.GG 胜率（hot_t0 专用，0~1）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opgg_win_rate: Option<f64>,
    /// OP.GG 分路（hot_t0 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
}

/// 我的按英雄聚合：champion_id → (场次, 胜场)。
fn aggregate_my_champions(games: &[Game]) -> HashMap<i32, (i32, i32)> {
    let mut map: HashMap<i32, (i32, i32)> = HashMap::new();
    for g in games {
        let Some(me) = g.participants.first() else {
            continue;
        };
        let e = map.entry(me.champion_id).or_insert((0, 0));
        e.0 += 1;
        if me.stats.win {
            e.1 += 1;
        }
    }
    map
}

/// 败局敌方英雄出现次数：champion_id → 次数；同时返回败局总数。
///
/// 敌我判定对齐 user_tag::get_one_game_players：以 participants[0]（本人）的
/// team_id 为基准，game_detail 里 team_id 不同者为敌方。
fn aggregate_nemesis(games: &[Game]) -> (HashMap<i32, i32>, i32) {
    let mut map: HashMap<i32, i32> = HashMap::new();
    let mut loss_games = 0;
    for g in games {
        let Some(me) = g.participants.first() else {
            continue;
        };
        if me.stats.win {
            continue;
        }
        loss_games += 1;
        for p in &g.game_detail.participants {
            if p.team_id != me.team_id && p.champion_id > 0 {
                *map.entry(p.champion_id).or_insert(0) += 1;
            }
        }
    }
    (map, loss_games)
}

/// 主玩分路：常用英雄（≥POSITION_VOTE_MIN_GAMES 场）的 OP.GG 主分路按场次加权投票。
///
/// 不用国服战绩里不可信的 lane 字段；OP.GG 缺数据或无票时返回 ""。
fn derive_main_position(
    my_champs: &HashMap<i32, (i32, i32)>,
    snapshot: Option<&OpggSnapshot>,
) -> String {
    let Some(snap) = snapshot else {
        return String::new();
    };
    let mut votes: HashMap<&str, i32> = HashMap::new();
    for (champ_id, (games, _wins)) in my_champs {
        if *games < POSITION_VOTE_MIN_GAMES {
            continue;
        }
        let Some(metas) = snap.champions.get(champ_id) else {
            continue;
        };
        if let Some(main) = metas.iter().find(|m| m.is_main_position) {
            if !main.position.is_empty() {
                *votes.entry(main.position.as_str()).or_insert(0) += games;
            }
        }
    }
    votes
        .into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(p, _)| p.to_string())
        .unwrap_or_default()
}

/// 「会玩」判据：打过 ≥3 场且胜率 ≥50%。
fn is_proficient(agg: Option<&(i32, i32)>) -> bool {
    match agg {
        Some((games, wins)) => {
            *games >= PROFICIENT_MIN_GAMES
                && (*wins as f64 / *games as f64) >= PROFICIENT_MIN_WIN_RATE
        }
        None => false,
    }
}

/// 三类候选总装（纯函数，网络/配置读取都在命令层）。
///
/// # 参数
/// - `games`: 参与统计的样本（已按排位优先筛过）
/// - `my_puuid`: 本人 puuid（当前聚合按 participants[0] 即本人，保留参数备用敌我校验）
/// - `snapshot`: OP.GG 快照，None 时 hot_t0 为空、主分路为 ""
/// - `position`: 显式指定分路（None 用推断的主分路）
/// - `pick_pool` / `ban_pool`: 现有兜底池，用于标记 already_in_pool
fn build_suggestions(
    games: &[Game],
    _my_puuid: &str,
    snapshot: Option<&OpggSnapshot>,
    position: Option<&str>,
    pick_pool: &[i32],
    ban_pool: &[i32],
) -> BpSuggestResult {
    let my_champs = aggregate_my_champions(games);
    let main_position = derive_main_position(&my_champs, snapshot);
    let effective_pos = position.unwrap_or(&main_position);

    // 常用英雄资格集合（games >= FREQUENT_MIN_GAMES）：frequent 排序基底、
    // nemesis 排除、hot_t0 ban 排除三处共用同一判据，算一次到处复用。
    let my_frequent_ids: std::collections::HashSet<i32> = my_champs
        .iter()
        .filter(|(_, (games, _))| *games >= FREQUENT_MIN_GAMES)
        .map(|(id, _)| *id)
        .collect();

    // frequent：常用英雄，按 (games, wins) 降序 → pick 池候选
    let mut frequent_ids: Vec<i32> = my_frequent_ids.iter().copied().collect();
    frequent_ids.sort_by(|a, b| {
        let (ga, wa) = my_champs[a];
        let (gb, wb) = my_champs[b];
        (gb, wb).cmp(&(ga, wa))
    });
    frequent_ids.truncate(SECTION_CAP);
    let frequent: Vec<BpSuggestItem> = frequent_ids
        .iter()
        .map(|id| {
            let (games, wins) = my_champs[id];
            BpSuggestItem {
                champion_id: *id,
                suggested_pool: "pick".to_string(),
                already_in_pool: pick_pool.contains(id),
                evidence: BpSuggestEvidence {
                    games: Some(games),
                    win_rate: Some(wins as f64 / games as f64),
                    ..Default::default()
                },
            }
        })
        .collect();

    // nemesis：败局中敌方高频英雄，排除我自己的常用英雄 → ban 池候选
    let (nemesis_map, loss_games) = aggregate_nemesis(games);
    let mut nemesis_ids: Vec<i32> = nemesis_map
        .iter()
        .filter(|(id, count)| **count >= NEMESIS_MIN_ENCOUNTERS && !my_frequent_ids.contains(id))
        .map(|(id, _)| *id)
        .collect();
    nemesis_ids.sort_by(|a, b| nemesis_map[b].cmp(&nemesis_map[a]));
    nemesis_ids.truncate(SECTION_CAP);
    let nemesis: Vec<BpSuggestItem> = nemesis_ids
        .iter()
        .map(|id| {
            let count = nemesis_map[id];
            BpSuggestItem {
                champion_id: *id,
                suggested_pool: "ban".to_string(),
                already_in_pool: ban_pool.contains(id),
                evidence: BpSuggestEvidence {
                    losses_against: Some(count),
                    loss_games: Some(loss_games),
                    ..Default::default()
                },
            }
        })
        .collect();

    // hot_t0：版本 T0/T1（OP.GG tier==1），按我的熟练度分流 pick/ban
    let opgg_ok = snapshot.is_some();
    let mut hot_t0: Vec<BpSuggestItem> = vec![];
    if let Some(snap) = snapshot {
        let nemesis_set: std::collections::HashSet<i32> = nemesis_ids.iter().copied().collect();

        // pick 向：T0 + 主分路匹配 effective_pos + 我会玩。
        //
        // ⚠️ 不对 frequent 做 ID 级排除：PROFICIENT_MIN_GAMES 与 FREQUENT_MIN_GAMES
        // 都是 3 场，"会玩"(is_proficient) 在场次门槛上是 frequent 判据的严格子集
        // （proficient 还多一道胜率 ≥50% 的要求）。若排除与 frequent 重叠的英雄，
        // hot_t0.pick 将对任何输入恒为空——版本强势且我常玩的英雄理应双重命中，
        // 这也是 Step 1 测试 `hot_t0_should_split_by_proficiency_and_filter_pick_by_position`
        // 显式要求的行为（英雄 1 打了 4 场、同时满足 frequent 与 proficient，仍应出现在 pick）。
        let mut pick_candidates: Vec<(i32, &crate::opgg::data::ChampionMeta)> = vec![];
        // ban 向：T0 + 主分路 + 我不会玩，且不与 nemesis 重复，且不与 frequent 重复。
        // 与 pick 向相反，这里必须排除 frequent：is_proficient 只是 frequent 的子集
        // 判据（多了胜率 ≥50% 一道门槛），打过 ≥3 场但胜率 <50% 的英雄会同时落入
        // "常用"(frequent, pick 池候选) 与 "不会玩"(!is_proficient, ban 池候选)——
        // 不排除就会对同一英雄同时给出「建议加入英雄池」和「建议 ban」的矛盾推荐。
        let mut ban_candidates: Vec<(i32, &crate::opgg::data::ChampionMeta)> = vec![];

        for (champ_id, metas) in &snap.champions {
            let Some(main) = metas.iter().find(|m| m.is_main_position && m.tier == 1) else {
                continue;
            };
            let agg = my_champs.get(champ_id);
            // effective_pos 为空串 = 显式「全部分路」或主分路无法推断，均不过滤 pick 向。
            if (effective_pos.is_empty() || main.position == effective_pos) && is_proficient(agg) {
                pick_candidates.push((*champ_id, main));
            } else if !is_proficient(agg)
                && !nemesis_set.contains(champ_id)
                && !my_frequent_ids.contains(champ_id)
            {
                ban_candidates.push((*champ_id, main));
            }
        }

        // pick 向：按场次/胜率降序（贴近 frequent 排序习惯）
        pick_candidates.sort_by(|(a_id, _), (b_id, _)| {
            let (ga, wa) = my_champs.get(a_id).copied().unwrap_or((0, 0));
            let (gb, wb) = my_champs.get(b_id).copied().unwrap_or((0, 0));
            (gb, wb).cmp(&(ga, wa))
        });
        // ban 向：按 ban_rate 降序
        ban_candidates.sort_by(|(_, a), (_, b)| {
            b.ban_rate
                .partial_cmp(&a.ban_rate)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        for (champ_id, meta) in pick_candidates.into_iter().take(SECTION_CAP) {
            let agg = my_champs.get(&champ_id);
            hot_t0.push(BpSuggestItem {
                champion_id: champ_id,
                suggested_pool: "pick".to_string(),
                already_in_pool: pick_pool.contains(&champ_id),
                evidence: BpSuggestEvidence {
                    games: agg.map(|(g, _)| *g),
                    win_rate: agg.map(|(g, w)| *w as f64 / *g as f64),
                    opgg_tier: Some(meta.tier),
                    opgg_win_rate: Some(meta.win_rate),
                    position: Some(meta.position.clone()),
                    ..Default::default()
                },
            });
        }
        let remaining = SECTION_CAP.saturating_sub(hot_t0.len());
        for (champ_id, meta) in ban_candidates.into_iter().take(remaining) {
            let agg = my_champs.get(&champ_id);
            hot_t0.push(BpSuggestItem {
                champion_id: champ_id,
                suggested_pool: "ban".to_string(),
                already_in_pool: ban_pool.contains(&champ_id),
                evidence: BpSuggestEvidence {
                    games: agg.map(|(g, _)| *g),
                    win_rate: agg.map(|(g, w)| *w as f64 / *g as f64),
                    opgg_tier: Some(meta.tier),
                    opgg_win_rate: Some(meta.win_rate),
                    position: Some(meta.position.clone()),
                    ..Default::default()
                },
            });
        }
    }

    BpSuggestResult {
        main_position,
        sample_games: games.len() as i32,
        opgg_ok,
        frequent,
        nemesis,
        hot_t0,
    }
}

/// 读取兜底池配置（照抄 automation.rs::load_champion_pool 的容错读法）。
async fn load_pool(key: &str) -> Vec<i32> {
    let to_ids = |list: &Vec<Value>| -> Vec<i32> {
        list.iter()
            .filter_map(|v| match v {
                Value::Integer(i) => Some(*i as i32),
                _ => None,
            })
            .collect()
    };
    match get_config(key).await {
        Ok(Value::Map(m)) => match m.get("value") {
            Some(Value::List(list)) => to_ids(list),
            _ => vec![],
        },
        Ok(Value::List(list)) => to_ids(&list),
        _ => vec![],
    }
}

/// BP 智能推荐：算出三类兜底池候选。
///
/// # 参数
/// - `position`: 显式指定分路（大写 TOP/...）；None 用常用英雄推断的主分路
///
/// # 行为
/// - 近 30 场里筛排位（420/440）；排位不足 10 场则放宽用全部模式
/// - 全部样本仍不足 10 场时返回空分区（sample_games 告知前端显示空态）
/// - OP.GG 快照拿不到时 opgg_ok=false，hot_t0 为空，其余分区照常
#[tauri::command]
pub async fn get_bp_suggest(
    position: Option<String>,
    state: State<'_, AppState>,
) -> Result<BpSuggestResult, String> {
    let me = Summoner::get_my_summoner().await?;
    let mut history =
        MatchHistory::get_match_history_by_puuid(&me.puuid, 0, SAMPLE_GAMES - 1).await?;
    history.enrich_game_detail().await?;

    let all_games = history.games.games;
    let ranked: Vec<Game> = all_games
        .iter()
        .filter(|g| RANKED_QUEUES.contains(&g.queue_id))
        .cloned()
        .collect();
    let games: &[Game] = if ranked.len() >= MIN_SAMPLE_GAMES {
        &ranked
    } else {
        &all_games
    };

    if games.len() < MIN_SAMPLE_GAMES {
        return Ok(BpSuggestResult {
            main_position: String::new(),
            sample_games: games.len() as i32,
            opgg_ok: false,
            frequent: vec![],
            nemesis: vec![],
            hot_t0: vec![],
        });
    }

    // OP.GG 数据缺失不阻塞：hot_t0 降级为空
    let snapshot = crate::command::opgg::ensure_opgg_snapshot(&state, "ranked")
        .await
        .ok()
        .map(|(snap, _stale)| snap);

    let pick_pool = load_pool("settings.auto.pickChampionSlice").await;
    let ban_pool = load_pool("settings.auto.banChampionSlice").await;

    Ok(build_suggestions(
        games,
        &me.puuid,
        snapshot.as_deref(),
        position.as_deref(),
        &pick_pool,
        &ban_pool,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::game_detail::GameDetail;
    use crate::lcu::api::model::{Participant, ParticipantIdentity, Player, Stats};
    use crate::opgg::data::ChampionMeta;

    /// 构造一场对局：我用 my_champ，胜负 win，敌方阵容 enemy_champs。
    fn game(my_champ: i32, win: bool, enemy_champs: &[i32], queue_id: i32) -> Game {
        let me = Participant {
            team_id: 100,
            champion_id: my_champ,
            stats: Stats {
                win,
                ..Default::default()
            },
            ..Default::default()
        };
        // game_detail：我 + 敌方（识别靠 puuid，敌方 team_id=200）
        let mut participants = vec![me.clone()];
        let mut identities = vec![ParticipantIdentity {
            player: Player {
                puuid: "me".into(),
                ..Default::default()
            },
        }];
        for (i, champ) in enemy_champs.iter().enumerate() {
            participants.push(Participant {
                team_id: 200,
                champion_id: *champ,
                stats: Stats {
                    win: !win,
                    ..Default::default()
                },
                ..Default::default()
            });
            identities.push(ParticipantIdentity {
                player: Player {
                    puuid: format!("enemy{}", i),
                    ..Default::default()
                },
            });
        }
        Game {
            queue_id,
            participants: vec![me],
            game_detail: GameDetail {
                participants,
                participant_identities: identities,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn meta(champion_id: i32, position: &str, tier: i32, ban_rate: f64) -> ChampionMeta {
        ChampionMeta {
            champion_id,
            position: position.into(),
            tier,
            rank: 1,
            rank_prev_patch: 0,
            win_rate: 0.52,
            pick_rate: 0.1,
            ban_rate,
            role_rate: 0.8,
            is_main_position: true,
        }
    }

    fn snapshot(metas: Vec<ChampionMeta>) -> OpggSnapshot {
        let mut champions: HashMap<i32, Vec<ChampionMeta>> = HashMap::new();
        for m in metas {
            champions.entry(m.champion_id).or_default().push(m);
        }
        OpggSnapshot {
            mode: "ranked".into(),
            tier: "emerald_plus".into(),
            patch: "16.13".into(),
            fetched_at: 0,
            champions,
            counters: HashMap::new(),
        }
    }

    #[test]
    fn frequent_should_require_min_games_and_sort_by_count() {
        // 英雄 1 打 4 场、英雄 2 打 3 场、英雄 3 打 2 场（低于门槛淘汰）
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(2, false, &[50], 420));
        }
        for _ in 0..2 {
            games.push(game(3, true, &[50], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[], &[]);
        let ids: Vec<i32> = result.frequent.iter().map(|i| i.champion_id).collect();
        assert_eq!(ids, vec![1, 2]);
        assert_eq!(result.frequent[0].suggested_pool, "pick");
        assert_eq!(result.frequent[0].evidence.games, Some(4));
        assert_eq!(result.frequent[0].evidence.win_rate, Some(1.0));
    }

    #[test]
    fn nemesis_should_count_enemies_in_losses_only_and_skip_my_frequents() {
        let mut games = vec![];
        // 3 场败局都有敌方英雄 77；1 场胜局的敌方 88 不该被计入
        for _ in 0..3 {
            games.push(game(1, false, &[77, 78], 420));
        }
        games.push(game(1, true, &[88], 420));
        // 我自己也常玩 78（4 场）→ nemesis 应排除 78
        for _ in 0..4 {
            games.push(game(78, true, &[50], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[], &[]);
        let ids: Vec<i32> = result.nemesis.iter().map(|i| i.champion_id).collect();
        assert_eq!(
            ids,
            vec![77],
            "只统计败局敌方,排除自己常玩的 78,88 不达门槛"
        );
        assert_eq!(result.nemesis[0].suggested_pool, "ban");
        assert_eq!(result.nemesis[0].evidence.losses_against, Some(3));
        assert_eq!(result.nemesis[0].evidence.loss_games, Some(3));
    }

    #[test]
    fn hot_t0_should_split_by_proficiency_and_filter_pick_by_position() {
        // 英雄 1：T0 上单,我 4 场全胜 → pick；英雄 5：T0 中单,我没玩过 → ban
        // 英雄 6：T0 上单但我没玩过 → ban（ban 不限分路）
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        let snap = snapshot(vec![
            meta(1, "TOP", 1, 0.2),
            meta(5, "MIDDLE", 1, 0.3),
            meta(6, "TOP", 1, 0.1),
        ]);
        let result = build_suggestions(&games, "me", Some(&snap), Some("TOP"), &[], &[]);
        assert!(result.opgg_ok);
        let picks: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "pick")
            .map(|i| i.champion_id)
            .collect();
        let bans: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "ban")
            .map(|i| i.champion_id)
            .collect();
        assert_eq!(picks, vec![1]);
        // ban 向按 ban_rate 降序：5(0.3) 在 6(0.1) 前
        assert_eq!(bans, vec![5, 6]);
    }

    #[test]
    fn hot_t0_pick_should_not_filter_by_position_when_explicitly_empty() {
        // 主分路投票会是 TOP（英雄 1 打了 4 场 TOP，多于英雄 5 的 3 场 MIDDLE），
        // 但显式传 Some("")（=「全部分路」，不过滤）时，MIDDLE 的会玩英雄（5）
        // 也应出现在 pick 向，不应被按 TOP 过滤掉。
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(5, true, &[50], 420));
        }
        let snap = snapshot(vec![meta(1, "TOP", 1, 0.2), meta(5, "MIDDLE", 1, 0.3)]);
        let result = build_suggestions(&games, "me", Some(&snap), Some(""), &[], &[]);
        let picks: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "pick")
            .map(|i| i.champion_id)
            .collect();
        assert!(picks.contains(&1), "TOP 会玩英雄应出现在 pick 向");
        assert!(
            picks.contains(&5),
            "显式空字符串=不过滤分路，MIDDLE 会玩英雄也应出现在 pick 向"
        );
    }

    #[test]
    fn hot_t0_ban_should_exclude_my_frequent_champions() {
        // 英雄 9：T0 主分路 TOP,我打过 3 场但全败(胜率 0% → 不「会玩」)
        // 它已在 frequent(3 场达标)——不该再被建议 ban,矛盾推荐
        let mut games = vec![];
        for _ in 0..3 {
            games.push(game(9, false, &[50], 420));
        }
        let snap = snapshot(vec![meta(9, "TOP", 1, 0.2)]);
        let result = build_suggestions(&games, "me", Some(&snap), Some("TOP"), &[], &[]);
        assert!(
            result.frequent.iter().any(|i| i.champion_id == 9),
            "9 是常用英雄"
        );
        assert!(
            !result.hot_t0.iter().any(|i| i.champion_id == 9),
            "常用英雄不该出现在 hot_t0 ban 向"
        );
    }

    #[test]
    fn main_position_should_be_weighted_mode_of_opgg_main_positions() {
        // 英雄 1(TOP) 4 场 + 英雄 2(TOP) 2 场 vs 英雄 3(MIDDLE) 3 场 → TOP
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..2 {
            games.push(game(2, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(3, true, &[50], 420));
        }
        let snap = snapshot(vec![
            meta(1, "TOP", 2, 0.1),
            meta(2, "TOP", 3, 0.1),
            meta(3, "MIDDLE", 2, 0.1),
        ]);
        let result = build_suggestions(&games, "me", Some(&snap), None, &[], &[]);
        assert_eq!(result.main_position, "TOP");
        // 未显式传分路时,hot_t0 pick 向应按推断出的 TOP 过滤
    }

    #[test]
    fn already_in_pool_should_be_flagged_per_target_pool() {
        let mut games = vec![];
        for _ in 0..3 {
            games.push(game(1, false, &[77], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[1], &[77]);
        assert!(result.frequent[0].already_in_pool, "1 已在 pick 池");
        assert!(result.nemesis[0].already_in_pool, "77 已在 ban 池");
    }
}
