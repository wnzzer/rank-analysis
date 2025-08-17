use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::lcu::util::http::{lcu_get, lcu_patch, lcu_post};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectSession {
    pub my_team: Vec<OnePlayer>,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub adjusted_time_left_in_phase: f64,
    pub internal_now_in_phase: f64,
    pub is_infinite: bool,
    pub phase: String,
    pub total_time_in_phase: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OnePlayer {
    pub champion_id: i32,
    pub puuid: String,
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
