//! # 习惯标签（insight/store，M3 战场三）
//!
//! 跨局聚合「本机玩家」的 L2 维度表现，识别**持续低于同局同位置对手
//! （peer）均值**的重复性短板，产出可验证的 `HabitTag`
//! `{ dimension, avg_vs_peer, streak, first_seen, last_seen }`（路线图 §7.5-3）。
//!
//! 数据落点：`insight.db`（与 `meet.db`/`backtest.db` 同目录，见 `paths`）；
//! schema v2 落地前保持独立库。库损坏静默降级（打 warn），不阻断主流程。
//!
//! 隐私纪律：只存维度聚合（无对局明细、无 puuid）。

use crate::paths::{data_file, ensure_parent_dir};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::{LazyLock, Mutex};

/// 库文件相对配置目录的文件名。
const DB_FILE_NAME: &str = "insight.db";

/// 全局连接句柄：懒打开，失败后置 None 静默降级。
static CONN: LazyLock<Mutex<Option<Connection>>> = LazyLock::new(|| {
    Mutex::new(
        open_db()
            .map_err(|e| log::warn!("insight.db 打开失败，习惯标签停用: {e}"))
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
         CREATE TABLE IF NOT EXISTS habit_tags (
             dimension    TEXT    PRIMARY KEY,
             avg_vs_peer  REAL    NOT NULL,
             streak       INTEGER NOT NULL,
             first_seen   TEXT    NOT NULL,
             last_seen    TEXT    NOT NULL
         );
         CREATE TABLE IF NOT EXISTS habit_goals (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             dimension   TEXT    NOT NULL,
             title       TEXT    NOT NULL,
             created_at  INTEGER NOT NULL,
             done        INTEGER NOT NULL DEFAULT 0
         );",
    )
}

/// 持锁执行一次库操作；连接未就绪/出错时返回 None（调用方降级处理）。
fn with_db<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(conn) => match f(conn) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("insight.db 操作失败: {e}");
                None
            }
        },
        None => None,
    }
}

/// 一条习惯标签（识别到的重复性短板；streak 带近因）。
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HabitTag {
    /// 维度键：vision / cs / deaths / kills / assists / damage
    pub dimension: String,
    /// 平均相对同局同位置对手的差值（负 = 持续低于 peer）。
    pub avg_vs_peer: f64,
    /// 连续低于 peer 的局数（streak，体现"最近还在犯"）。
    pub streak: u32,
    /// 首次检出该短板的局时间（ISO）。
    pub first_seen: String,
    /// 最近一次检出该短板的局时间（ISO）。
    pub last_seen: String,
}

/// 一条改错清单目标（可勾选、跨局追踪）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitGoal {
    pub id: i64,
    pub dimension: String,
    pub title: String,
    pub done: bool,
}

/// 覆盖写入一批习惯标签（幂等：同维度覆盖）。
pub fn upsert_habit_tags(tags: &[HabitTag]) {
    let _ = with_db(|conn| {
        for t in tags {
            conn.execute(
                "INSERT INTO habit_tags (dimension, avg_vs_peer, streak, first_seen, last_seen)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(dimension)
                 DO UPDATE SET avg_vs_peer=excluded.avg_vs_peer,
                     streak=excluded.streak,
                     first_seen=excluded.first_seen,
                     last_seen=excluded.last_seen",
                params![
                    t.dimension,
                    t.avg_vs_peer,
                    t.streak,
                    t.first_seen,
                    t.last_seen
                ],
            )?;
        }
        Ok(())
    });
}

/// 读全部习惯标签（按 avg_vs_peer 升序 = 短板最明显在前）。
pub fn query_habit_tags() -> Vec<HabitTag> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT dimension, avg_vs_peer, streak, first_seen, last_seen
             FROM habit_tags ORDER BY avg_vs_peer ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HabitTag {
                dimension: row.get(0)?,
                avg_vs_peer: row.get(1)?,
                streak: row.get::<_, i64>(2)? as u32,
                first_seen: row.get(3)?,
                last_seen: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
    .unwrap_or_default()
}

/// 加一条改错目标，返回新目标 id。
pub fn add_habit_goal(dimension: &str, title: &str) -> Option<i64> {
    let now = chrono_now_ms();
    with_db(|conn| {
        conn.execute(
            "INSERT INTO habit_goals (dimension, title, created_at) VALUES (?1,?2,?3)",
            params![dimension, title, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

/// 勾选/取消勾选一条目标（幂等）。
pub fn toggle_habit_goal(id: i64) -> bool {
    with_db(|conn| {
        conn.execute(
            "UPDATE habit_goals SET done = 1 - done WHERE id = ?1",
            params![id],
        )?;
        Ok(true)
    })
    .unwrap_or(false)
}

/// 全部改错目标（未完成在前，按创建时间）。
pub fn query_habit_goals() -> Vec<HabitGoal> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, dimension, title, done FROM habit_goals ORDER BY done ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HabitGoal {
                id: row.get(0)?,
                dimension: row.get(1)?,
                title: row.get(2)?,
                done: row.get::<_, i32>(3)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
    .unwrap_or_default()
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn upsert_tags_is_idempotent_by_dimension() {
        let conn = memory_conn();
        upsert_tags_in(&conn, &[tag("vision", -1.0, 3)]);
        upsert_tags_in(&conn, &[tag("vision", -2.0, 4)]);
        let all = query_tags_in(&conn);
        assert_eq!(all.len(), 1, "同维度覆盖而非新增");
        assert_eq!(all[0].streak, 4);
    }

    #[test]
    fn goals_roundtrip_and_toggle() {
        let conn = memory_conn();
        let id = add_goal_in(&conn, "vision", "排眼数 +1").unwrap();
        let goals = query_goals_in(&conn);
        assert_eq!(goals.len(), 1);
        assert!(!goals[0].done);
        assert_eq!(toggle_goal_in(&conn, id), true);
        let goals = query_goals_in(&conn);
        assert!(goals[0].done, "勾选后 done=true");
        assert_eq!(toggle_goal_in(&conn, id), true);
        assert!(!query_goals_in(&conn)[0].done, "再点一次取消");
    }

    // ── 注入版（测试用） ──

    fn upsert_tags_in(conn: &Connection, tags: &[HabitTag]) {
        for t in tags {
            conn.execute(
                "INSERT INTO habit_tags (dimension, avg_vs_peer, streak, first_seen, last_seen)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(dimension)
                 DO UPDATE SET avg_vs_peer=excluded.avg_vs_peer,
                     streak=excluded.streak,
                     first_seen=excluded.first_seen,
                     last_seen=excluded.last_seen",
                params![
                    t.dimension,
                    t.avg_vs_peer,
                    t.streak,
                    t.first_seen,
                    t.last_seen
                ],
            )
            .unwrap();
        }
    }

    fn query_tags_in(conn: &Connection) -> Vec<HabitTag> {
        let mut stmt = conn
            .prepare(
                "SELECT dimension, avg_vs_peer, streak, first_seen, last_seen
                 FROM habit_tags ORDER BY avg_vs_peer ASC",
            )
            .unwrap();
        stmt.query_map([], |row| {
            Ok(HabitTag {
                dimension: row.get(0)?,
                avg_vs_peer: row.get(1)?,
                streak: row.get::<_, i64>(2)? as u32,
                first_seen: row.get(3)?,
                last_seen: row.get(4)?,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }

    fn add_goal_in(conn: &Connection, dimension: &str, title: &str) -> Option<i64> {
        conn.execute(
            "INSERT INTO habit_goals (dimension, title, created_at) VALUES (?1,?2,?3)",
            params![dimension, title, 0],
        )
        .unwrap();
        Some(conn.last_insert_rowid())
    }

    fn toggle_goal_in(conn: &Connection, id: i64) -> bool {
        conn.execute(
            "UPDATE habit_goals SET done = 1 - done WHERE id = ?1",
            params![id],
        )
        .unwrap();
        true
    }

    fn query_goals_in(conn: &Connection) -> Vec<HabitGoal> {
        let mut stmt = conn
            .prepare("SELECT id, dimension, title, done FROM habit_goals ORDER BY done ASC, created_at ASC")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(HabitGoal {
                id: row.get(0)?,
                dimension: row.get(1)?,
                title: row.get(2)?,
                done: row.get::<_, i32>(3)? != 0,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }

    fn tag(dimension: &str, avg: f64, streak: u32) -> HabitTag {
        HabitTag {
            dimension: dimension.to_string(),
            avg_vs_peer: avg,
            streak,
            first_seen: "2026-08-01T00:00:00Z".to_string(),
            last_seen: "2026-08-18T00:00:00Z".to_string(),
        }
    }
}
