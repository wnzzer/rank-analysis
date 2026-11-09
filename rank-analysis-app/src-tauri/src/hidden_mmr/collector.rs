//! # 隐藏分采集
//!
//! 每局排位结算后取本局 LP 加减分写入 [`super::store`]：
//!
//! 1. **主路径**：`current-lp-change-notification`，`gameId` 与本局一致才用
//! 2. **兜底**：主路径 2 分钟没等到时，用对局前（InProgress）与结算后的段位快照相减
//!
//! 剔除挂机 / 安慰分 / 定级赛 / 掉段保护等不反映隐藏分的局，规则集中在本文件的纯函数里。

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use super::axis;
use super::store::{self, LpRecord, Source};
use crate::constant::game;
use crate::lcu::api::eog_stats::{EogStatsBlock, EogSummary};
use crate::lcu::api::rank::{LpChangeNotification, QueueInfo, Rank};
use crate::lcu::api::summoner::Summoner;

/// 参与隐藏分估算的排位队列。
pub const RANKED_QUEUES: [&str; 2] = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"];

/// 是否为参与估算的排位队列。
pub fn is_ranked_queue(queue_type: &str) -> bool {
    RANKED_QUEUES.contains(&queue_type)
}

/// 从段位概览里取指定队列的段位；非排位队列返回 `None`。
pub fn queue_info<'a>(rank: &'a Rank, queue_type: &str) -> Option<&'a QueueInfo> {
    match queue_type {
        "RANKED_SOLO_5x5" => Some(&rank.queue_map.ranked_solo_5x5),
        "RANKED_FLEX_SR" => Some(&rank.queue_map.ranked_flex_sr),
        _ => None,
    }
}

/// 对一条 LP 变化通知的判定结果。
#[derive(Debug, PartialEq)]
pub enum NotificationOutcome {
    /// 是本局且有效
    Accepted(LpRecord),
    /// 是本局但不计入，附原因（用于日志）
    Rejected(&'static str),
    /// 还是上一局的通知，继续等
    NotYet,
}

/// 判定通知是否可以记为本局记录。
///
/// # 参数
/// - `n`: 刚拉到的通知
/// - `expected_game_id`: 本局 gameId
/// - `now_ms`: 记录时间（Unix 毫秒）
pub fn judge_notification(
    n: &LpChangeNotification,
    expected_game_id: i64,
    now_ms: i64,
) -> NotificationOutcome {
    if n.game_id != expected_game_id {
        return NotificationOutcome::NotYet;
    }
    if !is_ranked_queue(&n.queue_type) {
        return NotificationOutcome::Rejected("非排位队列");
    }
    if n.change_reason != "GAME_END" {
        return NotificationOutcome::Rejected("非对局结算");
    }
    if n.afk_lp_penalty_amount != 0 || n.was_afk_or_leaver {
        return NotificationOutcome::Rejected("挂机或逃跑惩罚");
    }
    if n.consolation_lp_used != 0 {
        return NotificationOutcome::Rejected("使用了安慰分");
    }
    // 定级赛：剩余场次是「结算后」的值，最后一场定级赛已经是 0，要靠 LEAGUE_SEEDED 识别
    if n.provisional_games_remaining > 0 || n.notify_reason == "LEAGUE_SEEDED" {
        return NotificationOutcome::Rejected("定级赛");
    }
    if n.notify_reason.starts_with("LEAGUE_POINTS_UPDATE_SKIPPED") {
        return NotificationOutcome::Rejected("本局未更新 LP");
    }
    if n.league_points_delta == 0 {
        return NotificationOutcome::Rejected("LP 无变化（掉段保护等）");
    }
    NotificationOutcome::Accepted(LpRecord {
        game_id: n.game_id,
        queue_type: n.queue_type.clone(),
        delta: n.league_points_delta,
        tier_after: n.tier.clone(),
        division_after: n.division.clone(),
        lp_after: n.league_points,
        timestamp: now_ms,
        source: Source::Notification,
    })
}

/// 用对局前后的段位快照算本局记录（兜底路径）。
///
/// 只有胜 + 负场数**恰好增加 1** 才算一局（秒退、掉分、连打两局都会被过滤）；
/// 定级赛、LP 无变化（掉段保护）时返回 `None`。
pub fn snapshot_record(
    game_id: i64,
    queue_type: &str,
    before: &QueueInfo,
    after: &QueueInfo,
    now_ms: i64,
) -> Option<LpRecord> {
    if before.is_provisional || after.is_provisional {
        return None;
    }
    let played = (after.wins + after.losses) - (before.wins + before.losses);
    if played != 1 {
        return None;
    }
    let from = axis::to_score(&before.tier, &before.division, before.league_points)?;
    let to = axis::to_score(&after.tier, &after.division, after.league_points)?;
    let delta = to - from;
    if delta == 0 {
        return None;
    }
    Some(LpRecord {
        game_id,
        queue_type: queue_type.to_string(),
        delta,
        tier_after: after.tier.clone(),
        division_after: after.division.clone(),
        lp_after: after.league_points,
        timestamp: now_ms,
        source: Source::Snapshot,
    })
}

/// 写入新记录后发给前端的事件名，payload 为队列类型。
pub const UPDATED_EVENT: &str = "hidden-mmr-updated";

/// 结算后轮询间隔。
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// 结算后最多轮询次数：40 × 3 秒 = 2 分钟。
const POLL_ATTEMPTS: u32 = 40;

/// InProgress 刚开始（加载界面）时结算预统计可能还没就绪，最多重试这么多次
/// （每次间隔 [`POLL_INTERVAL`]）：40 × 3 秒 = 2 分钟，覆盖较长的加载时间。
const CAPTURE_ATTEMPTS: u32 = 40;

/// 对局前快照，InProgress 时写入、EndOfGame 时取走。
struct Pending {
    puuid: String,
    game_id: i64,
    queue_type: String,
    before: QueueInfo,
}

static PENDING: LazyLock<Mutex<Option<Pending>>> = LazyLock::new(|| Mutex::new(None));

/// 正在采集的 gameId，防止同一局被重复触发采集。
static COLLECTING_GAME: AtomicI64 = AtomicI64::new(0);

/// 最近一次开始采集的时间（毫秒时间戳），用于识别「同一局的重复触发」。
static LAST_COLLECT_START_MS: AtomicI64 = AtomicI64::new(0);

/// 判定为「刚有采集在进行」的窗口：一局排位远长于此，窗口内的 Skip(None) 必是重复触发。
const DUPLICATE_TRIGGER_WINDOW_MS: i64 = 5 * 60 * 1000;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn set_pending(value: Option<Pending>) {
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = value;
}

fn take_pending() -> Option<Pending> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// 客户端阶段变化时由 `game_state_monitor` 调用。
///
/// # 参数
/// - `app`: 用于发 [`UPDATED_EVENT`]
/// - `phase`: 新阶段
///
/// # 行为
/// - `InProgress`：后台记录对局前快照
/// - `PreEndOfGame` / `EndOfGame`：后台采集本局 LP 变化（两个阶段都触发，
///   防止两次轮询间直接跳过其一而漏采；重复触发由 [`COLLECTING_GAME`] 与 store 去重）
/// - 其他阶段忽略；所有错误只打日志，不影响主流程
pub fn on_phase_change(app: AppHandle, phase: &str) {
    match phase {
        game::INPROGRESS => {
            tokio::spawn(async {
                if let Err(e) = capture_before().await {
                    log::info!("隐藏分：未记录对局前快照: {}", e);
                }
            });
        }
        game::PREENDOFGAME | game::ENDOFGAME => {
            tokio::spawn(async move {
                if let Err(e) = collect(app).await {
                    log::warn!("隐藏分：本局采集失败: {}", e);
                }
            });
        }
        _ => {}
    }
}

/// 记录对局前快照；任何失败或非排位对局都不会留下上一局的旧快照。
async fn capture_before() -> Result<(), String> {
    // 先清掉上一局可能残留的快照，避免本局采集失败后被 collect 跨局沿用
    set_pending(None);
    let mut eog = None;
    for _ in 0..CAPTURE_ATTEMPTS {
        if let Ok(block) = EogStatsBlock::get().await {
            eog = Some(block);
            break;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    let eog = eog.ok_or("结算预统计一直不可用")?;
    if !is_ranked_queue(&eog.queue_type) {
        log::info!("隐藏分：队列 {} 非排位，不记录对局前快照", eog.queue_type);
        return Ok(());
    }
    let me = Summoner::get_my_summoner().await?;
    // 快照必须读实时段位，不能走缓存
    let rank = Rank::fetch_uncached(&me.puuid).await?;
    let before = queue_info(&rank, &eog.queue_type)
        .cloned()
        .ok_or("未找到该队列段位")?;
    set_pending(Some(Pending {
        puuid: me.puuid,
        game_id: eog.game_id,
        queue_type: eog.queue_type,
        before,
    }));
    Ok(())
}

/// 本局采用哪份数据的决策结果。
enum Resolution {
    /// 用对局前快照：主路径与快照兜底都可用
    UsePending(Box<Pending>),
    /// 没有可用快照（应用在结算界面才打开、或对局前采集失败），只走主路径
    UseCurrent { game_id: i64, queue_type: String },
    /// 不采集；非排位队列时附其 queueType（用于日志），读取失败时为 `None`
    Skip(Option<String>),
}

/// 决定本局采集用哪份数据（纯函数，便于测试）。
///
/// # 参数
/// - `pending`: 取走的对局前快照
/// - `current`: 刚读到的 `(gameId, queueType)`，来自实时统计或兜底的结算摘要端点
///   （兜底值已由 [`effective_current`] 处理）；读取失败为 `None`
///
/// # 行为
/// - 快照与当前一致：用快照
/// - 快照属于别的对局：丢弃快照，按当前对局走主路径（当前非排位则跳过）
/// - 快照在、当前读取失败（端点可能已消失）：保留快照
/// - 无快照：当前是排位则只走主路径，否则跳过
fn resolve_game(pending: Option<Pending>, current: Option<(i64, String)>) -> Resolution {
    let from_current = |(game_id, queue_type): (i64, String)| {
        if is_ranked_queue(&queue_type) {
            Resolution::UseCurrent {
                game_id,
                queue_type,
            }
        } else {
            Resolution::Skip(Some(queue_type))
        }
    };
    match (pending, current) {
        (Some(p), Some(c)) if p.game_id == c.0 => Resolution::UsePending(Box::new(p)),
        (Some(p), Some(c)) => {
            log::info!(
                "隐藏分：对局前快照属于第 {} 局而非当前第 {} 局，已丢弃",
                p.game_id,
                c.0
            );
            from_current(c)
        }
        (Some(p), None) => Resolution::UsePending(Box::new(p)),
        (None, Some(c)) => from_current(c),
        (None, None) => Resolution::Skip(None),
    }
}

/// 兜底端点（`eog-stats-block`）读到的 gameId 可能是上一局，不能据此丢弃有效快照。
///
/// # 参数
/// - `pending_game_id`: 对局前快照的 gameId（无快照为 `None`）
/// - `current`: 读到的 `(gameId, queueType)`
/// - `from_fallback`: `current` 是否来自兜底端点
///
/// # 行为
/// 仅当来自兜底端点、存在快照且 gameId 不一致时，把当前局视为未知（`None`），
/// 让 [`resolve_game`] 保留快照；其余情况原样返回。
fn effective_current(
    pending_game_id: Option<i64>,
    current: Option<(i64, String)>,
    from_fallback: bool,
) -> Option<(i64, String)> {
    match (pending_game_id, &current) {
        (Some(pid), Some((gid, _))) if from_fallback && pid != *gid => None,
        _ => current,
    }
}

/// 读取当前对局的 `(gameId, queueType, 是否来自兜底端点)`。
///
/// 先试实时统计 block；结算页后期它会 404，此时改用 `eog-stats-block`（可能是上一局）。
/// 两者都失败才返回合并了两条信息的错误。
async fn fetch_current_game() -> Result<(i64, String, bool), String> {
    match EogStatsBlock::get().await {
        Ok(b) => Ok((b.game_id, b.queue_type, false)),
        Err(e1) => EogSummary::get()
            .await
            .map(|s| (s.game_id, s.queue_type, true))
            .map_err(|e2| format!("{e1}; fallback: {e2}")),
    }
}

/// 结算后采集本局记录：先等通知，超时再用快照差值。
///
/// # 行为
/// - 本局用哪份数据见 [`resolve_game`]
/// - PreEndOfGame 与 EndOfGame 都会进来：先取走快照，再用 [`COLLECTING_GAME`] 对同一局去重，
///   后到的触发者在去重处直接返回
/// - 取快照与去重之间隔着 await，并非原子：无快照的后到触发者有可能先抢到去重位，
///   此时该局丢失快照兜底（通知主路径照常运行，不会写出错误记录）
async fn collect(app: AppHandle) -> Result<(), String> {
    let pending = take_pending();
    let fetched = fetch_current_game().await;
    let (current, from_fallback) = match fetched.as_ref() {
        Ok((id, q, fb)) => (Some((*id, q.clone())), *fb),
        Err(_) => (None, false),
    };
    let current = effective_current(pending.as_ref().map(|p| p.game_id), current, from_fallback);
    let (puuid, game_id, queue_type, pending) = match resolve_game(pending, current) {
        Resolution::UsePending(p) => (p.puuid.clone(), p.game_id, p.queue_type.clone(), Some(*p)),
        Resolution::UseCurrent {
            game_id,
            queue_type,
        } => {
            let me = Summoner::get_my_summoner().await?;
            (me.puuid, game_id, queue_type, None)
        }
        Resolution::Skip(Some(queue_type)) => {
            log::info!("隐藏分：队列 {} 非排位，本局不采集", queue_type);
            return Ok(());
        }
        Resolution::Skip(None) => {
            // 触发 #1 已在采集时，EndOfGame 的触发 #2 常因结算端点已消失走到这里，属正常重复触发，
            // 不能报错（warn 会上报 Sentry）；只有近期没有任何采集启动时才是真正的首次失败。
            if COLLECTING_GAME.load(Ordering::SeqCst) != 0
                && now_ms() - LAST_COLLECT_START_MS.load(Ordering::SeqCst)
                    < DUPLICATE_TRIGGER_WINDOW_MS
            {
                log::debug!("隐藏分：本局已有采集在进行，忽略重复触发");
                return Ok(());
            }
            return Err(fetched.err().unwrap_or_else(|| "无法确定本局".to_string()));
        }
    };
    if COLLECTING_GAME.swap(game_id, Ordering::SeqCst) == game_id {
        return Ok(());
    }
    LAST_COLLECT_START_MS.store(now_ms(), Ordering::SeqCst);
    // 赛前还在定级赛：本局是定级赛（含最后一场），通知里看不出来时靠快照兜住
    if pending.as_ref().is_some_and(|p| p.before.is_provisional) {
        log::info!("隐藏分：第 {} 局不计入（定级赛）", game_id);
        return Ok(());
    }

    for _ in 0..POLL_ATTEMPTS {
        if let Ok(n) = LpChangeNotification::get().await {
            match judge_notification(&n, game_id, now_ms()) {
                NotificationOutcome::Accepted(record) => {
                    // 取证：双倍胜点等特殊结算目前只能按数值识别，记下未建模字段以便找到标记
                    log::info!(
                        "隐藏分：第 {} 局 LP {:+}，通知其余字段 {}",
                        game_id,
                        record.delta,
                        serde_json::to_string(&n.extra).unwrap_or_default()
                    );
                    return persist(&app, &puuid, record).await;
                }
                NotificationOutcome::Rejected(why) => {
                    log::info!("隐藏分：第 {} 局不计入（{}）", game_id, why);
                    return Ok(());
                }
                NotificationOutcome::NotYet => {}
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    let Some(p) = pending else {
        return Err(format!("第 {} 局等不到 LP 通知，且没有对局前快照", game_id));
    };
    // 结算后快照同样要读实时段位，缓存里可能还是赛前的旧值
    let rank = Rank::fetch_uncached(&puuid).await?;
    let after = queue_info(&rank, &queue_type).ok_or("未找到该队列段位")?;
    match snapshot_record(game_id, &queue_type, &p.before, after, now_ms()) {
        Some(record) => persist(&app, &puuid, record).await,
        None => {
            log::info!("隐藏分：第 {} 局快照差值无效，不计入", game_id);
            Ok(())
        }
    }
}

/// 写盘；真的新增了记录才失效段位缓存并通知前端。
async fn persist(app: &AppHandle, puuid: &str, record: LpRecord) -> Result<(), String> {
    let queue_type = record.queue_type.clone();
    let delta = record.delta;
    let source = record.source;
    let added = store::append(&store::default_dir(), puuid, record).map_err(|e| e.to_string())?;
    if added {
        log::info!(
            "隐藏分：记录 {} {:+} LP（来源 {:?}）",
            queue_type,
            delta,
            source
        );
        // 让前端随后的 get_hidden_mmr 以赛后段位为锚点，而不是缓存里的赛前段位
        crate::lcu::api::rank::invalidate_cache_for(puuid).await;
        if let Err(e) = app.emit(UPDATED_EVENT, &queue_type) {
            log::warn!("隐藏分：发送更新事件失败: {}", e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_reject_last_placement_and_skipped_updates() {
        let seeded = LpChangeNotification {
            notify_reason: "LEAGUE_SEEDED".into(),
            provisional_games_remaining: 0,
            ..notification()
        };
        assert_eq!(
            judge_notification(&seeded, seeded.game_id, 0),
            NotificationOutcome::Rejected("定级赛")
        );
        let skipped = LpChangeNotification {
            notify_reason: "LEAGUE_POINTS_UPDATE_SKIPPED_FULL_PARTY".into(),
            ..notification()
        };
        assert_eq!(
            judge_notification(&skipped, skipped.game_id, 0),
            NotificationOutcome::Rejected("本局未更新 LP")
        );
        let promoted = LpChangeNotification {
            notify_reason: "LEAGUE_PROMOTED".into(),
            ..notification()
        };
        assert!(matches!(
            judge_notification(&promoted, promoted.game_id, 0),
            NotificationOutcome::Accepted(_)
        ));
    }

    #[test]
    fn should_keep_unmodeled_notification_fields_for_logging() {
        let n: LpChangeNotification = serde_json::from_value(serde_json::json!({
            "gameId": 1,
            "leaguePointsDelta": 40,
            "lpMultiplier": 2
        }))
        .unwrap();
        assert_eq!(n.league_points_delta, 40);
        assert_eq!(n.extra.get("lpMultiplier"), Some(&serde_json::json!(2)));
        assert!(!n.extra.contains_key("leaguePointsDelta"));
    }

    fn notification() -> LpChangeNotification {
        LpChangeNotification {
            game_id: 301_056_769_722,
            queue_type: "RANKED_SOLO_5x5".to_string(),
            league_points_delta: 19,
            tier: "EMERALD".to_string(),
            division: "III".to_string(),
            league_points: 5,
            change_reason: "GAME_END".to_string(),
            ..Default::default()
        }
    }

    fn queue(tier: &str, division: &str, lp: i32, wins: i32, losses: i32) -> QueueInfo {
        QueueInfo {
            queue_type: "RANKED_SOLO_5x5".to_string(),
            tier: tier.to_string(),
            division: division.to_string(),
            league_points: lp,
            wins,
            losses,
            ..Default::default()
        }
    }

    #[test]
    fn should_accept_matching_game_end_notification() {
        let NotificationOutcome::Accepted(r) =
            judge_notification(&notification(), 301_056_769_722, 42)
        else {
            panic!("expected accepted");
        };
        assert_eq!(r.delta, 19);
        assert_eq!(r.tier_after, "EMERALD");
        assert_eq!(r.lp_after, 5);
        assert_eq!(r.timestamp, 42);
        assert_eq!(r.source, Source::Notification);
    }

    #[test]
    fn should_wait_when_notification_is_from_previous_game() {
        assert_eq!(
            judge_notification(&notification(), 999, 0),
            NotificationOutcome::NotYet
        );
    }

    #[test]
    fn should_reject_abnormal_games() {
        let cases: Vec<LpChangeNotification> = vec![
            LpChangeNotification {
                queue_type: "CHERRY".into(),
                ..notification()
            },
            LpChangeNotification {
                change_reason: "DECAY".into(),
                ..notification()
            },
            LpChangeNotification {
                afk_lp_penalty_amount: 5,
                ..notification()
            },
            LpChangeNotification {
                was_afk_or_leaver: true,
                ..notification()
            },
            LpChangeNotification {
                consolation_lp_used: 4,
                ..notification()
            },
            LpChangeNotification {
                provisional_games_remaining: 2,
                ..notification()
            },
            LpChangeNotification {
                league_points_delta: 0,
                ..notification()
            },
        ];
        for n in cases {
            assert!(
                matches!(
                    judge_notification(&n, n.game_id, 0),
                    NotificationOutcome::Rejected(_)
                ),
                "{n:?}"
            );
        }
    }

    #[test]
    fn should_diff_snapshot_across_division_boundary() {
        let before = queue("EMERALD", "IV", 90, 258, 258);
        let after = queue("EMERALD", "III", 5, 259, 258);
        let r = snapshot_record(1, "RANKED_SOLO_5x5", &before, &after, 7).unwrap();
        assert_eq!(r.delta, 15);
        assert_eq!(r.division_after, "III");
        assert_eq!(r.source, Source::Snapshot);
    }

    #[test]
    fn should_diff_snapshot_on_demotion() {
        let before = queue("DIAMOND", "IV", 0, 10, 10);
        let after = queue("EMERALD", "I", 82, 10, 11);
        assert_eq!(
            snapshot_record(1, "RANKED_SOLO_5x5", &before, &after, 0)
                .unwrap()
                .delta,
            -18
        );
    }

    #[test]
    fn should_drop_snapshot_unless_exactly_one_game_played() {
        let before = queue("GOLD", "II", 50, 10, 10);
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "II", 30, 10, 10),
            0
        )
        .is_none());
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "II", 90, 12, 10),
            0
        )
        .is_none());
    }

    #[test]
    fn should_drop_snapshot_for_shield_or_placement() {
        let before = queue("GOLD", "IV", 0, 10, 10);
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &before,
            &queue("GOLD", "IV", 0, 10, 11),
            0
        )
        .is_none());
        let placement = QueueInfo {
            is_provisional: true,
            ..queue("GOLD", "IV", 0, 1, 0)
        };
        assert!(snapshot_record(
            1,
            "RANKED_SOLO_5x5",
            &placement,
            &queue("GOLD", "IV", 20, 2, 0),
            0
        )
        .is_none());
    }

    fn pending(game_id: i64) -> Pending {
        Pending {
            puuid: "p".into(),
            game_id,
            queue_type: "RANKED_SOLO_5x5".into(),
            before: queue("GOLD", "II", 50, 10, 10),
        }
    }

    fn cur(game_id: i64, queue_type: &str) -> Option<(i64, String)> {
        Some((game_id, queue_type.to_string()))
    }

    #[test]
    fn should_use_pending_when_current_matches() {
        let r = resolve_game(Some(pending(1)), cur(1, "RANKED_SOLO_5x5"));
        assert!(matches!(r, Resolution::UsePending(p) if p.game_id == 1));
    }

    #[test]
    fn should_discard_pending_and_use_current_when_game_differs() {
        let r = resolve_game(Some(pending(1)), cur(2, "RANKED_FLEX_SR"));
        assert!(matches!(
            r,
            Resolution::UseCurrent { game_id: 2, ref queue_type } if queue_type == "RANKED_FLEX_SR"
        ));
    }

    #[test]
    fn should_skip_when_pending_differs_and_current_is_not_ranked() {
        let r = resolve_game(Some(pending(1)), cur(2, "ARAM"));
        assert!(matches!(r, Resolution::Skip(Some(ref q)) if q == "ARAM"));
    }

    #[test]
    fn should_keep_pending_when_fallback_game_differs() {
        let current = effective_current(Some(2), cur(1, "RANKED_SOLO_5x5"), true);
        assert!(current.is_none());
        let r = resolve_game(Some(pending(2)), current);
        assert!(matches!(r, Resolution::UsePending(p) if p.game_id == 2));
    }

    #[test]
    fn should_use_pending_when_fallback_game_matches() {
        let current = effective_current(Some(2), cur(2, "RANKED_SOLO_5x5"), true);
        let r = resolve_game(Some(pending(2)), current);
        assert!(matches!(r, Resolution::UsePending(p) if p.game_id == 2));
    }

    #[test]
    fn should_still_discard_pending_when_primary_game_differs() {
        let current = effective_current(Some(1), cur(2, "RANKED_SOLO_5x5"), false);
        let r = resolve_game(Some(pending(1)), current);
        assert!(matches!(r, Resolution::UseCurrent { game_id: 2, .. }));
    }

    #[test]
    fn should_keep_fallback_current_when_no_pending() {
        let current = effective_current(None, cur(1, "RANKED_SOLO_5x5"), true);
        assert!(matches!(
            resolve_game(None, current),
            Resolution::UseCurrent { game_id: 1, .. }
        ));
    }

    #[test]
    fn should_keep_pending_when_current_fetch_failed() {
        let r = resolve_game(Some(pending(1)), None);
        assert!(matches!(r, Resolution::UsePending(p) if p.game_id == 1));
    }

    #[test]
    fn should_use_main_path_only_when_no_pending_and_ranked() {
        let r = resolve_game(None, cur(3, "RANKED_SOLO_5x5"));
        assert!(matches!(r, Resolution::UseCurrent { game_id: 3, .. }));
    }

    #[test]
    fn should_skip_when_no_pending_and_not_ranked_or_unknown() {
        assert!(matches!(
            resolve_game(None, cur(3, "CHERRY")),
            Resolution::Skip(Some(ref q)) if q == "CHERRY"
        ));
        assert!(matches!(resolve_game(None, None), Resolution::Skip(None)));
    }

    #[test]
    fn should_pick_queue_info_by_type() {
        let mut rank = Rank::default();
        rank.queue_map.ranked_flex_sr.tier = "GOLD".into();
        assert_eq!(queue_info(&rank, "RANKED_FLEX_SR").unwrap().tier, "GOLD");
        assert!(queue_info(&rank, "CHERRY").is_none());
    }
}
