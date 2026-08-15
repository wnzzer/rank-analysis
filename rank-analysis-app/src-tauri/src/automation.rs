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
use tokio::time::{interval, MissedTickBehavior};

use crate::config::{extract_bool, get_config, register_on_change_callback, Value};
use crate::constant::game::{CHAMPSELECT, LOBBY, MATCHMAKING, READYCHECK};
use crate::lcu::api::champion_select::{
    get_champion_select_session, get_fresh_champion_select_session, post_accept_match,
};
use crate::lcu::api::lobby::Lobby;
use crate::lcu::api::phase::get_phase;
use crate::opgg::data::OpggSnapshot;

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
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

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
    // 迟到的 tick 只该丢弃，不该重放：tokio 默认的 MissedTickBehavior::Burst 会在
    // 运行时被阻塞后把攒下的 tick 一次性补发。真机 2026-08-15 实测，自动 BP 因此在
    // ~1 秒内连发 8 次 PATCH（tick 空档 6.2s 后以 ~18ms 间隔爆发）。
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
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
/// 1. 每 1 秒检测一次游戏阶段，进入 `execute_at_secs_left` 阈值后持续尝试锁定
/// 2. 当进入 `CHAMPSELECT` 阶段时执行选人逻辑
/// 3. 调用 `start_select_champion()` 执行具体选人操作
///
/// # 注意
///
/// 选人逻辑包括：排除已被禁用的英雄、排除队友已选的英雄、按优先级选择
async fn start_champion_select_automation() {
    log::info!("Starting champion select automation");
    let mut ticker = interval(Duration::from_secs(1));
    // 迟到的 tick 只该丢弃，不该重放：tokio 默认的 MissedTickBehavior::Burst 会在
    // 运行时被阻塞后把攒下的 tick 一次性补发。真机 2026-08-15 实测，自动 BP 因此在
    // ~1 秒内连发 8 次 PATCH（tick 空档 6.2s 后以 ~18ms 间隔爆发）。
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

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

/// 执行英雄选择操作。
///
/// # 返回值
///
/// - `Ok(())`: 选人操作完成（或无需操作）
/// - `Err(String)`: 操作失败
///
/// # 逻辑流程
///
/// 1. 读取由常驻任务算好的决策快照（规则求值 + 兜底避雷都在那边完成）
/// 2. 快照的动作类型与本任务不符则跳过
/// 3. 交给 `apply_bp_decision`：hover 同步 → 到点锁定
async fn start_select_champion() -> Result<(), String> {
    let Some(decision) = crate::bp_decision::store::read_pick() else {
        log::debug!("No BP pick decision snapshot yet, skipping this tick");
        return Ok(());
    };
    let select_session = get_fresh_champion_select_session().await?;
    apply_bp_decision(&select_session, &decision).await
}

/// 自动禁用英雄任务。
///
/// 在选人阶段自动禁用配置的英雄。
///
/// # 逻辑流程
///
/// 1. 每 1 秒检测一次游戏阶段，进入 `execute_at_secs_left` 阈值后持续尝试锁定
/// 2. 当进入 `CHAMPSELECT` 阶段时执行禁用逻辑
/// 3. 调用 `start_ban_champion()` 执行具体禁用操作
///
/// # 注意
///
/// 禁用逻辑包括：检查是否已禁用、排除已被禁用的英雄、排除队友预选的英雄
async fn start_champion_ban_automation() {
    log::info!("Starting champion ban automation");
    let mut ticker = interval(Duration::from_secs(1));
    // 迟到的 tick 只该丢弃，不该重放：tokio 默认的 MissedTickBehavior::Burst 会在
    // 运行时被阻塞后把攒下的 tick 一次性补发。真机 2026-08-15 实测，自动 BP 因此在
    // ~1 秒内连发 8 次 PATCH（tick 空档 6.2s 后以 ~18ms 间隔爆发）。
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

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

/// 默认执行阈值：剩余降到该秒数时执行锁定。
const DEFAULT_EXECUTE_AT_SECS_LEFT: f64 = 5.0;

/// 根据分路信息推断该用哪份 OP.GG 数据。
///
/// 有分路 = 排位/征召 → ranked；无分路（ARAM、部分匹配）→ aram。
/// aram 快照的 `counters` 恒为空，因此避雷择选会自动退化为「第一个可用」，
/// 这正是这些模式下应有的行为。比额外发一次 LCU 请求取 queueId 更省。
fn opgg_mode_for(my_position: Option<crate::command::rule_config::Position>) -> &'static str {
    if my_position.is_some() {
        "ranked"
    } else {
        "aram"
    }
}

/// 从配置读取一个英雄 ID 列表，兼容 `{ "value": [...] }` 与裸数组两种历史形态。
async fn load_champion_pool(key: &str) -> Vec<i32> {
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

async fn load_pick_pool() -> Vec<i32> {
    load_champion_pool("settings.auto.pickChampionSlice").await
}

async fn load_ban_pool() -> Vec<i32> {
    load_champion_pool("settings.auto.banChampionSlice").await
}

/// BP 决策快照的常驻求值任务。
///
/// **无条件启动**，不受 `pickChampionSwitch` / `banChampionSwitch` 控制——
/// 大部分用户未开自动 BP，若决策带只对开启者可见，功能覆盖面会很窄。
/// 开关状态只决定快照里的 `mode`（Auto = 到点会执行，Advisory = 只供展示）。
///
/// 本任务**只求值、只写快照，不执行任何 LCU 写操作**。
async fn start_bp_decision_automation(app: tauri::AppHandle) {
    use crate::bp_decision::{evaluate, store, types::BpMode};
    use tauri::Manager;

    log::info!("Starting BP decision evaluation (always-on)");
    let mut ticker = interval(Duration::from_secs(2));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    // OP.GG 快照跨 tick 复用：选人期内只取一次（按模式），失败也只试一次——
    // 失败重试交给下一局（离开选人期时清空），避免 2s 热循环里对不可达的
    // op.gg 反复发起 HTTP 与刷屏 warn
    let mut opgg_cache: Option<(String, Option<Arc<OpggSnapshot>>)> = None;

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(p) => p,
            Err(_) => continue,
        };
        if cur_phase != CHAMPSELECT {
            // 离开选人期：清空快照与跨 tick 状态
            store::reset();
            opgg_cache = None;
            continue;
        }

        let session = match get_champion_select_session().await {
            Ok(s) => s,
            Err(e) => {
                // 有意保留上一帧快照，不清空：避免 2s 轮询撞上 LCU 瞬时错误时
                // 决策带闪烁。真实上限由离开选人期的 reset 兜底。
                log::debug!("BP decision: no champ select session: {}", e);
                continue;
            }
        };
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                // 同上：保留上一帧快照，不因一次瞬时错误清空展示
                log::debug!("BP decision: cannot resolve my summoner: {}", e);
                continue;
            }
        };

        let my_position = crate::rule_engine::detect_my_position(&session, &my_summoner.puuid);
        let opgg_mode = opgg_mode_for(my_position);
        let snapshot = match &opgg_cache {
            Some((cached_mode, cached_snapshot)) if cached_mode == opgg_mode => {
                cached_snapshot.clone()
            }
            _ => {
                let snap = crate::command::opgg::ensure_opgg_snapshot(
                    &app.state::<crate::state::AppState>(),
                    opgg_mode,
                )
                .await
                .ok()
                .map(|(snap, _stale)| snap);
                opgg_cache = Some((opgg_mode.to_string(), snap.clone()));
                snap
            }
        };

        let pick_rules = load_pick_rules().await;
        let ban_rules = load_ban_rules().await;
        let pick_pool = load_pick_pool().await;
        let ban_pool = load_ban_pool().await;

        let pick_on = switch_enabled("settings.auto.pickChampionSwitch").await;
        let ban_on = switch_enabled("settings.auto.banChampionSwitch").await;

        use crate::bp_decision::types::BpActionType;

        // ban 与 pick 各求一次值：两条执行轨道各读各的，pick 的 hover 才能在 ban
        // 阶段就开始（真机现象「预选期不预选」的根因是两者共用了「当前那一个」动作）。
        let last_hovered = store::last_hovered();
        let eval_for = |action_type: BpActionType, auto_on: bool| {
            let pending = evaluate::find_my_pending_action_of_type(&session, action_type)?;
            let ctx = evaluate::BpContext {
                session: &session,
                my_puuid: &my_summoner.puuid,
                pick_rules: &pick_rules,
                ban_rules: &ban_rules,
                pick_pool: &pick_pool,
                ban_pool: &ban_pool,
                snapshot: snapshot.as_deref(),
                mode: if auto_on {
                    BpMode::Auto
                } else {
                    BpMode::Advisory
                },
                execute_at_secs_left: DEFAULT_EXECUTE_AT_SECS_LEFT,
                last_hovered,
            };
            let mut d = evaluate::evaluate_for_action(&ctx, pending)?;
            // 接管标记以执行侧的粘性记录为准：一旦判定接管，即使用户随后撤回 hover
            // (detect_override 重算为 false)，本阶段也不会再自动执行——快照必须如实
            // 反映，否则决策带会承诺一次永远不会发生的自动锁定
            d.user_overridden = d.user_overridden || store::is_overridden(pending.action_id);
            Some((pending.action_id, d))
        };
        let ban_decision = eval_for(BpActionType::Ban, ban_on);
        let pick_decision = eval_for(BpActionType::Pick, pick_on);

        // 展示用的「当前」决策：复用已算好的两份，按 find_my_pending_action 的
        // 口径挑一份，避免第三次求值。
        let current = evaluate::find_my_pending_action(&session).and_then(|p| {
            [ban_decision.as_ref(), pick_decision.as_ref()]
                .into_iter()
                .flatten()
                .find(|(id, _)| *id == p.action_id)
                .map(|(_, d)| d.clone())
        });
        store::write(
            current,
            ban_decision.map(|(_, d)| d),
            pick_decision.map(|(_, d)| d),
        );
    }
}

/// ban 阶段能否 hover 尚未在真机验证——`BanAction` 类型里从来没有 `lock` 字段，
/// 说明这条语义在本项目里从未被表达过。先关闭 ban 的 hover 同步，
/// 只保留阈值执行；真机验证方法：把本常量临时置 true，进 ban 阶段观察
/// `patch_session_action(completed=false)` 是否成功，且客户端上确实能看到
/// ban 意向被 hover 出来——成功则保留 true。
const BAN_HOVER_ENABLED: bool = false;

/// 是否应当对该决策采取任何 LCU 写操作。
fn should_act(d: &crate::bp_decision::types::BpDecision) -> bool {
    d.mode == crate::bp_decision::types::BpMode::Auto && !d.user_overridden
}

/// 是否到了锁定的时刻。
///
/// 触发条件是 `adjusted_time_left_in_phase <= execute_at_secs_left`，
/// **不是**「预告后倒数 N 秒」——固定秒数在不同队列时长下会一会儿太早一会儿来不及。
///
/// `time_left_secs` 必须由调用方用**实时** timer 算出（见 [`apply_bp_decision`]）——
/// 快照里的 `d.time_left_secs` 是求值 tick 那一刻的值，不能用于执行判断。
fn should_lock(
    d: &crate::bp_decision::types::BpDecision,
    time_left_secs: f64,
    is_in_progress: bool,
    timer_phase: &str,
) -> bool {
    let Some(t) = d.target.as_ref() else {
        return false;
    };
    // 阶段门不可省：PLANNING 的独立计时器同样会走进 (0, execute_at] 窗口，而那时
    // 提交会被 LCU 静默无视（真机 2026-08-15 实测）。详见 evaluate::is_actionable_phase。
    crate::bp_decision::evaluate::is_actionable_phase(timer_phase)
        && is_in_progress
        && t.lock
        && time_left_secs > 0.0
        && time_left_secs <= d.execute_at_secs_left
}

/// 按决策快照同步 hover 并在到点时锁定。
///
/// 每 tick 重算并立即同步 hover，使「当前 hover」恒等于「当前决策」——
/// 执行时锁的就是用户正看着的那个。局面变化（建议英雄被抢/被 ban）表现为
/// hover 撤回并重新 hover，**可见地换人，绝不静默换人**。
async fn apply_bp_decision(
    session: &crate::lcu::api::champion_select::SelectSession,
    decision: &crate::bp_decision::types::BpDecision,
) -> Result<(), String> {
    use crate::bp_decision::{evaluate, store, types::BpActionType};

    // 按决策自身的类型定位我的动作,而不是「当前那一个」——ban 与 pick 是两条独立
    // 轨道,pick 的 hover 要在选人期一开始就做,不能因为 ban 尚未完成而空转。
    let Some(pending) = evaluate::find_my_pending_action_of_type(session, decision.action_type)
    else {
        return Ok(());
    };

    // 接管检测用实时数据:用户在快照生成后的 2s 窗口内抢过方向盘也要立即退让。
    // 快照里的 user_overridden 是 2s 前算的,只用于展示与本 tick 的保守短路,
    // 不用它做持久化标记(它可能因读取时序出现一帧误报,持久化会造成永久退让)。
    if evaluate::detect_override(pending.champion_id, store::last_hovered()) {
        store::mark_overridden(pending.action_id);
    }
    if store::is_overridden(pending.action_id) || !should_act(decision) {
        return Ok(());
    }

    let Some(target) = decision.target.as_ref() else {
        return Ok(());
    };
    let action_type = match pending.action_type {
        BpActionType::Ban => "ban",
        BpActionType::Pick => "pick",
    };

    // ---- hover 同步 ----
    let hover_allowed = pending.action_type == BpActionType::Pick || BAN_HOVER_ENABLED;
    if hover_allowed && pending.champion_id != target.champion_id {
        log::info!(
            "BP hover sync: {} -> {}",
            pending.champion_id,
            target.champion_id
        );
        match crate::lcu::api::champion_select::patch_session_action(
            pending.action_id,
            target.champion_id,
            action_type.to_string(),
            false,
        )
        .await
        {
            Ok(()) => store::set_last_hovered(Some(target.champion_id)),
            // hover 是「同步展示」，失败不该否决后续的到点执行
            Err(e) => log::warn!("BP hover sync failed (continuing to lock check): {}", e),
        }
    }

    // ---- 到点执行 ----
    // 时间判断用绕过缓存的实时 timer，而非快照的 time_left_secs。进入阈值后
    // 每 tick 都会尝试，避免轮询调度或 LCU 抖动跨过一个狭窄窗口后永久放弃。
    let timer = &session.timer;
    // real_time_left: 本 tick 实际参与到点判断的剩余秒数,None = 无计时器模式。
    // 只为下面的执行日志保留——那行日志是真机核对毫秒假设的唯一证据源,必须打真值。
    let actionable = crate::bp_decision::evaluate::is_actionable_phase(&timer.phase);
    let (lock_now, real_time_left): (bool, Option<f64>) = if timer.is_infinite {
        // 无计时器模式(自定义房间等):退回「轮到我就执行」,与旧实现行为一致
        (actionable && pending.is_in_progress && target.lock, None)
    } else {
        let time_left = crate::bp_decision::evaluate::phase_secs_left(timer);
        if time_left <= 0.0 {
            // timer 字段缺失(serde default 全 0)或已归零:宁可不动手,但要留下现场;
            // 只在真轮到我、且处于可提交阶段时才打 warn——否则 PLANNING 阶段
            // 归零、或一个坏 timer 的会话,会在压根还没轮到动手时每 tick 刷屏
            if actionable && pending.is_in_progress {
                log::warn!(
                    "BP timer unusable (time_left={:.1}), skip auto lock",
                    time_left
                );
            }
            (false, Some(time_left))
        } else {
            (
                should_lock(decision, time_left, pending.is_in_progress, &timer.phase),
                Some(time_left),
            )
        }
    };
    if lock_now {
        log::info!(
            "BP execute: {} {} at {}",
            action_type,
            target.champion_id,
            real_time_left
                .map(|t| format!("{:.1}s left", t))
                .unwrap_or_else(|| "infinite timer".to_string())
        );
        crate::lcu::api::champion_select::patch_session_action(
            pending.action_id,
            target.champion_id,
            action_type.to_string(),
            true,
        )
        .await?;
    }
    Ok(())
}

/// 读取一个布尔开关配置，缺失/异常一律当作关闭。
async fn switch_enabled(key: &str) -> bool {
    matches!(
        get_config(key).await.map(|v| extract_bool(&v)),
        Ok(Some(true))
    )
}

/// 执行英雄禁用操作。
///
/// # 返回值
///
/// - `Ok(())`: 禁用操作完成（或无需操作）
/// - `Err(String)`: 操作失败
///
/// # 逻辑流程
///
/// 1. 读取由常驻任务算好的决策快照（规则求值 + 兜底避雷都在那边完成）
/// 2. 快照的动作类型与本任务不符则跳过
/// 3. 交给 `apply_bp_decision`：hover 同步 → 到点锁定
async fn start_ban_champion() -> Result<(), String> {
    let Some(decision) = crate::bp_decision::store::read_ban() else {
        log::debug!("No BP ban decision snapshot yet, skipping this tick");
        return Ok(());
    };
    let select_session = get_fresh_champion_select_session().await?;
    apply_bp_decision(&select_session, &decision).await
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
async fn init_run_automation(app: tauri::AppHandle) {
    let manager = AUTOMATION_MANAGER.get_or_init(AutomationManager::new);
    log::info!("Initializing automation tasks");

    // 决策快照求值：无条件常驻，未开自动化的用户也能看到建议带
    manager.start_task("bp_decision", start_bp_decision_automation(app.clone()));

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
///                 start_automation(app.handle().clone()).await;
///             });
///             Ok(())
///         })
///         ...
/// }
/// ```
pub async fn start_automation(app: tauri::AppHandle) {
    log::info!("========== Starting Automation System ==========");
    init_run_automation(app).await;
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

#[cfg(test)]
mod bp_execution_tests {
    use super::*;
    use crate::bp_decision::types::{BpActionType, BpDecision, BpMode, BpOrigin, BpTarget};

    fn decision(mode: BpMode, time_left: f64, overridden: bool) -> BpDecision {
        BpDecision {
            action_type: BpActionType::Pick,
            target: Some(BpTarget {
                champion_id: 64,
                lock: true,
                origin: BpOrigin::Fallback { pool_size: 1 },
                evidence: None,
            }),
            rejected: vec![],
            mode,
            time_left_secs: time_left,
            execute_at_secs_left: 5.0,
            user_overridden: overridden,
            // 执行路径不读快照的该字段（用实时 session 的 pending.is_in_progress），
            // 这里给 true 只为构造合法快照。
            is_in_progress: true,
        }
    }

    /// 绝大多数用例只关心时间/回合维度，阶段固定为可提交的 BAN_PICK；
    /// 阶段维度本身由 `should_not_lock_outside_ban_pick_phase` 单独覆盖。
    fn lock_in_ban_pick(
        d: &crate::bp_decision::types::BpDecision,
        time_left: f64,
        is_in_progress: bool,
    ) -> bool {
        should_lock(d, time_left, is_in_progress, "BAN_PICK")
    }

    #[test]
    fn should_lock_after_reaching_threshold() {
        // 还早 → 不锁
        assert!(!lock_in_ban_pick(
            &decision(BpMode::Auto, 20.0, false),
            20.0,
            true
        ));
        // 到点 → 锁
        assert!(lock_in_ban_pick(
            &decision(BpMode::Auto, 5.0, false),
            5.0,
            true
        ));
        assert!(lock_in_ban_pick(
            &decision(BpMode::Auto, 3.5, false),
            3.5,
            true
        ));
        // 即使一次采样从 5s 以上跳到 3s 以下，也仍应执行
        assert!(lock_in_ban_pick(
            &decision(BpMode::Auto, 2.9, false),
            2.9,
            true
        ));
        // 已归零 → 不再发送无效请求
        assert!(!lock_in_ban_pick(
            &decision(BpMode::Auto, 0.0, false),
            0.0,
            true
        ));
        // 没轮到我 → 不锁
        assert!(!lock_in_ban_pick(
            &decision(BpMode::Auto, 4.0, false),
            4.0,
            false
        ));
    }

    /// 真机回归（2026-08-15）：LCU 在 PLANNING 期间就把 ban action 标成
    /// is_in_progress，而 PLANNING 有自己的 12 秒计时器，同样会走进执行窗口。
    /// 当时因此发出了一次被 LCU 静默无视的 ban，20 秒后 BAN_PICK 才真正成功。
    #[test]
    fn should_not_lock_outside_ban_pick_phase() {
        let d = decision(BpMode::Auto, 4.0, false);
        assert!(
            !should_lock(&d, 4.0, true, "PLANNING"),
            "PLANNING 的独立倒计时进了窗口也不能提交"
        );
        assert!(!should_lock(&d, 4.0, true, "FINALIZATION"));
        assert!(should_lock(&d, 4.0, true, "BAN_PICK"));
        // 字段缺失 → 不阻拦，退回加入阶段门之前的行为
        assert!(should_lock(&d, 4.0, true, ""));
    }

    // 钉死 should_lock 的实时语义:传参才是决策依据,快照里的 time_left_secs
    // 只是求值 tick 那一刻的展示值——防止未来回退成读快照字段而测试不红。
    // 拆成两个独立测试函数（而非一个函数里塞两个断言），保证任一路径回归时
    // 都能各自独立地在测试报告里标红定位。

    #[test]
    fn should_lock_when_real_time_param_is_within_window_even_if_snapshot_is_stale_and_early() {
        // 快照写 20s(早),但实时传参 4.0s(到点)→ 应锁
        assert!(lock_in_ban_pick(
            &decision(BpMode::Auto, 20.0, false),
            4.0,
            true
        ));
    }

    #[test]
    fn should_not_lock_when_real_time_param_is_early_even_if_snapshot_is_stale_and_at_threshold() {
        // 快照写 4s(到点),但实时传参 20.0s(还早)→ 不应锁
        assert!(!lock_in_ban_pick(
            &decision(BpMode::Auto, 4.0, false),
            20.0,
            true
        ));
    }

    #[test]
    fn should_not_act_in_advisory_or_after_override() {
        assert!(!should_act(&decision(BpMode::Advisory, 4.0, false)));
        assert!(!should_act(&decision(BpMode::Auto, 4.0, true)));
        assert!(should_act(&decision(BpMode::Auto, 4.0, false)));
    }

    #[test]
    fn should_not_lock_when_rule_says_hover_only() {
        let mut d = decision(BpMode::Auto, 4.0, false);
        d.target.as_mut().unwrap().lock = false;
        assert!(
            !lock_in_ban_pick(&d, 4.0, true),
            "lock=false 的规则只 hover，不自动确定"
        );
    }
}
