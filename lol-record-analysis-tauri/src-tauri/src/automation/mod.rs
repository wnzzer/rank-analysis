use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::interval;

use crate::config::{extract_bool, get_config, register_on_change_callback, Value};
use crate::constant::game::{CHAMPSELECT, LOBBY, MATCHMAKING, READYCHECK};
use crate::lcu::api::champion_select::{
    get_champion_select_session, patch_session_action, post_accept_match,
};
use crate::lcu::api::lobby::Lobby;
use crate::lcu::api::phase::get_phase;

static AUTOMATION_MANAGER: OnceLock<AutomationManager> = OnceLock::new();

#[derive(Debug)]
struct AutomationTask {
    _name: String,
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
        log::info!("Starting automation task: {}", name);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let task_name = name.to_string();
        let handle = tokio::spawn(async move {
            log::info!("Task '{}' spawned and running", task_name);
            tokio::select! {
                _ = task => {
                    log::info!("Task '{}' completed", task_name);
                },
                _ = Self::wait_for_shutdown(shutdown_rx) => {
                    log::info!("Task '{}' received shutdown signal", task_name);
                }
            }
        });

        let mut tasks = self.tasks.lock().unwrap();
        if let Some(existing_task) = tasks.get_mut(name) {
            // 停止现有任务
            log::info!("Stopping existing task: {}", name);
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
                _name: name.to_string(),
                handle: Some(handle),
                shutdown_tx: Some(shutdown_tx),
            },
        );
        log::info!("Task '{}' registered successfully", name);
    }

    fn stop_task(&self, name: &str) {
        log::info!("Stopping automation task: {}", name);
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(name) {
            if let Some(tx) = task.shutdown_tx.take() {
                let _ = tx.send(true);
            }
            if let Some(handle) = task.handle.take() {
                handle.abort();
            }
            log::info!("Task '{}' stopped successfully", name);
        } else {
            log::warn!("Attempted to stop non-existent task: {}", name);
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
    log::info!("Starting accept match automation");
    let mut ticker = interval(Duration::from_millis(100));

    loop {
        ticker.tick().await;

        match get_phase().await {
            Ok(phase) if phase == READYCHECK => {
                log::info!("Ready check detected, accepting match");
                if let Err(e) = post_accept_match().await {
                    log::error!("Accept match error: {}", e);
                }
            }
            Err(e) => {
                log::error!("Get phase error: {}", e);
            }
            _ => {}
        }
    }
}

/// 自动开始匹配
async fn start_match_automation() {
    log::info!("Starting match automation");
    let mut ticker = interval(Duration::from_secs(1));
    let mut last_search_state = String::new();
    let mut auto_match_enabled = true;

    loop {
        ticker.tick().await;

        let cur_state = match get_phase().await {
            Ok(state) => {
                let trimmed = state.trim().to_string();
                if state != trimmed {
                    log::warn!(
                        "Phase string had whitespace! Original: {:?}, Trimmed: {:?}",
                        state,
                        trimmed
                    );
                }
                log::debug!("Current phase: {:?} (len={})", trimmed, trimmed.len());
                trimmed
            }
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        // 如果状态没变，跳过本次循环
        if last_search_state == cur_state {
            log::debug!("State not changed: '{}'", cur_state);
            continue;
        }

        // 调试：显示详细的状态变化信息
        if log::log_enabled!(log::Level::Debug) {
            log::debug!(
                "State changed: '{}' (len={}) -> '{}' (len={})",
                last_search_state,
                last_search_state.len(),
                cur_state,
                cur_state.len()
            );
        } else {
            log::info!("State changed: '{}' -> '{}'", last_search_state, cur_state);
        }

        // 从匹配状态变回大厅状态，说明取消了匹配
        if last_search_state == MATCHMAKING && cur_state == LOBBY {
            log::info!("Match cancelled, disabling auto-match");
            auto_match_enabled = false;
            last_search_state = cur_state;
            continue;
        }

        // 恢复自动匹配状态
        if !auto_match_enabled && cur_state != LOBBY {
            log::info!("Re-enabling auto-match");
            auto_match_enabled = true;
            last_search_state = cur_state; // ✅ 必须更新状态！
            continue;
        }

        // 检查是否开启自动匹配
        if !auto_match_enabled {
            log::info!(
                "Auto-match is disabled, skipping, last_search_state: {}, cur_state: {}",
                last_search_state,
                cur_state
            );
            last_search_state = cur_state;
            continue;
        }

        last_search_state = cur_state.clone();

        // 检查当前游戏阶段
        if cur_state != LOBBY {
            log::warn!(
                "Not in lobby, skipping. cur_state: {:?} (len={}), LOBBY constant: {:?} (len={}), equal: {}",
                cur_state, cur_state.len(),
                LOBBY, LOBBY.len(),
                cur_state == LOBBY
            );
            continue;
        }

        // 获取房间信息
        let lobby = match Lobby::get_lobby().await {
            Ok(lobby) => lobby,
            Err(e) => {
                log::error!("Get lobby error: {}", e);
                continue;
            }
        };

        // 检查是否是自定义游戏
        if lobby.game_config.is_custom {
            log::info!(
                "Is custom game, skipping, last_search_state: {}, cur_state: {}",
                last_search_state,
                cur_state
            );
            continue;
        }

        // 检查是否是房主
        match is_leader(&lobby.members).await {
            Ok(true) => {
                log::info!("I am the leader, starting match search");
            }
            Ok(false) => {
                log::debug!("Not the leader, skipping match search");
                continue;
            }
            Err(e) => {
                log::error!("Failed to check leader status: {}", e);
                continue;
            }
        }

        // 开始匹配
        log::info!("Starting match search");
        if let Err(e) = Lobby::post_match_search().await {
            log::error!("Start match search error: {}", e);
        }

        // 等待6秒钟
        tokio::time::sleep(Duration::from_secs(6)).await;
    }
}

/// 判断当前用户是否是房主
async fn is_leader(members: &[crate::lcu::api::lobby::Member]) -> Result<bool, String> {
    use crate::lcu::api::summoner::Summoner;

    // 获取当前用户信息
    let my_summoner = Summoner::get_my_summoner().await?;
    let my_puuid = &my_summoner.puuid;

    log::debug!("My PUUID: {}", my_puuid);

    // 检查当前用户是否是房主
    let am_leader = members.iter().any(|member| {
        let is_me_and_leader = member.puuid == *my_puuid && member.is_leader;
        if member.puuid == *my_puuid {
            log::debug!("Found myself in members, is_leader: {}", member.is_leader);
        }
        is_me_and_leader
    });

    Ok(am_leader)
}

/// 自动选择英雄
async fn start_champion_select_automation() {
    log::info!("Starting champion select automation");
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            continue;
        }

        log::info!("In champion select phase, starting champion selection");
        if let Err(e) = start_select_champion().await {
            log::error!("Select champion error: {}", e);
        }
    }
}

async fn start_select_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;
    log::info!("Current player cell ID: {}", my_cell_id);

    let my_pick_champion_slice = match get_config("settings.auto.pickChampionSlice").await {
        Ok(Value::Map(m)) => {
            // Handle nested structure: { "value": [list] }
            if let Some(Value::List(list)) = m.get("value") {
                list.iter()
                    .filter_map(|v| match v {
                        Value::Integer(i) => Some(*i as i32),
                        _ => None,
                    })
                    .collect::<Vec<i32>>()
            } else {
                vec![]
            }
        }
        Ok(Value::List(list)) => {
            // Handle direct list structure (for backwards compatibility)
            list.iter()
                .filter_map(|v| match v {
                    Value::Integer(i) => Some(*i as i32),
                    _ => None,
                })
                .collect::<Vec<i32>>()
        }
        _ => vec![],
    };

    log::info!(
        "Configured champion selection list: {:?}",
        my_pick_champion_slice
    );

    let mut not_select_champion_ids = HashMap::new();

    // 获取ban的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id != my_cell_id && ban.completed {
                    not_select_champion_ids.insert(ban.champion_id, true);
                    log::debug!("Champion banned by others: {}", ban.champion_id);
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
                    log::debug!("Champion picked by teammates: {}", pick.champion_id);
                }
            }
        }
    }

    let will_select_champion_id = if my_pick_champion_slice.is_empty() {
        log::warn!("No champions configured in pickChampionSlice, using default ID: 1");
        1
    } else {
        let selected = my_pick_champion_slice
            .iter()
            .find(|&&champion_id| !not_select_champion_ids.contains_key(&champion_id))
            .copied()
            .unwrap_or(1);
        if selected != 1 {
            log::info!("Will select champion ID: {}", selected);
        } else {
            log::warn!("No available champion to select, using default ID: 1");
        }
        selected
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

    log::info!(
        "Action ID: {}, Is In Progress: {}, Completed: {}, My Picked Champion ID: {}",
        action_id,
        is_in_progress,
        completed,
        my_picked_champion_id
    );

    if action_id != -1 {
        if is_in_progress && !completed {
            log::info!(
                "Completing champion selection with ID: {}",
                will_select_champion_id
            );
            patch_session_action(action_id, will_select_champion_id, "pick".to_string(), true)
                .await?;
            log::info!("Champion selection completed successfully");
        } else if my_picked_champion_id == 0 && !completed && !is_in_progress {
            log::info!("Hovering champion with ID: {}", will_select_champion_id);
            patch_session_action(
                action_id,
                will_select_champion_id,
                "pick".to_string(),
                false,
            )
            .await?;
            log::info!("Champion hover successful");
        } else {
            log::info!("No action needed for champion selection");
        }
    } else {
        log::warn!("No pick action found for current player");
    }

    Ok(())
}

/// 自动禁用英雄
async fn start_champion_ban_automation() {
    log::info!("Starting champion ban automation");
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            continue;
        }

        log::info!("In champion select phase, starting champion ban");
        if let Err(e) = start_ban_champion().await {
            log::error!("Ban champion error: {}", e);
        }
    }
}

async fn start_ban_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;
    log::info!("Current player cell ID: {}", my_cell_id);

    let my_ban_champion_slice = match get_config("settings.auto.banChampionSlice").await {
        Ok(Value::Map(m)) => {
            // Handle nested structure: { "value": [list] }
            if let Some(Value::List(list)) = m.get("value") {
                list.iter()
                    .filter_map(|v| match v {
                        Value::Integer(i) => Some(*i as i32),
                        _ => None,
                    })
                    .collect::<Vec<i32>>()
            } else {
                vec![]
            }
        }
        Ok(Value::List(list)) => {
            // Handle direct list structure (for backwards compatibility)
            list.iter()
                .filter_map(|v| match v {
                    Value::Integer(i) => Some(*i as i32),
                    _ => None,
                })
                .collect::<Vec<i32>>()
        }
        _ => vec![],
    };

    log::info!("Configured champion ban list: {:?}", my_ban_champion_slice);

    let mut not_ban_champion_ids = HashMap::new();
    let mut have_ban_id = false;

    // 检查是否已经ban了，ban了则不需要再ban
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id == my_cell_id {
                    if ban.completed {
                        log::info!("Ban already completed");
                        return Ok(());
                    }
                    have_ban_id = true;
                }
            }
        }
    }

    if !have_ban_id {
        log::info!("Ban action not found for current player");
        return Ok(());
    }

    // 获取ban的英雄
    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id != my_cell_id && ban.completed {
                    not_ban_champion_ids.insert(ban.champion_id, true);
                    log::debug!("Champion banned by others: {}", ban.champion_id);
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
                    log::debug!("Champion pre-picked by teammates: {}", pick.champion_id);
                }
            }
        }
    }

    log::info!(
        "Champions unavailable for ban: {:?}",
        not_ban_champion_ids.keys().collect::<Vec<_>>()
    );

    let will_ban_champion_id = if my_ban_champion_slice.is_empty() {
        log::warn!("No champions configured in banChampionSlice, using default ID: 1");
        1
    } else {
        let selected = my_ban_champion_slice
            .iter()
            .find(|&&champion_id| !not_ban_champion_ids.contains_key(&champion_id))
            .copied()
            .unwrap_or(1);
        if selected != 1 {
            log::info!("Will ban champion ID: {}", selected);
        } else {
            log::warn!("No available champion to ban, using default ID: 1");
        }
        selected
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

    log::info!(
        "Action ID: {}, Is In Progress: {}",
        action_id,
        is_in_progress
    );

    if action_id != -1 && is_in_progress {
        log::info!("Banning champion with ID: {}", will_ban_champion_id);
        patch_session_action(action_id, will_ban_champion_id, "ban".to_string(), true).await?;
        log::info!("Champion ban completed successfully");
    } else {
        log::info!("No action needed for champion ban");
    }

    Ok(())
}

async fn init_run_automation() {
    let manager = AUTOMATION_MANAGER.get_or_init(AutomationManager::new);
    log::info!("Initializing automation tasks");

    // 检查配置并启动对应的自动化任务
    match get_config("settings.auto.startMatchSwitch").await {
        Ok(value) => {
            log::info!("Auto-start match config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-start match is enabled, starting task");
                manager.start_task("start_match", start_match_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get startMatchSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.acceptMatchSwitch").await {
        Ok(value) => {
            log::info!("Auto-accept match config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-accept match is enabled, starting task");
                manager.start_task("accept_match", start_accept_match_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get acceptMatchSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.banChampionSwitch").await {
        Ok(value) => {
            log::info!("Auto-ban champion config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-ban champion is enabled, starting task");
                manager.start_task("ban_champion", start_champion_ban_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get banChampionSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.pickChampionSwitch").await {
        Ok(value) => {
            log::info!("Auto-pick champion config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-pick champion is enabled, starting task");
                manager.start_task("pick_champion", start_champion_select_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get pickChampionSwitch config: {}", e);
        }
    }

    log::info!("Automation tasks initialization completed");
}

pub async fn start_automation() {
    log::info!("========== Starting Automation System ==========");
    init_run_automation().await;
    log::info!("Registering configuration change callbacks");

    register_on_change_callback(|key: &str, new_value: &Value| {
        log::info!("Config changed: {} = {:?}", key, new_value);

        // 确保 manager 已经初始化
        let manager = match AUTOMATION_MANAGER.get() {
            Some(m) => m,
            None => {
                log::error!("AutomationManager not initialized when config changed!");
                return;
            }
        };

        match key {
            "settings.auto.startMatchSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling match automation");
                        manager.start_task("start_match", start_match_automation());
                    } else {
                        log::info!("Config: Disabling match automation");
                        manager.stop_task("start_match");
                    }
                } else {
                    log::warn!("Invalid value for startMatchSwitch: {:?}", new_value);
                }
            }
            "settings.auto.acceptMatchSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling accept match automation");
                        manager.start_task("accept_match", start_accept_match_automation());
                    } else {
                        log::info!("Config: Disabling accept match automation");
                        manager.stop_task("accept_match");
                    }
                } else {
                    log::warn!("Invalid value for acceptMatchSwitch: {:?}", new_value);
                }
            }
            "settings.auto.pickChampionSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling champion select automation");
                        manager.start_task("pick_champion", start_champion_select_automation());
                    } else {
                        log::info!("Config: Disabling champion select automation");
                        manager.stop_task("pick_champion");
                    }
                } else {
                    log::warn!("Invalid value for pickChampionSwitch: {:?}", new_value);
                }
            }
            "settings.auto.banChampionSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling champion ban automation");
                        manager.start_task("ban_champion", start_champion_ban_automation());
                    } else {
                        log::info!("Config: Disabling champion ban automation");
                        manager.stop_task("ban_champion");
                    }
                } else {
                    log::warn!("Invalid value for banChampionSwitch: {:?}", new_value);
                }
            }
            _ => {
                log::debug!("Config changed for unmonitored key: {}", key);
            }
        }
    });

    log::info!("========== Automation System Started ==========");
}
