//! # 决策对账 ledger（backtest/store）
//!
//! 跨局记录「赛前建议 → 是否采纳 → 赛后结果」（ADR-6），**采纳与未采纳
//! 都要记**，防幸存者偏差——不能只记采纳后赢的局。
//!
//! 关联键（路线图 v1.3 §6.5.5）：`game_id + suggested_at_ms + 英雄`——M2 数据
//! 飞轮的前提；缺键的对局不写 ledger。
//!
//! 数据落点：`backtest.db`（与 `meet.db` 同目录，见 `paths`）；schema v2 落地
//! 前保持独立库，避免动既有库的连接句柄。库损坏静默降级（打 warn），
//! 不阻断回测主流程。

use crate::paths::{data_file, ensure_parent_dir};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

/// 库文件相对配置目录的文件名。
const DB_FILE_NAME: &str = "backtest.db";

/// 全局连接句柄：懒打开，失败后置 None 静默降级。
static CONN: LazyLock<Mutex<Option<Connection>>> = LazyLock::new(|| {
    Mutex::new(
        open_db()
            .map_err(|e| log::warn!("backtest.db 打开失败，决策对账停用: {e}"))
            .ok(),
    )
});

/// 打开（必要时创建）库文件并建表。
fn open_db() -> rusqlite::Result<Connection> {
    let path = data_file(DB_FILE_NAME);
    let _ = ensure_parent_dir(&path);
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// 建表（独立成函数让测试用内存连接复用同一份 DDL）。
fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA busy_timeout=3000;
         CREATE TABLE IF NOT EXISTS decision_ledger (
             game_id                INTEGER NOT NULL,
             suggested_at_ms        INTEGER NOT NULL,
             suggestion_champion_id INTEGER NOT NULL,
             actual_champion_id     INTEGER NOT NULL,
             enemy_champion_id      INTEGER NOT NULL,
             position               TEXT    NOT NULL,
             adopted                INTEGER NOT NULL,
             result_win             INTEGER NOT NULL,
             matchup_delta          REAL    NOT NULL,
             confidence             REAL    NOT NULL,
             caveats_json           TEXT    NOT NULL,
             PRIMARY KEY (game_id, suggestion_champion_id, suggested_at_ms)
         );
         CREATE INDEX IF NOT EXISTS idx_ledger_adopted
             ON decision_ledger(adopted, result_win);
         -- 赛前建议缓存（M2 数据飞轮）：选人期出 Pick 建议即写一条，
         -- 赛后对账按时间窗消费并回填 game_id。未对账的可重复建议（同英雄）
         -- 以首次时间为准，幂等去重。
         CREATE TABLE IF NOT EXISTS pending_suggestions (
             suggested_at_ms        INTEGER NOT NULL,
             suggestion_champion_id INTEGER NOT NULL,
             position               TEXT    NOT NULL,
             enemy_champion_id      INTEGER,
             game_id                INTEGER,
             reconciled_at_ms       INTEGER,
             PRIMARY KEY (suggested_at_ms, suggestion_champion_id)
         );
         CREATE INDEX IF NOT EXISTS idx_pending_unreconciled
             ON pending_suggestions(reconciled_at_ms, suggested_at_ms);
         -- 本地对位样本（主链，ADR-6）：从收集的对局派生，
         -- 按 game_id 去重增量 upsert，回测直接查表。
         CREATE TABLE IF NOT EXISTS local_samples (
             game_id           INTEGER NOT NULL,
             champion_id       INTEGER NOT NULL,
             position          TEXT    NOT NULL,
             enemy_champion_id INTEGER NOT NULL,
             win               INTEGER NOT NULL,
             score             REAL    NOT NULL,
             PRIMARY KEY (game_id, champion_id)
         );
         CREATE INDEX IF NOT EXISTS idx_samples_champ
             ON local_samples(champion_id, position);",
    )
}

/// 持锁执行一次库操作；连接未就绪/出错时返回 None（调用方降级处理）。
fn with_db<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(conn) => match f(conn) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("backtest.db 操作失败: {e}");
                None
            }
        },
        None => None,
    }
}

/// 一条对账记录（关联键 = game_id + suggested_at_ms + 建议英雄）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub game_id: i64,
    /// 建议生成时刻（毫秒时间戳）；与 game_id 共同构成关联键。
    pub suggested_at_ms: i64,
    pub suggestion_champion_id: i32,
    pub actual_champion_id: i32,
    pub enemy_champion_id: i32,
    pub position: String,
    /// 用户是否采纳了该建议。
    pub adopted: bool,
    /// 本局是否获胜（对账结果）。
    pub result_win: bool,
    pub matchup_delta: f64,
    pub confidence: f64,
    pub caveats: Vec<String>,
}

/// 采纳 vs 未采纳的结果分布（防幸存者偏差的可见化输出）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionStats {
    pub adopted_total: i64,
    pub not_adopted_total: i64,
    /// 采纳且获胜的占比（0 采纳时为 None）。
    pub adopted_win_rate: Option<f64>,
    /// 未采纳且获胜的占比（0 未采纳时为 None）。
    pub not_adopted_win_rate: Option<f64>,
    /// 尚未对账的赛前建议数（排队等待消费的对账任务量）。
    pub pending_total: i64,
}

/// upsert 一条对账记录（同关联键覆盖，幂等）。
pub fn record_decision(entry: &LedgerEntry) {
    let caveats_json = serde_json::to_string(&entry.caveats).unwrap_or_else(|_| "[]".to_string());
    let _ = with_db(|conn| {
        conn.execute(
            "INSERT INTO decision_ledger (
                 game_id, suggested_at_ms, suggestion_champion_id, actual_champion_id,
                 enemy_champion_id, position, adopted, result_win,
                 matchup_delta, confidence, caveats_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(game_id, suggestion_champion_id, suggested_at_ms)
             DO UPDATE SET adopted=excluded.adopted, result_win=excluded.result_win,
                 matchup_delta=excluded.matchup_delta, confidence=excluded.confidence,
                 caveats_json=excluded.caveats_json",
            params![
                entry.game_id,
                entry.suggested_at_ms,
                entry.suggestion_champion_id,
                entry.actual_champion_id,
                entry.enemy_champion_id,
                entry.position,
                entry.adopted as i32,
                entry.result_win as i32,
                entry.matchup_delta,
                entry.confidence,
                caveats_json,
            ],
        )
    });
}

/// 取最近 N 条对账记录（新 → 旧）。
pub fn query_ledger(limit: usize) -> Vec<LedgerEntry> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT game_id, suggested_at_ms, suggestion_champion_id, actual_champion_id,
                    enemy_champion_id, position, adopted, result_win,
                    matchup_delta, confidence, caveats_json
             FROM decision_ledger
             ORDER BY suggested_at_ms DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            let caveats_json: String = row.get(10)?;
            Ok(LedgerEntry {
                game_id: row.get(0)?,
                suggested_at_ms: row.get(1)?,
                suggestion_champion_id: row.get(2)?,
                actual_champion_id: row.get(3)?,
                enemy_champion_id: row.get(4)?,
                position: row.get(5)?,
                adopted: row.get::<_, i32>(6)? != 0,
                result_win: row.get::<_, i32>(7)? != 0,
                matchup_delta: row.get(8)?,
                confidence: row.get(9)?,
                caveats: serde_json::from_str(&caveats_json).unwrap_or_default(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
    .unwrap_or_default()
}

/// 采纳 vs 未采纳的结果分布（防幸存者偏差的对账视图）。
pub fn adoption_stats() -> Option<AdoptionStats> {
    with_db(|conn| {
        let (adopted_total, adopted_wins) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let (not_total, not_wins) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 0",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let pending_total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pending_suggestions WHERE reconciled_at_ms IS NULL",
            [],
            |row| row.get(0),
        )?;
        let rate = |total: i64, wins: i64| {
            if total > 0 {
                Some(wins as f64 / total as f64)
            } else {
                None
            }
        };
        Ok(AdoptionStats {
            adopted_total,
            not_adopted_total: not_total,
            adopted_win_rate: rate(adopted_total, adopted_wins),
            not_adopted_win_rate: rate(not_total, not_wins),
            pending_total,
        })
    })
}

// ─────────────────────────── 赛前建议缓存（pending） ───────────────────────────

/// 一条待对账的赛前 Pick 建议（写死：只对 Pick 建议做对账，ban 不进入飞轮）。
#[derive(Debug, Clone, PartialEq)]
pub struct PendingSuggestion {
    /// 建议首次生成时刻（毫秒）；与英雄共同构成去重键。
    pub suggested_at_ms: i64,
    pub suggestion_champion_id: i32,
    pub position: String,
    /// 赛前可见的敌方对位英雄（敌方未选时为 None，赛后对账用真值回填）。
    pub enemy_champion_id: Option<i32>,
    /// 已对账的对局 ID（未对账为 None）。
    pub game_id: Option<i64>,
}

/// 记一条赛前建议。同 `(position, 英雄)` 且尚未对账时幂等跳过
/// （每 2s tick 重复产出，只保留首次建议时间——关联键时间戳必须稳定）。
pub fn record_pending_suggestion(p: &PendingSuggestion) {
    let _ = with_db(|conn| record_pending_suggestion_in(conn, p));
}

fn record_pending_suggestion_in(conn: &Connection, p: &PendingSuggestion) -> rusqlite::Result<()> {
    let already = conn.query_row(
        "SELECT 1 FROM pending_suggestions
         WHERE suggestion_champion_id = ?1 AND position = ?2
           AND reconciled_at_ms IS NULL
         LIMIT 1",
        params![p.suggestion_champion_id, p.position],
        |_| Ok(()),
    );
    if already.is_ok() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO pending_suggestions (
             suggested_at_ms, suggestion_champion_id, position, enemy_champion_id
         ) VALUES (?1,?2,?3,?4)",
        params![
            p.suggested_at_ms,
            p.suggestion_champion_id,
            p.position,
            p.enemy_champion_id,
        ],
    )?;
    Ok(())
}

/// 取某时刻之前最近的一条未对账建议（按建议时间倒序第一条）。
/// 对账窗口由调用方控制（开赛时间前 ≤15min），本函数只做"最近未对账"。
pub fn latest_pending_before(cutoff_ms: i64) -> Option<PendingSuggestion> {
    with_db(|conn| latest_pending_before_in(conn, cutoff_ms)).flatten()
}

fn latest_pending_before_in(
    conn: &Connection,
    cutoff_ms: i64,
) -> rusqlite::Result<Option<PendingSuggestion>> {
    conn.query_row(
        "SELECT suggested_at_ms, suggestion_champion_id, position, enemy_champion_id, game_id
         FROM pending_suggestions
         WHERE reconciled_at_ms IS NULL AND suggested_at_ms <= ?1
         ORDER BY suggested_at_ms DESC
         LIMIT 1",
        params![cutoff_ms],
        |row| {
            Ok(PendingSuggestion {
                suggested_at_ms: row.get(0)?,
                suggestion_champion_id: row.get(1)?,
                position: row.get(2)?,
                enemy_champion_id: row.get(3)?,
                game_id: row.get(4)?,
            })
        },
    )
    .optional()
}

/// 把一条建议标记为已对账（回填 game_id 与对账时刻；幂等）。
pub fn mark_pending_reconciled(suggested_at_ms: i64, champion_id: i32, game_id: i64) {
    let _ = with_db(|conn| mark_pending_reconciled_in(conn, suggested_at_ms, champion_id, game_id));
}

fn mark_pending_reconciled_in(
    conn: &Connection,
    suggested_at_ms: i64,
    champion_id: i32,
    game_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pending_suggestions
         SET game_id = ?1, reconciled_at_ms = ?2
         WHERE suggested_at_ms = ?3 AND suggestion_champion_id = ?4",
        params![game_id, chrono_now_ms(), suggested_at_ms, champion_id],
    )?;
    Ok(())
}

/// 清理过于陈旧且从未对账的建议（> 7 天），防表无限膨胀。
pub fn prune_stale_pending(older_than_ms: i64) {
    let _ = with_db(|conn| {
        conn.execute(
            "DELETE FROM pending_suggestions
             WHERE reconciled_at_ms IS NULL AND suggested_at_ms < ?1",
            params![older_than_ms],
        )
    });
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─────────────────────────── 本地对位样本（主链） ───────────────────────────

/// 一条本地对位样本（= 回测输入 `MatchupSample` 的持久化形态）。
#[derive(Debug, Clone, PartialEq)]
pub struct LocalSample {
    pub game_id: i64,
    pub champion_id: i32,
    pub position: String,
    pub enemy_champion_id: i32,
    pub win: bool,
    pub score: f64,
}

/// 增量 upsert 一条样本（同 `(game_id, champion_id)` 覆盖，幂等）。
pub fn upsert_sample(s: &LocalSample) {
    let _ = with_db(|conn| upsert_sample_in(conn, s));
}

fn upsert_sample_in(conn: &Connection, s: &LocalSample) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO local_samples (
             game_id, champion_id, position, enemy_champion_id, win, score
         ) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(game_id, champion_id) DO UPDATE SET
             position = excluded.position,
             enemy_champion_id = excluded.enemy_champion_id,
             win = excluded.win,
             score = excluded.score",
        params![
            s.game_id,
            s.champion_id,
            s.position,
            s.enemy_champion_id,
            s.win as i32,
            s.score,
        ],
    )?;
    Ok(())
}

/// 查询某英雄+位置的样本；`enemy_champion_id` 为 Some 时只取该对位
/// （None = 英雄+位置整体样本）。
pub fn query_samples(
    champion_id: i32,
    position: &str,
    enemy_champion_id: Option<i32>,
) -> Vec<LocalSample> {
    with_db(|conn| query_samples_in(conn, champion_id, position, enemy_champion_id))
        .unwrap_or_default()
}

fn query_samples_in(
    conn: &Connection,
    champion_id: i32,
    position: &str,
    enemy_champion_id: Option<i32>,
) -> rusqlite::Result<Vec<LocalSample>> {
    let (sql, arg) = match enemy_champion_id {
        Some(eid) => (
            "SELECT game_id, champion_id, position, enemy_champion_id, win, score
             FROM local_samples
             WHERE champion_id = ?1 AND position = ?2 AND enemy_champion_id = ?3",
            eid as i64,
        ),
        None => (
            "SELECT game_id, champion_id, position, enemy_champion_id, win, score
             FROM local_samples
             WHERE champion_id = ?1 AND position = ?2",
            0,
        ),
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = match enemy_champion_id {
        Some(_) => stmt.query_map(params![champion_id, position, arg], row_to_sample)?,
        None => stmt.query_map(params![champion_id, position], row_to_sample)?,
    };
    rows.collect::<Result<Vec<_>, _>>()
}

fn row_to_sample(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalSample> {
    Ok(LocalSample {
        game_id: row.get(0)?,
        champion_id: row.get(1)?,
        position: row.get(2)?,
        enemy_champion_id: row.get(3)?,
        win: row.get::<_, i32>(4)? != 0,
        score: row.get(5)?,
    })
}

/// 某英雄+位置已入库的样本数（数据不足判定用）。
pub fn sample_count(champion_id: i32, position: &str) -> usize {
    with_db(|conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM local_samples WHERE champion_id = ?1 AND position = ?2",
            params![champion_id, position],
            |row| row.get::<_, usize>(0),
        )
    })
    .unwrap_or(0)
}

/// 已入库样本的 game_id 集合（增量刷新跳过已处理对局）。
pub fn known_sample_game_ids() -> HashSet<i64> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT DISTINCT game_id FROM local_samples")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<HashSet<_>, _>>()
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(game_id: i64, adopted: bool, win: bool) -> LedgerEntry {
        LedgerEntry {
            game_id,
            suggested_at_ms: game_id * 1000,
            suggestion_champion_id: 1,
            actual_champion_id: 2,
            enemy_champion_id: 3,
            position: "MIDDLE".to_string(),
            adopted,
            result_win: win,
            matchup_delta: 0.1,
            confidence: 0.4,
            caveats: vec!["非因果".to_string()],
        }
    }

    #[test]
    fn schema_creates_on_memory_connection() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
    }

    #[test]
    fn record_and_query_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let e = entry(101, true, true);
        conn.execute(
            "INSERT INTO decision_ledger (
                 game_id, suggested_at_ms, suggestion_champion_id, actual_champion_id,
                 enemy_champion_id, position, adopted, result_win,
                 matchup_delta, confidence, caveats_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                e.game_id,
                e.suggested_at_ms,
                e.suggestion_champion_id,
                e.actual_champion_id,
                e.enemy_champion_id,
                e.position,
                e.adopted as i32,
                e.result_win as i32,
                e.matchup_delta,
                e.confidence,
                r#"["非因果"]"#,
            ],
        )
        .unwrap();
        let rows = query_ledger_in(&conn, 10);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].adopted);
        assert!(rows[0].result_win);
        assert_eq!(rows[0].caveats, vec!["非因果".to_string()]);
    }

    #[test]
    fn upsert_overwrites_same_key() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let e1 = entry(202, true, true);
        insert(&conn, &e1);
        let e2 = LedgerEntry {
            result_win: false,
            ..e1.clone()
        };
        insert(&conn, &e2);
        let rows = query_ledger_in(&conn, 10);
        assert_eq!(rows.len(), 1, "同关联键应覆盖而非新增");
        assert!(!rows[0].result_win);
    }

    #[test]
    fn adoption_stats_split_by_adopted() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert(&conn, &entry(301, true, true));
        insert(&conn, &entry(302, true, false));
        insert(&conn, &entry(303, false, true));
        record_pending_suggestion_in(&conn, &pend(1000, 64, None)).unwrap();
        record_pending_suggestion_in(&conn, &pend(2000, 65, None)).unwrap();
        let stats = stats_in(&conn).unwrap();
        assert_eq!(stats.adopted_total, 2);
        assert_eq!(stats.not_adopted_total, 1);
        assert_eq!(stats.adopted_win_rate, Some(0.5));
        assert_eq!(stats.not_adopted_win_rate, Some(1.0));
        assert_eq!(stats.pending_total, 2, "未对账建议应计入待对账数");
    }

    #[test]
    fn empty_ledger_has_none_win_rates() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let stats = stats_in(&conn).unwrap();
        assert_eq!(stats.adopted_total, 0);
        assert!(stats.adopted_win_rate.is_none());
        assert!(stats.not_adopted_win_rate.is_none());
        assert_eq!(stats.pending_total, 0);
    }

    // ── 测试辅助：把 with_db 的查询抽成可注入连接版本 ──

    fn insert(conn: &Connection, e: &LedgerEntry) {
        conn.execute(
            "INSERT INTO decision_ledger (
                 game_id, suggested_at_ms, suggestion_champion_id, actual_champion_id,
                 enemy_champion_id, position, adopted, result_win,
                 matchup_delta, confidence, caveats_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(game_id, suggestion_champion_id, suggested_at_ms)
             DO UPDATE SET adopted=excluded.adopted, result_win=excluded.result_win,
                 matchup_delta=excluded.matchup_delta, confidence=excluded.confidence,
                 caveats_json=excluded.caveats_json",
            params![
                e.game_id,
                e.suggested_at_ms,
                e.suggestion_champion_id,
                e.actual_champion_id,
                e.enemy_champion_id,
                e.position,
                e.adopted as i32,
                e.result_win as i32,
                e.matchup_delta,
                e.confidence,
                serde_json::to_string(&e.caveats).unwrap_or_else(|_| "[]".to_string()),
            ],
        )
        .unwrap();
    }

    fn query_ledger_in(conn: &Connection, limit: usize) -> Vec<LedgerEntry> {
        let mut stmt = conn
            .prepare(
                "SELECT game_id, suggested_at_ms, suggestion_champion_id, actual_champion_id,
                        enemy_champion_id, position, adopted, result_win,
                        matchup_delta, confidence, caveats_json
                 FROM decision_ledger
                 ORDER BY suggested_at_ms DESC
                 LIMIT ?1",
            )
            .unwrap();
        stmt.query_map([limit as i64], |row| {
            let caveats_json: String = row.get(10)?;
            Ok(LedgerEntry {
                game_id: row.get(0)?,
                suggested_at_ms: row.get(1)?,
                suggestion_champion_id: row.get(2)?,
                actual_champion_id: row.get(3)?,
                enemy_champion_id: row.get(4)?,
                position: row.get(5)?,
                adopted: row.get::<_, i32>(6)? != 0,
                result_win: row.get::<_, i32>(7)? != 0,
                matchup_delta: row.get(8)?,
                confidence: row.get(9)?,
                caveats: serde_json::from_str(&caveats_json).unwrap_or_default(),
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }

    fn stats_in(conn: &Connection) -> rusqlite::Result<AdoptionStats> {
        let (adopted_total, adopted_wins) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let (not_total, not_wins) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 0",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let pending_total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pending_suggestions WHERE reconciled_at_ms IS NULL",
            [],
            |row| row.get(0),
        )?;
        let rate = |total: i64, wins: i64| {
            if total > 0 {
                Some(wins as f64 / total as f64)
            } else {
                None
            }
        };
        Ok(AdoptionStats {
            adopted_total,
            not_adopted_total: not_total,
            adopted_win_rate: rate(adopted_total, adopted_wins),
            not_adopted_win_rate: rate(not_total, not_wins),
            pending_total,
        })
    }

    // ── pending suggestions ──

    fn pend(ms: i64, champion: i32, enemy: Option<i32>) -> PendingSuggestion {
        PendingSuggestion {
            suggested_at_ms: ms,
            suggestion_champion_id: champion,
            position: "MIDDLE".to_string(),
            enemy_champion_id: enemy,
            game_id: None,
        }
    }

    #[test]
    fn pending_dedup_keeps_first_timestamp() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        record_pending_suggestion_in(&conn, &pend(1000, 64, Some(60))).unwrap();
        // 同英雄同位置重复建议（每 2s tick）→ 幂等跳过，保留首次时间
        record_pending_suggestion_in(&conn, &pend(3000, 64, Some(61))).unwrap();
        // 不同英雄 → 允许并行待对账
        record_pending_suggestion_in(&conn, &pend(2000, 65, None)).unwrap();
        let latest = latest_pending_before_in(&conn, 10_000).unwrap().unwrap();
        assert_eq!(latest.suggestion_champion_id, 65, "取最近一条未对账");
        assert_eq!(latest.suggested_at_ms, 2000);
        let before = latest_pending_before_in(&conn, 1500).unwrap().unwrap();
        assert_eq!(before.suggested_at_ms, 1000, "时间窗内取最近的");
    }

    #[test]
    fn pending_reconcile_marks_and_is_skipped() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        record_pending_suggestion_in(&conn, &pend(1000, 64, None)).unwrap();
        mark_pending_reconciled_in(&conn, 1000, 64, 777).unwrap();
        assert!(
            latest_pending_before_in(&conn, 10_000).unwrap().is_none(),
            "已对账的建议不再出现"
        );
        // 对账后同英雄新建议（新局）→ 允许再记
        record_pending_suggestion_in(&conn, &pend(9000, 64, None)).unwrap();
        let again = latest_pending_before_in(&conn, 10_000).unwrap().unwrap();
        assert_eq!(again.suggested_at_ms, 9000);
    }

    #[test]
    fn latest_pending_respects_cutoff() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        record_pending_suggestion_in(&conn, &pend(1000, 64, None)).unwrap();
        assert!(
            latest_pending_before_in(&conn, 500).unwrap().is_none(),
            "开赛时间早于建议时间 → 未对齐，不消费"
        );
    }

    // ── local samples ──

    fn sample(game_id: i64, champion: i32, enemy: i32, win: bool, score: f64) -> LocalSample {
        LocalSample {
            game_id,
            champion_id: champion,
            position: "MIDDLE".to_string(),
            enemy_champion_id: enemy,
            win,
            score,
        }
    }

    #[test]
    fn samples_upsert_and_query_by_matchup() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        upsert_sample_in(&conn, &sample(1, 64, 60, true, 11.0)).unwrap();
        upsert_sample_in(&conn, &sample(2, 64, 61, false, 9.0)).unwrap();
        upsert_sample_in(&conn, &sample(3, 65, 60, true, 12.0)).unwrap();
        // 同 (game_id, champion) 覆盖
        upsert_sample_in(&conn, &sample(2, 64, 61, true, 10.0)).unwrap();

        let all = query_samples_in(&conn, 64, "MIDDLE", None).unwrap();
        assert_eq!(all.len(), 2, "同键覆盖后应只剩 2 条");
        assert!(all.iter().any(|s| s.win));
        let vs_60 = query_samples_in(&conn, 64, "MIDDLE", Some(60)).unwrap();
        assert_eq!(vs_60.len(), 1);
        assert_eq!(vs_60[0].game_id, 1);
        let none = query_samples_in(&conn, 66, "MIDDLE", None).unwrap();
        assert!(none.is_empty());
    }
}
