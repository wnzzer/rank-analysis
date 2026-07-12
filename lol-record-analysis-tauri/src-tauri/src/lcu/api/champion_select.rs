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
    /// 悬停中（未锁定）的意向英雄 ID。LCU 在队友「正在选用」但还未点击锁定时
    /// 通过 myTeam[].championPickIntent 推送；敌方通常为 0（隐藏）。
    /// 旧接口/字段缺失时默认 0。
    #[serde(default)]
    pub champion_pick_intent: i32,
}

/// 选人期该格用于展示的英雄：已锁定用 `champion_id`，否则回退悬停意向
/// `champion_pick_intent`（尚未锁定时 LCU 才会填充该字段）。
pub fn display_champion_id(p: &OnePlayer) -> i32 {
    if p.champion_id > 0 {
        p.champion_id
    } else {
        p.champion_pick_intent
    }
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

/// 选人会话的结构化视图：会话级阶段 + 双方已 ban + 每格状态。
///
/// 由 [`derive_champ_select_view`] 从 [`SelectSession`] 推导得到，随
/// [`crate::command::session::SessionData`] 一并推送给前端，供选人阶段
/// UI（预选/ban/选人/确认）驱动展示逻辑，无需前端自行拼装 timer+actions。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChampSelectView {
    /// 会话级阶段: "planning"(预选) | "banning"(ban阶段) | "picking"(选人) | "finalization"(确认) | ""(未知)
    pub stage: String,
    /// 我方已 ban 英雄（completed ban action, champion_id>0, is_ally_action=true）
    pub my_bans: Vec<i32>,
    /// 敌方已 ban
    pub their_bans: Vec<i32>,
}

/// 从选人会话推导每个格子的状态。
///
/// 状态优先级：已完成 pick(champion>0)=locked > 进行中 ban=banning >
/// 进行中 pick=picking > 亮出英雄未锁=intent > 无信息=none。
/// actions 缺失该格信息时按队伍条目兜底：`champion_id>0`（真锁定）→ locked；
/// 否则 `champion_pick_intent>0`（LCU 推送的悬停意向，如队友「正在选用」尚未
/// 点击锁定）→ intent（某些时点 LCU 会清空已结束的 action 轮次，只能靠队伍
/// 条目兜底）。
///
/// 是 [`derive_pick_states`] 与 [`derive_champ_select_view`] 共用的唯一实现，
/// 避免两份格子状态推导逻辑分叉。
fn derive_cell_states(session: &SelectSession) -> std::collections::HashMap<i32, String> {
    use std::collections::HashMap;
    let mut states: HashMap<i32, String> = HashMap::new();

    let all_players = session.my_team.iter().chain(session.their_team.iter());
    for p in all_players {
        let mut has_locked_pick = false;
        let mut has_in_progress_ban = false;
        let mut has_in_progress_pick = false;
        // 仅由「pick」类 action 揭示的意向英雄；不要用队伍条目的 champion_id
        // 兜底，否则会把「无 action 佐证、只能靠兜底判 locked」的格子误判成 intent。
        let mut intent_champion_from_action = 0;

        for action in session.actions.iter().flatten() {
            if action.actor_cell_id != p.cell_id {
                continue;
            }
            if action.action_type == "pick" {
                if action.completed && action.champion_id > 0 {
                    has_locked_pick = true;
                }
                if action.is_in_progress {
                    has_in_progress_pick = true;
                }
                if action.champion_id > 0 {
                    intent_champion_from_action = action.champion_id;
                }
            } else if action.action_type == "ban" && action.is_in_progress {
                has_in_progress_ban = true;
            }
        }

        let mut state = if has_locked_pick {
            "locked"
        } else if has_in_progress_ban {
            "banning"
        } else if has_in_progress_pick {
            "picking"
        } else if intent_champion_from_action > 0 {
            "intent"
        } else {
            "none"
        };

        // 兜底：无 action 佐证但队伍条目已有英雄 → 视为已锁定
        // 注意 p.champion_id>0 才是真锁定；championPickIntent>0 不得走这条兜底。
        if state == "none" && p.champion_id > 0 {
            state = "locked";
        } else if state == "none" && p.champion_id == 0 && p.champion_pick_intent > 0 {
            // 兜底：无 action 佐证、未锁定，但 LCU 推送了悬停意向 → intent
            state = "intent";
        }
        states.insert(p.cell_id, state.to_string());
    }
    states
}

/// 从选人会话推导每个格子的选人状态。
///
/// 委托给 [`derive_cell_states`]（与 [`derive_champ_select_view`] 共用实现）。
/// 公开签名保持不变，避免破坏既有调用方/测试。
pub fn derive_pick_states(session: &SelectSession) -> std::collections::HashMap<i32, String> {
    derive_cell_states(session)
}

/// 从 `timer.phase` + `actions` 推导会话级阶段与双方已 ban 列表，
/// 并返回每格状态（含 "banning"）。
///
/// # 阶段推导规则
///
/// - `PLANNING` → `"planning"`（预选）
/// - `BAN_PICK` → 存在 in-progress 的 ban action 时为 `"banning"`，否则 `"picking"`
/// - `FINALIZATION` / `GAME_STARTING` → `"finalization"`（对前端等价：都已定）
/// - 其他/空 → `""`
///
/// # Ban 列表
///
/// 仅统计已完成（`completed`）且 `champion_id > 0` 的 ban action，按
/// `is_ally_action` 分流到 `my_bans` / `their_bans`。
pub fn derive_champ_select_view(
    session: &SelectSession,
) -> (ChampSelectView, std::collections::HashMap<i32, String>) {
    let has_in_progress_ban = session
        .actions
        .iter()
        .flatten()
        .any(|a| a.action_type == "ban" && a.is_in_progress);

    let stage = match session.timer.phase.as_str() {
        "PLANNING" => "planning",
        "BAN_PICK" => {
            if has_in_progress_ban {
                "banning"
            } else {
                "picking"
            }
        }
        "FINALIZATION" | "GAME_STARTING" => "finalization",
        _ => "",
    }
    .to_string();

    let mut my_bans = Vec::new();
    let mut their_bans = Vec::new();
    for action in session.actions.iter().flatten() {
        if action.action_type == "ban" && action.completed && action.champion_id > 0 {
            if action.is_ally_action {
                my_bans.push(action.champion_id);
            } else {
                their_bans.push(action.champion_id);
            }
        }
    }

    let states = derive_cell_states(session);

    (
        ChampSelectView {
            stage,
            my_bans,
            their_bans,
        },
        states,
    )
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
                    champion_pick_intent: 0,
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

    #[test]
    fn should_deserialize_champion_pick_intent_with_default() {
        // 缺字段（旧接口/敌方通常不下发）默认 0，不炸
        let raw = r#"{"championId": 0, "puuid": "p1"}"#;
        let p: OnePlayer = serde_json::from_str(raw).unwrap();
        assert_eq!(p.champion_pick_intent, 0);

        // LCU 悬停未锁时下发的意向英雄 ID
        let raw2 = r#"{"championId": 0, "puuid": "p1", "championPickIntent": 157}"#;
        let p2: OnePlayer = serde_json::from_str(raw2).unwrap();
        assert_eq!(p2.champion_pick_intent, 157);
    }

    fn mk_player(champion_id: i32, champion_pick_intent: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: String::new(),
            assigned_position: String::new(),
            cell_id: 0,
            champion_pick_intent,
        }
    }

    #[test]
    fn display_champion_id_prefers_locked_champion_over_intent() {
        // 已锁定：即使 intent 字段仍残留旧值，也应展示 champion_id
        let p = mk_player(86, 157);
        assert_eq!(display_champion_id(&p), 86);
    }

    #[test]
    fn display_champion_id_falls_back_to_intent_when_not_locked() {
        // 未锁定（champion_id=0）：展示悬停意向
        let p = mk_player(0, 157);
        assert_eq!(display_champion_id(&p), 157);
    }

    #[test]
    fn display_champion_id_is_zero_when_neither_locked_nor_hovered() {
        let p = mk_player(0, 0);
        assert_eq!(display_champion_id(&p), 0);
    }

    #[test]
    fn cell_state_is_intent_when_pick_intent_present_without_any_action() {
        // 选人期刚进入、还没有该格的 action 记录，但 myTeam 已推送 championPickIntent
        // → 应识别为 intent，而不是误判 locked 或 none。
        let mut s = mk_session(vec![(0, 0)], vec![], vec![]);
        s.my_team[0].champion_pick_intent = 157;
        let m = derive_pick_states(&s);
        assert_eq!(m[&0], "intent");
    }

    #[test]
    fn cell_state_stays_locked_when_champion_id_set_without_any_action() {
        // 回归：champion_id>0（真锁定）无 action 佐证时仍应兜底为 locked，
        // 不应被 championPickIntent 的新分支影响。
        let s = mk_session(vec![(0, 86)], vec![], vec![]);
        let m = derive_pick_states(&s);
        assert_eq!(m[&0], "locked");
    }

    fn ban_action(cell: i32, champ: i32, completed: bool, in_progress: bool, ally: bool) -> Action {
        Action {
            actor_cell_id: cell,
            id: cell,
            champion_id: champ,
            completed,
            is_ally_action: ally,
            is_in_progress: in_progress,
            action_type: "ban".into(),
        }
    }

    fn with_phase(mut session: SelectSession, phase: &str) -> SelectSession {
        session.timer.phase = phase.into();
        session
    }

    #[test]
    fn planning_stage_marks_revealed_cells_as_intent() {
        // 预选阶段：亮出英雄但未锁定/未进入 ban-pick，格子态应为 intent
        let s = with_phase(
            mk_session(
                vec![(0, 86)],
                vec![],
                vec![pick_action(0, 86, false, false)],
            ),
            "PLANNING",
        );
        let (view, states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "planning");
        assert_eq!(states[&0], "intent");
        assert!(view.my_bans.is_empty());
        assert!(view.their_bans.is_empty());
    }

    #[test]
    fn ban_pick_with_in_progress_ban_is_banning_stage_and_completed_bans_split_by_side() {
        let s = with_phase(
            mk_session(
                vec![(0, 0), (1, 0)],
                vec![(5, 0)],
                vec![
                    ban_action(0, 0, false, true, true),   // 我方正在 ban（未选目标）
                    ban_action(1, 266, true, false, true), // 我方已完成 ban
                    ban_action(5, 103, true, false, false), // 敌方已完成 ban
                ],
            ),
            "BAN_PICK",
        );
        let (view, states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "banning");
        assert_eq!(states[&0], "banning");
        assert_eq!(view.my_bans, vec![266]);
        assert_eq!(view.their_bans, vec![103]);
    }

    #[test]
    fn ban_pick_without_in_progress_ban_is_picking_stage() {
        let s = with_phase(
            mk_session(
                vec![(0, 0)],
                vec![],
                vec![pick_action(0, 0, false, true)], // 正在选人
            ),
            "BAN_PICK",
        );
        let (view, states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "picking");
        assert_eq!(states[&0], "picking");
    }

    #[test]
    fn finalization_stage_keeps_locked_cells_locked() {
        let s = with_phase(
            mk_session(vec![(0, 86)], vec![], vec![pick_action(0, 86, true, false)]),
            "FINALIZATION",
        );
        let (view, states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "finalization");
        assert_eq!(states[&0], "locked");
    }

    #[test]
    fn game_starting_phase_is_treated_as_finalization() {
        let s = with_phase(mk_session(vec![], vec![], vec![]), "GAME_STARTING");
        let (view, _states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "finalization");
    }

    #[test]
    fn unknown_phase_yields_empty_stage() {
        let s = with_phase(mk_session(vec![], vec![], vec![]), "");
        let (view, _states) = derive_champ_select_view(&s);
        assert_eq!(view.stage, "");
    }

    #[test]
    fn ban_with_no_champion_target_is_excluded_from_bans_list() {
        // 完成的 ban action 但 championId=0（异常/未选目标）不应计入 bans 列表
        let s = with_phase(
            mk_session(
                vec![(0, 0)],
                vec![],
                vec![ban_action(0, 0, true, false, true)],
            ),
            "BAN_PICK",
        );
        let (view, _states) = derive_champ_select_view(&s);
        assert!(view.my_bans.is_empty());
        assert!(view.their_bans.is_empty());
    }

    #[test]
    fn champ_select_view_serializes_to_camel_case() {
        let view = ChampSelectView {
            stage: "banning".into(),
            my_bans: vec![266],
            their_bans: vec![103],
        };
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["stage"], "banning");
        assert_eq!(json["myBans"][0], 266);
        assert_eq!(json["theirBans"][0], 103);
    }
}
