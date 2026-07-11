//! # LCU 选人阶段 API
//!
//! 对应选人相关接口：当前选人会话（己方队伍、计时器、本地玩家位置等）。

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::lcu::util::http::{lcu_get, lcu_patch, lcu_post};
use serde::{Deserialize, Serialize};

/// 选人会话：己方队伍、行动列表、计时器、本地玩家格子 ID。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectSession {
    pub my_team: Vec<OnePlayer>,
    #[serde(default)]
    pub their_team: Vec<OnePlayer>,
    pub actions: Vec<Vec<Action>>,
    pub timer: Timer,
    pub local_player_cell_id: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub actor_cell_id: i32,
    pub id: i32,
    pub champion_id: i32,
    pub completed: bool,
    pub is_ally_action: bool,
    pub is_in_progress: bool,
    #[serde(rename = "type")]
    pub action_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    #[serde(default)]
    pub adjusted_time_left_in_phase: f64,
    #[serde(default)]
    pub internal_now_in_phase: f64,
    #[serde(default)]
    pub is_infinite: bool,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub total_time_in_phase: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OnePlayer {
    pub champion_id: i32,
    pub puuid: String,
    #[serde(default)]
    pub assigned_position: String,
    /// 选人格子 ID（0~4 我方、5~9 敌方；旧接口无此字段时默认 0）
    #[serde(default)]
    pub cell_id: i32,
}

#[derive(Debug, Clone)]
struct SelectSessionCache {
    last_session: Option<SelectSession>,
    last_fetch_time: Option<Instant>,
}

impl SelectSessionCache {
    fn new() -> Self {
        Self {
            last_session: None,
            last_fetch_time: None,
        }
    }
}

static SELECT_CACHE: LazyLock<Mutex<SelectSessionCache>> =
    LazyLock::new(|| Mutex::new(SelectSessionCache::new()));

/// 从选人会话推导每个格子的选人状态。
///
/// 状态优先级：已完成 pick(champion>0)=locked > 进行中 pick=picking >
/// 亮出英雄未锁=intent > 无信息=none。ban 类 action 不参与。
/// actions 缺失该格信息但队伍条目已有英雄时兜底为 locked
/// （某些时点 LCU 会清空已结束的 action 轮次）。
pub fn derive_pick_states(session: &SelectSession) -> std::collections::HashMap<i32, String> {
    use std::collections::HashMap;
    let mut states: HashMap<i32, String> = HashMap::new();

    let all_players = session.my_team.iter().chain(session.their_team.iter());
    for p in all_players {
        let mut state = "none";
        let mut intent_champion = p.champion_id;

        for action in session.actions.iter().flatten() {
            if action.actor_cell_id != p.cell_id || action.action_type != "pick" {
                continue;
            }
            if action.completed && action.champion_id > 0 {
                state = "locked";
                break;
            }
            if action.is_in_progress {
                state = "picking";
            } else if action.champion_id > 0 && state == "none" {
                state = "intent";
            }
            if action.champion_id > 0 {
                intent_champion = action.champion_id;
            }
        }

        // 兜底：无 action 佐证但队伍条目已有英雄 → 视为已锁定
        if state == "none" && p.champion_id > 0 {
            state = "locked";
        }
        // 亮出英雄但未在选（intent 需有英雄可展示）
        if state == "intent" && intent_champion <= 0 {
            state = "none";
        }
        states.insert(p.cell_id, state.to_string());
    }
    states
}

pub async fn get_champion_select_session() -> Result<SelectSession, String> {
    {
        let cache = SELECT_CACHE.lock().unwrap();

        // 检查缓存是否在1秒内
        if let Some(last_fetch_time) = cache.last_fetch_time {
            if last_fetch_time.elapsed() <= Duration::from_secs(1) {
                if let Some(ref session) = cache.last_session {
                    return Ok(session.clone());
                }
            }
        }
    }

    let uri = "lol-champ-select/v1/session";
    let select_session = lcu_get::<SelectSession>(uri).await?;

    // 更新缓存
    {
        let mut cache = SELECT_CACHE.lock().unwrap();
        cache.last_session = Some(select_session.clone());
        cache.last_fetch_time = Some(Instant::now());
    }

    Ok(select_session)
}

pub async fn post_accept_match() -> Result<(), String> {
    let uri = "lol-matchmaking/v1/ready-check/accept";
    lcu_post::<(), ()>(uri, &()).await?;
    Ok(())
}

#[derive(Serialize)]
struct PatchData {
    #[serde(rename = "championId")]
    champion_id: i32,
    #[serde(rename = "type")]
    action_type: String,
    completed: bool,
}

pub async fn patch_session_action(
    action_id: i32,
    champion_id: i32,
    action_type: String,
    completed: bool,
) -> Result<(), String> {
    let uri = format!("lol-champ-select/v1/session/actions/{}", action_id);
    let patch_data = PatchData {
        champion_id,
        action_type,
        completed,
    };

    lcu_patch::<(), _>(&uri, &patch_data).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_deserialize_their_team_and_assigned_position() {
        let raw = r#"{
            "myTeam": [{"championId": 1, "puuid": "p1", "assignedPosition": "middle"}],
            "theirTeam": [{"championId": 2, "puuid": "p2", "assignedPosition": ""}],
            "actions": [],
            "timer": {},
            "localPlayerCellId": 0
        }"#;
        let s: SelectSession = serde_json::from_str(raw).unwrap();
        assert_eq!(s.their_team.len(), 1);
        assert_eq!(s.their_team[0].champion_id, 2);
        assert_eq!(s.my_team[0].assigned_position, "middle");
        assert_eq!(s.their_team[0].assigned_position, "");
    }

    fn mk_session(
        my: Vec<(i32, i32)>, // (cell_id, champion_id)
        their: Vec<(i32, i32)>,
        actions: Vec<Action>,
    ) -> SelectSession {
        let mk = |v: Vec<(i32, i32)>| {
            v.into_iter()
                .map(|(cell_id, champion_id)| OnePlayer {
                    champion_id,
                    puuid: String::new(),
                    assigned_position: String::new(),
                    cell_id,
                })
                .collect()
        };
        SelectSession {
            my_team: mk(my),
            their_team: mk(their),
            actions: vec![actions],
            timer: Timer::default(),
            local_player_cell_id: 0,
        }
    }

    fn pick_action(cell: i32, champ: i32, completed: bool, in_progress: bool) -> Action {
        Action {
            actor_cell_id: cell,
            id: cell,
            champion_id: champ,
            completed,
            is_ally_action: true,
            is_in_progress: in_progress,
            action_type: "pick".into(),
        }
    }

    #[test]
    fn should_derive_locked_picking_intent_none() {
        let s = mk_session(
            vec![(0, 86), (1, 0)],
            vec![(5, 10), (6, 0)],
            vec![
                pick_action(0, 86, true, false),  // 已锁定
                pick_action(1, 0, false, true),   // 正在选(未亮英雄)
                pick_action(5, 10, false, false), // 亮出未锁 → intent
            ],
        );
        let m = derive_pick_states(&s);
        assert_eq!(m[&0], "locked");
        assert_eq!(m[&1], "picking");
        assert_eq!(m[&5], "intent");
        assert_eq!(m[&6], "none");
    }

    #[test]
    fn should_ignore_ban_actions_and_fallback_to_locked_without_actions() {
        // ban action 不影响 pick 态；无 actions 但队伍条目有英雄 → locked 兜底
        let mut ban = pick_action(0, 266, true, false);
        ban.action_type = "ban".into();
        let s = mk_session(vec![(0, 86)], vec![], vec![ban]);
        let m = derive_pick_states(&s);
        assert_eq!(m[&0], "locked");
    }

    #[test]
    fn should_deserialize_cell_id_with_default() {
        let raw = r#"{"championId": 1, "puuid": "p1", "assignedPosition": "middle"}"#;
        let p: OnePlayer = serde_json::from_str(raw).unwrap();
        assert_eq!(p.cell_id, 0); // 缺字段不炸
        let raw2 = r#"{"championId": 1, "puuid": "p1", "cellId": 7}"#;
        let p2: OnePlayer = serde_json::from_str(raw2).unwrap();
        assert_eq!(p2.cell_id, 7);
    }
}
