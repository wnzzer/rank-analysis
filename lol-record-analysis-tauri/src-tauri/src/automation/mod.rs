use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::interval;

use crate::config::{get_config, register_on_change_callback, Value};
use crate::constant::game::{CHAMPSELECT, LOBBY, MATCHMAKING, READYCHECK};
use crate::lcu::api::champion_select::{
    get_champion_select_session, patch_session_action, post_accept_match,
};
use crate::lcu::api::lobby::Lobby;
use crate::lcu::api::phase::get_phase;

static AUTOMATION_MANAGER: OnceLock<AutomationManager> = OnceLock::new();

#[derive(Debug)]
struct AutomationTask {
    name: String,
    handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<watch::Sender<bool>>,
}

#[derive(Debug)]
struct AutomationManager {
    tasks: Arc<Mutex<HashMap<String, AutomationTask>>>,
}

impl AutomationManager {
    fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn start_task(&self, name: &str, task: impl Future<Output = ()> + Send + 'static) {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(async move {
            tokio::select! {
                _ = task => {},
                _ = Self::wait_for_shutdown(shutdown_rx) => {}
            }
        });

        let mut tasks = self.tasks.lock().unwrap();
        if let Some(existing_task) = tasks.get_mut(name) {
            // 停止现有任务
            if let Some(tx) = existing_task.shutdown_tx.take() {
                let _ = tx.send(true);
            }
            if let Some(handle) = existing_task.handle.take() {
                handle.abort();
            }
        }

        tasks.insert(
            name.to_string(),
            AutomationTask {
                name: name.to_string(),
                handle: Some(handle),
                shutdown_tx: Some(shutdown_tx),
            },
        );
    }

    fn stop_task(&self, name: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(name) {
            if let Some(tx) = task.shutdown_tx.take() {
                let _ = tx.send(true);
            }
            if let Some(handle) = task.handle.take() {
                handle.abort();
            }
        }
        tasks.remove(name);
    }

    async fn wait_for_shutdown(mut shutdown_rx: watch::Receiver<bool>) {
        loop {
            if *shutdown_rx.borrow() {
                break;
            }
            if shutdown_rx.changed().await.is_err() {
                break;
            }
        }
    }
}

use std::future::Future;

/// 自动接受匹配
async fn start_accept_match_automation() {
    let mut ticker = interval(Duration::from_millis(100));

    loop {
        ticker.tick().await;

        match get_phase().await {
            Ok(phase) if phase == READYCHECK => {
                if let Err(e) = post_accept_match().await {
                    eprintln!("Accept match error: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Get phase error: {}", e);
            }
            _ => {}
        }
    }
}

/// 自动开始匹配
async fn start_match_automation() {
    let mut ticker = interval(Duration::from_secs(1));
    let mut last_search_state = String::new();
    let mut auto_match_enabled = true;

    loop {
        ticker.tick().await;

        let cur_state = match get_phase().await {
            Ok(state) => state,
            Err(e) => {
                eprintln!("Get phase error: {}", e);
                continue;
            }
        };

        // 如果状态没变，跳过本次循环
        if last_search_state == cur_state {
            continue;
        }

        // 从匹配状态变回大厅状态，说明取消了匹配
        if last_search_state == MATCHMAKING && cur_state == LOBBY {
            auto_match_enabled = false;
            last_search_state = cur_state;
            continue;
        }

        // 恢复自动匹配状态
        if !auto_match_enabled && cur_state != LOBBY {
            auto_match_enabled = true;
            continue;
        }

        // 检查是否开启自动匹配
        if !auto_match_enabled {
            last_search_state = cur_state;
            continue;
        }

        last_search_state = cur_state.clone();

        // 检查当前游戏阶段
        if cur_state != LOBBY {
            continue;
        }

        // 获取房间信息
        let lobby = match Lobby::get_lobby().await {
            Ok(lobby) => lobby,
            Err(e) => {
                eprintln!("Get lobby error: {}", e);
                continue;
            }
        };

        // 检查是否是自定义游戏
        if lobby.game_config.is_custom {
            continue;
        }

        // 检查是否是房主
        if !is_leader(&lobby.members) {
            continue;
        }

        // 开始匹配
        if let Err(e) = Lobby::post_match_search().await {
            eprintln!("Start match search error: {}", e);
        }

        // 等待6秒钟
        tokio::time::sleep(Duration::from_secs(6)).await;
    }
}

/// 判断是否是房主
fn is_leader(members: &[crate::lcu::api::lobby::Member]) -> bool {
    members.iter().any(|member| member.is_leader)
}

/// 自动选择英雄
async fn start_champion_select_automation() {
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                eprintln!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            continue;
        }

        if let Err(e) = start_select_champion().await {
            eprintln!("Select champion error: {}", e);
        }
    }
}

async fn start_select_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;

    let my_pick_champion_slice = match get_config("settings.auto.pickChampionSlice").await {
        Ok(Value::List(list)) => list
            .iter()
            .filter_map(|v| match v {
                Value::Integer(i) => Some(*i as i32),
                _ => None,
            })
            .collect::<Vec<i32>>(),
        _ => vec![],
    };

    let mut not_select_champion_ids = HashMap::new();

    // 获取ban的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id != my_cell_id && ban.completed {
                    not_select_champion_ids.insert(ban.champion_id, true);
                }
            }
        }
    }

    // 获取队友选择的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "pick" {
            for pick in action_group {
                if pick.actor_cell_id != my_cell_id && pick.champion_id != 0 {
                    not_select_champion_ids.insert(pick.champion_id, true);
                }
            }
        }
    }

    let will_select_champion_id = if my_pick_champion_slice.is_empty() {
        1
    } else {
        my_pick_champion_slice
            .iter()
            .find(|&&champion_id| !not_select_champion_ids.contains_key(&champion_id))
            .copied()
            .unwrap_or(1)
    };

    // 查找我的选择动作
    let mut action_id = -1;
    let mut is_in_progress = false;
    let mut my_picked_champion_id = -1;
    let mut completed = false;

    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "pick" {
            for pick in action_group {
                if pick.actor_cell_id == my_cell_id {
                    completed = pick.completed;
                    my_picked_champion_id = pick.champion_id;
                    action_id = pick.id;
                    if pick.is_in_progress {
                        is_in_progress = true;
                    }
                    break;
                }
            }
        }
    }

    if action_id != -1 {
        if is_in_progress && !completed {
            patch_session_action(action_id, will_select_champion_id, "pick".to_string(), true)
                .await?;
        } else if my_picked_champion_id == 0 && !completed && !is_in_progress {
            patch_session_action(
                action_id,
                will_select_champion_id,
                "pick".to_string(),
                false,
            )
            .await?;
        }
    }

    Ok(())
}

/// 自动禁用英雄
async fn start_champion_ban_automation() {
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                eprintln!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            continue;
        }

        if let Err(e) = start_ban_champion().await {
            eprintln!("Ban champion error: {}", e);
        }
    }
}

async fn start_ban_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;

    let my_ban_champion_slice = match get_config("settings.auto.banChampionSlice").await {
        Ok(Value::List(list)) => list
            .iter()
            .filter_map(|v| match v {
                Value::Integer(i) => Some(*i as i32),
                _ => None,
            })
            .collect::<Vec<i32>>(),
        _ => vec![],
    };

    let mut not_ban_champion_ids = HashMap::new();
    let mut have_ban_id = false;

    // 检查是否已经ban了，ban了则不需要再ban
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id == my_cell_id {
                    if ban.completed {
                        return Ok(());
                    }
                    have_ban_id = true;
                }
            }
        }
    }

    if !have_ban_id {
        return Ok(());
    }

    // 获取ban的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id != my_cell_id && ban.completed {
                    not_ban_champion_ids.insert(ban.champion_id, true);
                }
            }
        }
    }

    // 队友已经预选的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "pick" {
            for pick in action_group {
                if pick.actor_cell_id != my_cell_id {
                    not_ban_champion_ids.insert(pick.champion_id, true);
                }
            }
        }
    }

    let will_ban_champion_id = if my_ban_champion_slice.is_empty() {
        1
    } else {
        my_ban_champion_slice
            .iter()
            .find(|&&champion_id| !not_ban_champion_ids.contains_key(&champion_id))
            .copied()
            .unwrap_or(1)
    };

    // 查找我的ban动作
    let mut action_id = -1;
    let mut is_in_progress = false;

    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id == my_cell_id && ban.is_in_progress {
                    action_id = ban.id;
                    is_in_progress = true;
                    break;
                }
            }
        }
    }

    if action_id != -1 && is_in_progress {
        patch_session_action(action_id, will_ban_champion_id, "ban".to_string(), true).await?;
    }

    Ok(())
}

async fn init_run_automation() {
    let manager = AUTOMATION_MANAGER.get_or_init(|| AutomationManager::new());

    // 检查配置并启动对应的自动化任务
    if let Ok(Value::Boolean(true)) = get_config("settings.auto.startMatchSwitch").await {
        manager.start_task("start_match", start_match_automation());
    }

    if let Ok(Value::Boolean(true)) = get_config("settings.auto.acceptMatchSwitch").await {
        manager.start_task("accept_match", start_accept_match_automation());
    }

    if let Ok(Value::Boolean(true)) = get_config("settings.auto.banChampionSwitch").await {
        manager.start_task("ban_champion", start_champion_ban_automation());
    }

    if let Ok(Value::Boolean(true)) = get_config("settings.auto.pickChampionSwitch").await {
        manager.start_task("pick_champion", start_champion_select_automation());
    }
}

pub async fn start_automation() {
    init_run_automation().await;

    register_on_change_callback(|key: &str, new_value: &Value| {
        let manager = AUTOMATION_MANAGER.get().unwrap();

        match key {
            "settings.auto.startMatchSwitch" => {
                if let Value::Boolean(true) = new_value {
                    println!("Starting match automation");
                    manager.start_task("start_match", start_match_automation());
                } else {
                    println!("Stopping match automation");
                    manager.stop_task("start_match");
                }
            }
            "settings.auto.acceptMatchSwitch" => {
                if let Value::Boolean(true) = new_value {
                    println!("Starting accept match automation");
                    manager.start_task("accept_match", start_accept_match_automation());
                } else {
                    println!("Stopping accept match automation");
                    manager.stop_task("accept_match");
                }
            }
            "settings.auto.pickChampionSwitch" => {
                if let Value::Boolean(true) = new_value {
                    println!("Starting champion select automation");
                    manager.start_task("pick_champion", start_champion_select_automation());
                } else {
                    println!("Stopping champion select automation");
                    manager.stop_task("pick_champion");
                }
            }
            "settings.auto.banChampionSwitch" => {
                if let Value::Boolean(true) = new_value {
                    println!("Starting champion ban automation");
                    manager.start_task("ban_champion", start_champion_ban_automation());
                } else {
                    println!("Stopping champion ban automation");
                    manager.stop_task("ban_champion");
                }
            }
            _ => {}
        }
    });
}
