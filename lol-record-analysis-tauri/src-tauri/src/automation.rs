//! 自动化功能模块
//!
//! 提供英雄联盟客户端的自动化操作功能：
//! - 自动接受匹配
//! - 自动开始寻找对局
//! - 自动选择英雄
//! - 自动禁用英雄
//!
//! # 架构
//!
//! ```text
//! AutomationManager (单例)
//!     └── HashMap<task_name, AutomationTask>
//!             └── Task (Tokio JoinHandle)
//!                     └── 自动化逻辑循环
//! ```
//!
//! # 使用示例
//!
//! ```rust,ignore
//! // 启动自动化系统
//! start_automation().await;
//!
//! // 自动化任务会根据配置文件自动启动
//! // 配置变更时会通过回调自动启停任务
//! ```

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

/// 全局自动化管理器实例
///
/// 使用 OnceLock 实现线程安全的懒加载单例模式
static AUTOMATION_MANAGER: OnceLock<AutomationManager> = OnceLock::new();

/// 单个自动化任务的句柄和状态
#[derive(Debug)]
struct AutomationTask {
    /// 任务名称（用于标识和日志）
    _name: String,
    /// Tokio 任务句柄，用于中止任务
    handle: Option<JoinHandle<()>>,
    /// 关闭信号发送端，用于优雅停止任务
    shutdown_tx: Option<watch::Sender<bool>>,
}

/// 自动化任务管理器
///
/// 负责管理所有自动化任务的生命周期，包括：
/// - 启动新任务
/// - 停止现有任务
/// - 处理配置变更
#[derive(Debug)]
struct AutomationManager {
    /// 存储所有运行中的任务
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

/// 自动接受匹配任务。
///
/// 每 100 毫秒检测一次游戏阶段，当检测到 "ReadyCheck" 阶段时自动接受匹配。
///
/// # 逻辑流程
///
/// 1. 每 100ms 轮询一次游戏阶段
/// 2. 检测到 `READYCHECK` 阶段时调用 `post_accept_match()`
/// 3. 记录错误日志但不中断任务
///
/// # 注意
///
/// 此任务会持续运行直到被显式停止或程序退出。
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

/// 自动开始匹配任务。
///
/// 当玩家处于大厅且是房主时，自动开始寻找对局。
///
/// # 逻辑流程
///
/// 1. 每秒检测一次游戏阶段
/// 2. 检测状态变化，处理匹配取消后的自动恢复逻辑
/// 3. 检查是否在大厅阶段 (`LOBBY`)
/// 4. 检查是否为自定义游戏（跳过）
/// 5. 检查当前用户是否为房主
/// 6. 调用 `Lobby::post_match_search()` 开始匹配
/// 7. 等待 6 秒避免过于频繁的请求
///
/// # 状态管理
///
/// - `auto_match_enabled`: 控制是否启用自动匹配
/// - 当从 `MATCHMAKING` 回到 `LOBBY` 时自动禁用（玩家取消了匹配）
/// - 当离开 `LOBBY` 时自动重新启用
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
            last_search_state = cur_state; // 必须更新状态！
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

/// 判断当前用户是否是房主。
///
/// # 参数
///
/// - `members`: 房间成员列表
///
/// # 返回值
///
/// - `Ok(true)`: 当前用户是房主
/// - `Ok(false)`: 当前用户不是房主
/// - `Err(String)`: 获取当前用户信息失败
///
/// # 逻辑
///
/// 1. 获取当前登录的召唤师信息
/// 2. 在成员列表中查找自己的记录
/// 3. 检查 `is_leader` 字段
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

/// 自动选择英雄任务。
///
/// 在选人阶段自动选择配置的英雄。
///
/// # 逻辑流程
///
/// 1. 每 2 秒检测一次游戏阶段
/// 2. 当进入 `CHAMPSELECT` 阶段时执行选人逻辑
/// 3. 调用 `start_select_champion()` 执行具体选人操作
///
/// # 注意
///
/// 选人逻辑包括：排除已被禁用的英雄、排除队友已选的英雄、按优先级选择
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

/// 纯函数：将 config::Value 解析为 PickRule 列表。
///
/// - 非 array 形态（空字符串占位、Null、未初始化）静默返回空，不打日志。
/// - 仅当真的是 array 但内容格式有误时才打 warn。
fn parse_pick_rules_value(value: &Value) -> Vec<crate::command::rule_config::PickRule> {
    use crate::command::rule_config::PickRule;
    let json = match serde_json::to_value(value) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("Failed to bridge pickRules config Value -> JSON: {}", e);
            return vec![];
        }
    };
    // Config wraps user-facing values as { "value": <actual> }
    let inner = json.get("value").cloned().unwrap_or(json);
    if !inner.is_array() {
        // 未配置 / 老的空字符串占位 — 不打日志，这不是错误
        return vec![];
    }
    serde_json::from_value::<Vec<PickRule>>(inner).unwrap_or_else(|e| {
        log::warn!("Failed to parse pickRules from config: {}", e);
        vec![]
    })
}

/// 纯函数：将 config::Value 解析为 BanRule 列表。
///
/// - 非 array 形态（空字符串占位、Null、未初始化）静默返回空，不打日志。
/// - 仅当真的是 array 但内容格式有误时才打 warn。
fn parse_ban_rules_value(value: &Value) -> Vec<crate::command::rule_config::BanRule> {
    use crate::command::rule_config::BanRule;
    let json = match serde_json::to_value(value) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("Failed to bridge banRules config Value -> JSON: {}", e);
            return vec![];
        }
    };
    let inner = json.get("value").cloned().unwrap_or(json);
    if !inner.is_array() {
        return vec![];
    }
    serde_json::from_value::<Vec<BanRule>>(inner).unwrap_or_else(|e| {
        log::warn!("Failed to parse banRules from config: {}", e);
        vec![]
    })
}

/// 从配置中读取 pickRules 列表。
///
/// 配置缺失时返回空向量（视为"未配置规则"，走兜底逻辑）。
async fn load_pick_rules() -> Vec<crate::command::rule_config::PickRule> {
    match get_config("settings.auto.pickRules").await {
        Ok(v) => parse_pick_rules_value(&v),
        Err(_) => vec![],
    }
}

/// 从配置中读取 banRules 列表。
///
/// 配置缺失时返回空向量（视为"未配置规则"，走兜底逻辑）。
async fn load_ban_rules() -> Vec<crate::command::rule_config::BanRule> {
    match get_config("settings.auto.banRules").await {
        Ok(v) => parse_ban_rules_value(&v),
        Err(_) => vec![],
    }
}

/// 执行规则引擎命中后的 pick 动作。
///
/// 三种处理分支：
/// 1. `is_in_progress && !completed`：按 `action.lock` 锁定或继续 hover。
///    **例外**：`lock=false` 且当前已经 hover 了目标英雄时跳过，避免每 2s 重复 PATCH。
/// 2. `my_picked_champion_id == 0 && !completed && !is_in_progress`：预选阶段始终 hover
///    （`completed=false`），忽略 `lock` 标志。
/// 3. 其他状态：no-op（已锁定 / 不轮到我等）。
async fn execute_pick_action(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
    action: &crate::command::rule_config::PickAction,
) -> Result<(), String> {
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

    if action_id == -1 {
        log::debug!("No pick action found for current player");
        return Ok(());
    }

    if is_in_progress && !completed {
        // 跳过冗余 PATCH：lock=false 且当前 hover 已是目标英雄，无需再次发送
        if !action.lock && my_picked_champion_id == action.champion_id {
            log::debug!(
                "Rule action: champion {} already hovered, skipping redundant PATCH",
                action.champion_id
            );
            return Ok(());
        }
        log::info!(
            "Rule action: {} champion {} (in_progress)",
            if action.lock { "locking" } else { "hovering" },
            action.champion_id
        );
        patch_session_action(
            action_id,
            action.champion_id,
            "pick".to_string(),
            action.lock,
        )
        .await?;
    } else if my_picked_champion_id == 0 && !completed && !is_in_progress {
        // 预选阶段 — 始终 hover，忽略 lock 标志
        log::info!(
            "Rule action: hovering champion {} (pre-select)",
            action.champion_id
        );
        patch_session_action(action_id, action.champion_id, "pick".to_string(), false).await?;
    } else {
        log::debug!("No pick action needed under current state");
    }

    Ok(())
}

/// 执行英雄选择操作。
///
/// # 返回值
///
/// - `Ok(())`: 选人操作完成（或无需操作）
/// - `Err(String)`: 操作失败
///
/// # 逻辑流程
///
/// 1. 获取选人阶段会话信息
/// 2. **规则引擎（优先）**：若配置了 pickRules，按规则求值并执行；命中则返回
/// 3. **兜底（pickChampionSlice）**：规则未配置或未命中时，走原有列表逻辑
async fn start_select_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;
    log::info!("Current player cell ID: {}", my_cell_id);

    // ===== Rule engine (new) — try first; fall back to slice on miss =====
    let rules = load_pick_rules().await;
    if !rules.is_empty() {
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to get my summoner for rule engine: {}", e);
                return start_select_champion_slice_fallback(&select_session, my_cell_id).await;
            }
        };
        let my_pos = crate::rule_engine::detect_my_position(&select_session, &my_summoner.puuid);
        if let Some(action) = crate::rule_engine::evaluate_pick(&select_session, my_pos, &rules) {
            log::info!(
                "Pick rule matched: champion={} lock={}",
                action.champion_id,
                action.lock
            );
            return execute_pick_action(&select_session, my_cell_id, action).await;
        }
        log::debug!("No pick rule matched, falling back to pickChampionSlice");
    }
    // ===== End rule engine =====

    start_select_champion_slice_fallback(&select_session, my_cell_id).await
}

/// 兜底选人逻辑（原 `start_select_champion` 函数体）。
///
/// 从 `pickChampionSlice` 配置读取英雄列表，排除已 ban/已选英雄后，
/// 选取第一个可用英雄执行 hover 或锁定。
async fn start_select_champion_slice_fallback(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
) -> Result<(), String> {
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

/// 自动禁用英雄任务。
///
/// 在选人阶段自动禁用配置的英雄。
///
/// # 逻辑流程
///
/// 1. 每 2 秒检测一次游戏阶段
/// 2. 当进入 `CHAMPSELECT` 阶段时执行禁用逻辑
/// 3. 调用 `start_ban_champion()` 执行具体禁用操作
///
/// # 注意
///
/// 禁用逻辑包括：检查是否已禁用、排除已被禁用的英雄、排除队友预选的英雄
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

/// 执行英雄禁用操作。
///
/// 优先走规则引擎：若配置了 banRules 且有规则命中，直接执行对应 ban action。
/// 否则回退到传统的 banChampionSlice 兜底逻辑。
///
/// # 返回值
///
/// - `Ok(())`: 禁用操作完成（或无需操作）
/// - `Err(String)`: 操作失败
async fn start_ban_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;
    log::info!("Current player cell ID: {}", my_cell_id);

    let rules = load_ban_rules().await;
    if !rules.is_empty() {
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to get my summoner for rule engine: {}", e);
                return start_ban_champion_slice_fallback(&select_session, my_cell_id).await;
            }
        };
        let my_pos = crate::rule_engine::detect_my_position(&select_session, &my_summoner.puuid);
        if let Some(action) = crate::rule_engine::evaluate_ban(&select_session, my_pos, &rules) {
            log::info!("Ban rule matched: champion={}", action.champion_id);
            return execute_ban_action(&select_session, my_cell_id, action).await;
        }
        log::debug!("No ban rule matched, falling back to banChampionSlice");
    }

    start_ban_champion_slice_fallback(&select_session, my_cell_id).await
}

/// 执行 ban 规则的 action。
///
/// 仅当我自己的 ban 槽 `is_in_progress=true` 且未完成时才发请求；
/// 否则视为时机不对（已完成 / 还没轮到）静默 no-op。
async fn execute_ban_action(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
    action: &crate::command::rule_config::BanAction,
) -> Result<(), String> {
    let mut action_id = -1;
    let mut is_in_progress = false;
    let mut already_completed = false;

    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id == my_cell_id {
                    if ban.completed {
                        already_completed = true;
                    }
                    if ban.is_in_progress {
                        action_id = ban.id;
                        is_in_progress = true;
                    }
                }
            }
        }
    }

    if already_completed {
        log::debug!("Ban already completed");
        return Ok(());
    }
    if action_id == -1 || !is_in_progress {
        log::debug!("No ban action in progress for current player");
        return Ok(());
    }

    log::info!("Rule action: banning champion {}", action.champion_id);
    crate::lcu::api::champion_select::patch_session_action(
        action_id,
        action.champion_id,
        "ban".to_string(),
        true,
    )
    .await?;
    Ok(())
}

/// 兜底禁用逻辑：使用配置的 banChampionSlice 列表依序选择可用英雄执行禁用。
///
/// # 逻辑流程
///
/// 1. 从配置读取预设禁用英雄列表
/// 2. 检查是否已经禁用（避免重复禁用）
/// 3. 排除已被禁用的英雄（敌方或队友禁用）
/// 4. 排除队友预选的英雄
/// 5. 从预设列表中选择第一个可用英雄
/// 6. 如果轮到我的禁用回合，执行禁用
async fn start_ban_champion_slice_fallback(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
) -> Result<(), String> {
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

/// 初始化并启动自动化任务。
///
/// 根据配置文件中的开关状态启动对应的自动化任务。
///
/// # 启动的任务
///
/// - `start_match`: 自动开始匹配（`settings.auto.startMatchSwitch`）
/// - `accept_match`: 自动接受匹配（`settings.auto.acceptMatchSwitch`）
/// - `ban_champion`: 自动禁用英雄（`settings.auto.banChampionSwitch`）
/// - `pick_champion`: 自动选择英雄（`settings.auto.pickChampionSwitch`）
///
/// # 配置格式
///
/// 配置值为布尔类型或包含 `value` 字段的映射：
/// - `Value::Boolean(true)` 或 `Map({"value": Boolean(true)})` 表示启用
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

/// 启动自动化系统。
///
/// 这是自动化模块的主入口函数，执行以下操作：
///
/// 1. 初始化自动化管理器
/// 2. 根据配置启动初始任务
/// 3. 注册配置变更回调，实现动态启停
///
/// # 配置变更处理
///
/// 当以下配置项变更时，会自动启动或停止对应任务：
/// - `settings.auto.startMatchSwitch`: 自动开始匹配
/// - `settings.auto.acceptMatchSwitch`: 自动接受匹配
/// - `settings.auto.pickChampionSwitch`: 自动选择英雄
/// - `settings.auto.banChampionSwitch`: 自动禁用英雄
///
/// # 使用示例
///
/// ```rust,ignore
/// // 在应用程序启动时调用
/// pub fn run() {
///     tauri::Builder::default()
///         .setup(|app| {
///             tauri::async_runtime::spawn(async move {
///                 start_automation().await;
///             });
///             Ok(())
///         })
///         ...
/// }
/// ```
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // 构造一条最小化的 PickRule JSON
    fn pick_rule_json(id: &str, champion_id: i32, lock: bool) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "test rule",
            "enabled": true,
            "conditions": [],
            "action": { "champion_id": champion_id, "lock": lock }
        })
    }

    // 构造一条最小化的 BanRule JSON
    fn ban_rule_json(id: &str, champion_id: i32) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "test ban rule",
            "enabled": true,
            "conditions": [],
            "action": { "champion_id": champion_id }
        })
    }

    // ──────────────────── parse_pick_rules_value ────────────────────

    #[test]
    fn parse_pick_rules_returns_empty_for_empty_string_value() {
        // 模拟 zero_value_for_key 对 "Rules" 后缀键返回的默认值
        let v = Value::String(String::new());
        assert!(parse_pick_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_pick_rules_returns_empty_for_null_value() {
        let v = Value::Null;
        assert!(parse_pick_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_pick_rules_handles_value_envelope() {
        // 前端 put_config 的形态：{ "value": [PickRule, ...] }
        let mut map = HashMap::new();
        map.insert(
            "value".to_string(),
            Value::List(vec![serde_json::from_value::<Value>(pick_rule_json(
                "r1", 99, true,
            ))
            .unwrap()]),
        );
        let v = Value::Map(map);
        let rules = parse_pick_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "r1");
        assert_eq!(rules[0].action.champion_id, 99);
        assert!(rules[0].action.lock);
    }

    #[test]
    fn parse_pick_rules_handles_bare_list() {
        // 旧版本或直接存 List 形态
        let item: Value = serde_json::from_value(pick_rule_json("r1", 1, false)).unwrap();
        let v = Value::List(vec![item]);
        let rules = parse_pick_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].action.champion_id, 1);
        assert!(!rules[0].action.lock);
    }

    // ──────────────────── parse_ban_rules_value ────────────────────

    #[test]
    fn parse_ban_rules_returns_empty_for_empty_string_value() {
        let v = Value::String(String::new());
        assert!(parse_ban_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_ban_rules_handles_bare_list() {
        let item: Value = serde_json::from_value(ban_rule_json("b1", 55)).unwrap();
        let v = Value::List(vec![item]);
        let rules = parse_ban_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "b1");
        assert_eq!(rules[0].action.champion_id, 55);
    }
}
