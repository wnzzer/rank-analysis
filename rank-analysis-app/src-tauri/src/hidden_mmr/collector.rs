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
use crate::lcu::api::eog_stats::EogStatsBlock;
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
    if n.provisional_games_remaining > 0 {
        return NotificationOutcome::Rejected("定级赛");
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

/// InProgress 刚开始时结算预统计可能还没就绪，最多重试这么多次（每次间隔 [`POLL_INTERVAL`]）。
const CAPTURE_ATTEMPTS: u32 = 10;

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
/// - `EndOfGame`：后台采集本局 LP 变化
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
        game::ENDOFGAME => {
            tokio::spawn(async move {
                if let Err(e) = collect(app).await {
                    log::warn!("隐藏分：本局采集失败: {}", e);
                }
            });
        }
        _ => {}
    }
}

/// 记录对局前快照；非排位对局清空快照。
async fn capture_before() -> Result<(), String> {
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
        set_pending(None);
        return Ok(());
    }
    let me = Summoner::get_my_summoner().await?;
    let rank = Rank::get_rank_by_puuid(&me.puuid).await?;
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

/// 结算后采集本局记录：先等通知，超时再用快照差值。
async fn collect(app: AppHandle) -> Result<(), String> {
    let pending = take_pending();
    let (puuid, game_id, queue_type) = match &pending {
        Some(p) => (p.puuid.clone(), p.game_id, p.queue_type.clone()),
        // 应用是在对局中途打开的：没有快照，只能走主路径
        None => {
            let eog = EogStatsBlock::get().await?;
            if !is_ranked_queue(&eog.queue_type) {
                return Ok(());
            }
            let me = Summoner::get_my_summoner().await?;
            (me.puuid, eog.game_id, eog.queue_type)
        }
    };
    if COLLECTING_GAME.swap(game_id, Ordering::SeqCst) == game_id {
        return Ok(());
    }

    for _ in 0..POLL_ATTEMPTS {
        if let Ok(n) = LpChangeNotification::get().await {
            match judge_notification(&n, game_id, now_ms()) {
                NotificationOutcome::Accepted(record) => return persist(&app, &puuid, record),
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
    let rank = Rank::get_rank_by_puuid(&puuid).await?;
    let after = queue_info(&rank, &queue_type).ok_or("未找到该队列段位")?;
    match snapshot_record(game_id, &queue_type, &p.before, after, now_ms()) {
        Some(record) => persist(&app, &puuid, record),
        None => {
            log::info!("隐藏分：第 {} 局快照差值无效，不计入", game_id);
            Ok(())
        }
    }
}

/// 写盘；真的新增了记录才通知前端。
fn persist(app: &AppHandle, puuid: &str, record: LpRecord) -> Result<(), String> {
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
        if let Err(e) = app.emit(UPDATED_EVENT, &queue_type) {
            log::warn!("隐藏分：发送更新事件失败: {}", e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn should_pick_queue_info_by_type() {
        let mut rank = Rank::default();
        rank.queue_map.ranked_flex_sr.tier = "GOLD".into();
        assert_eq!(queue_info(&rank, "RANKED_FLEX_SR").unwrap().tier, "GOLD");
        assert!(queue_info(&rank, "CHERRY").is_none());
    }
}
