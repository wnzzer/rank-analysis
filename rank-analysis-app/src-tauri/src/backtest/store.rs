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
use rusqlite::{params, Connection};
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
             ON decision_ledger(adopted, result_win);",
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
        let (adopted_total, adopted_wins) =
            conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )?;
        let (not_total, not_wins) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(result_win), 0) FROM decision_ledger WHERE adopted = 0",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
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
        })
    })
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
        let stats = stats_in(&conn).unwrap();
        assert_eq!(stats.adopted_total, 2);
        assert_eq!(stats.not_adopted_total, 1);
        assert_eq!(stats.adopted_win_rate, Some(0.5));
        assert_eq!(stats.not_adopted_win_rate, Some(1.0));
    }

    #[test]
    fn empty_ledger_has_none_win_rates() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let stats = stats_in(&conn).unwrap();
        assert_eq!(stats.adopted_total, 0);
        assert!(stats.adopted_win_rate.is_none());
        assert!(stats.not_adopted_win_rate.is_none());
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
        })
    }
}