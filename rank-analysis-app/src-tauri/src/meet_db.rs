//! # 遇见过玩家全量库（SQLite）
//!
//! 会话实时聚合（近 20 场）之外的历史沉淀层：每次进选人/对局，把 LCU 战绩里
//! 遇到过的对手逐场 upsert 入库，跨重启、跨版本累积。聚合统计（相遇总场次 /
//! 同队 / 敌方 / 我方胜场 / 最近相遇）由 [`query_summary`] 一把返回，[`recent`]
//! 携带该玩家最近 20 场明细补足实时 20 场窗口之外的历史。
//!
//! 为什么比「只记集合」更强：库按 `(other_puuid, game_id)` 主键去重，天然支持
//! 明细卡（英雄/KDA/胜负/时间/同队判定）与计数并存；且每场入库时携带当时的
//! 全量战绩明细，展示侧零额外请求。
//!
//! ## 数据落点
//!
//! 与 `config.yaml` 同目录（Windows 便携约定，见 `paths`），文件名 `meet.db`。
//! 库损坏/无法打开时静默降级（会话仍走实时聚合），只打一条 warn。

use crate::command::user_tag::OneGamePlayer;
use crate::paths::{data_file, ensure_parent_dir};
use rusqlite::{params, Connection};
use std::sync::{LazyLock, Mutex};

/// 库文件相对配置目录的文件名。
const DB_FILE_NAME: &str = "meet.db";

/// 明细展示上限：实时 20 场窗口外，最多再补 20 场历史。
const RECENT_LIMIT: usize = 20;

/// 全局连接句柄：懒打开，失败（权限/磁盘）后置 None 静默降级。
static CONN: LazyLock<Mutex<Option<Connection>>> = LazyLock::new(|| {
    Mutex::new(
        open_db()
            .map_err(|e| log::warn!("meet.db 打开失败，遇见过持久化停用: {e}"))
            .ok(),
    )
});

/// 打开（必要时创建）库文件并建表。
fn open_db() -> rusqlite::Result<Connection> {
    let path = data_file(DB_FILE_NAME);
    // 目录创建失败也继续尝试打开（打开本身会再次报错），不因目录问题吞掉真实错误
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
         CREATE TABLE IF NOT EXISTS meet_matches (
             other_puuid     TEXT    NOT NULL,
             game_id         INTEGER NOT NULL,
             game_created_at TEXT    NOT NULL,
             is_my_team      INTEGER NOT NULL,
             game_name       TEXT    NOT NULL,
             tag_line        TEXT    NOT NULL,
             champion_id     INTEGER NOT NULL,
             kills           INTEGER NOT NULL,
             deaths          INTEGER NOT NULL,
             assists         INTEGER NOT NULL,
             win             INTEGER NOT NULL,
             queue_id_cn     TEXT    NOT NULL,
             PRIMARY KEY (other_puuid, game_id)
         );
         CREATE INDEX IF NOT EXISTS idx_meet_recency
             ON meet_matches(other_puuid, game_created_at DESC);",
    )
}

/// 持锁执行一次库操作；连接未就绪/出错时返回 None（调用方降级处理）。
fn with_db<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(conn) => match f(conn) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("meet.db 操作失败: {e}");
                None
            }
        },
        None => None,
    }
}

/// 与该玩家的相遇聚合统计。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetSummary {
    /// 累计相遇场次（同队 + 敌方）
    pub total: i64,
    /// 同队场次
    pub my_team_meets: i64,
    /// 敌方场次
    pub enemy_meets: i64,
    /// 同队且我方获胜场次
    pub my_team_wins: i64,
    /// 最近一次相遇的 `game_created_at`（库内字符串时间，可直接展示）
    pub last_seen_at: String,
    /// 最近明细（新 → 旧，上限 [`RECENT_LIMIT`]）
    pub recent: Vec<OneGamePlayer>,
}

/// 把一组「近期遇到」的对局记录 upsert 入库（按 `(puuid, gameId)` 幂等）。
///
/// `games` 是当前用户与其遇见的 `OneGamePlayer` 明细（同一 puuid 一组）。
/// 失败静默降级（内部打 warn），不阻断会话主流程。
pub fn record_games(games: &[OneGamePlayer]) {
    if games.is_empty() {
        return;
    }
    let guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(conn) = guard.as_ref() {
        record_games_in(conn, games);
    }
}

/// 在指定连接上逐场 upsert（测试可注入内存连接）。
fn record_games_in(conn: &Connection, games: &[OneGamePlayer]) {
    for g in games {
        let r = conn.execute(
            "INSERT INTO meet_matches (
                 other_puuid, game_id, game_created_at, is_my_team,
                 game_name, tag_line, champion_id, kills, deaths, assists, win, queue_id_cn
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(other_puuid, game_id) DO NOTHING",
            params![
                g.puuid,
                g.game_id,
                g.game_created_at,
                g.is_my_team as i32,
                g.game_name,
                g.tag_line,
                g.champion_id,
                g.kills,
                g.deaths,
                g.assists,
                g.win as i32,
                g.queue_id_cn,
            ],
        );
        if let Err(e) = r {
            log::warn!("meet.db 写入失败 ({}:{}): {e}", g.puuid, g.game_id);
        }
    }
}

/// 查询某玩家的相遇聚合 + 最近明细。库里无记录时返回零值摘要。
pub fn query_summary(puuid: &str) -> Option<MeetSummary> {
    with_db(|conn| query_summary_in(conn, puuid))
}

/// 在指定连接上查询（测试可注入内存连接）。
fn query_summary_in(conn: &Connection, puuid: &str) -> rusqlite::Result<MeetSummary> {
    let (total, my_team_meets, my_team_wins) = {
        let mut stmt = conn.prepare(
            "SELECT COUNT(*),
                    COALESCE(SUM(is_my_team), 0),
                    COALESCE(SUM(is_my_team AND win), 0)
             FROM meet_matches WHERE other_puuid = ?1",
        )?;
        let mut rows = stmt.query(params![puuid])?;
        match rows.next()? {
            Some(row) => (
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ),
            None => (0, 0, 0),
        }
    };

    let last_seen_at: String = {
        let mut stmt = conn.prepare(
            "SELECT game_created_at FROM meet_matches
             WHERE other_puuid = ?1
             ORDER BY game_created_at DESC, game_id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query(params![puuid])?;
        match rows.next()? {
            Some(row) => row.get(0)?,
            None => String::new(),
        }
    };

    let mut recent = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT game_id, game_created_at, is_my_team, game_name, tag_line,
                    champion_id, kills, deaths, assists, win, queue_id_cn
             FROM meet_matches WHERE other_puuid = ?1
             ORDER BY game_created_at DESC, game_id DESC LIMIT ?2",
        )?;
        let mut rows = stmt.query(params![puuid, RECENT_LIMIT as i64])?;
        while let Some(row) = rows.next()? {
            recent.push(OneGamePlayer {
                index: 0,
                puuid: puuid.to_string(),
                game_id: row.get(0)?,
                game_created_at: row.get(1)?,
                is_my_team: row.get::<_, i32>(2)? != 0,
                game_name: row.get(3)?,
                tag_line: row.get(4)?,
                champion_id: row.get(5)?,
                champion_key: String::new(),
                kills: row.get(6)?,
                deaths: row.get(7)?,
                assists: row.get(8)?,
                win: row.get::<_, i32>(9)? != 0,
                queue_id_cn: row.get(10)?,
            });
        }
    }
    // 明细行索引按展示序补上
    for (i, g) in recent.iter_mut().enumerate() {
        g.index = i as i32;
    }

    Ok(MeetSummary {
        total,
        my_team_meets,
        enemy_meets: total - my_team_meets,
        my_team_wins,
        last_seen_at,
        recent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(
        puuid: &str,
        game_id: i64,
        created_at: &str,
        my_team: bool,
        win: bool,
    ) -> OneGamePlayer {
        OneGamePlayer {
            index: 0,
            game_id,
            puuid: puuid.to_string(),
            game_created_at: created_at.to_string(),
            is_my_team: my_team,
            game_name: "对手".into(),
            tag_line: "8888".into(),
            champion_id: 42,
            champion_key: "Jinx".into(),
            kills: 5,
            deaths: 3,
            assists: 7,
            win,
            queue_id_cn: "排位".into(),
        }
    }

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn record_is_idempotent_by_puuid_and_game_id() {
        let conn = mem_conn();
        record_games_in(
            &conn,
            &[game("P-1", 11, "2026-08-10T12:00:00Z", true, true)],
        );
        // 同一场重复入库：不重复计数
        record_games_in(
            &conn,
            &[game("P-1", 11, "2026-08-10T12:00:00Z", true, true)],
        );
        let sum = query_summary_in(&conn, "P-1").unwrap();
        assert_eq!(sum.total, 1);
    }

    #[test]
    fn summary_aggregates_team_and_win_split() {
        let conn = mem_conn();
        record_games_in(
            &conn,
            &[
                game("P-1", 11, "2026-08-10T12:00:00Z", true, true),
                game("P-1", 22, "2026-08-12T12:00:00Z", true, false),
                game("P-1", 33, "2026-08-14T12:00:00Z", false, false),
            ],
        );
        let sum = query_summary_in(&conn, "P-1").unwrap();
        assert_eq!(sum.total, 3);
        assert_eq!(sum.my_team_meets, 2);
        assert_eq!(sum.enemy_meets, 1);
        assert_eq!(sum.my_team_wins, 1);
        assert_eq!(sum.last_seen_at, "2026-08-14T12:00:00Z");
    }

    #[test]
    fn recent_returns_newest_first_with_limit() {
        let conn = mem_conn();
        // 25 场（超过 RECENT_LIMIT=20）
        let mut games = Vec::new();
        for i in 0..25 {
            games.push(game(
                "P-1",
                100 + i,
                &format!("2026-08-{:02}T12:00:00Z", (i % 28) + 1),
                true,
                true,
            ));
        }
        record_games_in(&conn, &games);
        let sum = query_summary_in(&conn, "P-1").unwrap();
        assert_eq!(sum.total, 25);
        assert_eq!(sum.recent.len(), RECENT_LIMIT);
        // 新 → 旧
        for pair in sum.recent.windows(2) {
            assert!(pair[0].game_created_at >= pair[1].game_created_at);
        }
    }

    #[test]
    fn unknown_puuid_returns_zero_summary() {
        let conn = mem_conn();
        let sum = query_summary_in(&conn, "ghost").unwrap();
        assert_eq!(sum.total, 0);
        assert_eq!(sum.recent.len(), 0);
        assert_eq!(sum.last_seen_at, "");
    }

    #[test]
    fn different_players_do_not_leak() {
        let conn = mem_conn();
        record_games_in(
            &conn,
            &[game("P-2", 44, "2026-08-13T12:00:00Z", false, true)],
        );
        let p1 = query_summary_in(&conn, "P-1").unwrap();
        assert_eq!(p1.total, 0);
    }
}
