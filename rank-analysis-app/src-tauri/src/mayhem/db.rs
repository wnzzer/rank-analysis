//! # Mayhem 自采数据库（mayhem.db）
//!
//! 个人海克斯大乱斗对局的本地聚合库。数据只来自**本机 LCU 战绩接口**
//! （`MatchHistory` 摘要自带完整 participants，含 playerAugment1..6），
//! 不经过任何服务端——隐私不出设备（见 docs/feature-expansion-plan.md §10）。
//!
//! ## 表结构
//!
//! - `games`：对局级（queueId 校验后入库）
//! - `players`：参与者级，`is_self=1` 标记本人行（不落盘 puuid，他人行仅存统计）
//!
//! ## 可测试性
//!
//! 所有读写都提供 `_in(conn, …)` 注入连接的变体，公开函数委托到全局单例连接
//! ——单测用内存 SQLite 跑真实 DDL，与 [`crate::meet_db`] 同一范式。

use std::sync::LazyLock;
use std::sync::Mutex;

use rusqlite::params;
use rusqlite::Connection;
use serde::Serialize;

use crate::lcu::api::match_history::Game;
use crate::paths::{data_file, ensure_parent_dir};

const DB_FILE_NAME: &str = "mayhem.db";

static CONN: LazyLock<Mutex<Option<Connection>>> = LazyLock::new(|| {
    Mutex::new(
        open_db()
            .map_err(|e| log::warn!("mayhem.db 打开失败，大乱斗自采统计停用: {e}"))
            .ok(),
    )
});

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
         CREATE TABLE IF NOT EXISTS games (
             game_id      INTEGER PRIMARY KEY,
             queue_id     INTEGER NOT NULL,
             game_mode    TEXT    NOT NULL DEFAULT '',
             duration_secs INTEGER NOT NULL DEFAULT 0,
             imported_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS players (
             game_id       INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
             participant_id INTEGER NOT NULL,
             team_id       INTEGER NOT NULL,
             champion_id   INTEGER NOT NULL,
             is_self       INTEGER NOT NULL DEFAULT 0,
             win           INTEGER NOT NULL,
             kills         INTEGER NOT NULL DEFAULT 0,
             deaths        INTEGER NOT NULL DEFAULT 0,
             assists       INTEGER NOT NULL DEFAULT 0,
             gold_earned   INTEGER NOT NULL DEFAULT 0,
             damage_dealt  INTEGER NOT NULL DEFAULT 0,
             damage_taken  INTEGER NOT NULL DEFAULT 0,
             heal          INTEGER NOT NULL DEFAULT 0,
             items_json    TEXT    NOT NULL DEFAULT '[]',
             spells_json   TEXT    NOT NULL DEFAULT '[]',
             augments_json TEXT    NOT NULL DEFAULT '[]',
             PRIMARY KEY (game_id, participant_id)
         );
         CREATE INDEX IF NOT EXISTS idx_mayhem_players_champion
             ON players(is_self, champion_id);",
    )
}

/// 持锁执行一次库操作；连接未就绪/出错时返回 None（调用方降级处理）。
fn with_db<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(conn) => match f(conn) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("mayhem.db 操作失败: {e}");
                None
            }
        },
        None => None,
    }
}

// ---------------------------------------------------------------------------
// 行结构与导入
// ---------------------------------------------------------------------------

/// 导入结果报告。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// 扫描到的 2400 对局数
    pub scanned: i64,
    /// 新入库数
    pub imported: i64,
    /// 已存在跳过数
    pub skipped_existing: i64,
    /// 写库失败数（连接未就绪等）
    pub failed: i64,
}

/// 个人英雄聚合行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionAgg {
    pub champion_id: i64,
    pub games: i64,
    pub wins: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
}

/// 个人强化聚合行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentAgg {
    pub augment_id: i64,
    pub games: i64,
    pub wins: i64,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn has_game_in(conn: &Connection, game_id: i64) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM games WHERE game_id = ?1",
        params![game_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 把一场 LCU 对局摘要写入指定连接（幂等：已存在返回 Ok(false)）。
///
/// 仅接受 queueId == 2400 的对局；participants 里通过 identities 的 puuid 匹配
/// 本人行（`is_self=1`）。他人行不落任何身份字段。
pub fn import_game_in(
    conn: &Connection,
    game: &Game,
    self_puuid: &str,
) -> rusqlite::Result<bool> {
    if game.queue_id != crate::mayhem::MAYHEM_QUEUE_ID {
        return Ok(false);
    }
    if has_game_in(conn, game.game_id)? {
        return Ok(false);
    }

    // participantId ↔ puuid 对应：LCU 中 identities[i] 与 participants[i] 一一
    // 对应（participantId 相同），按索引取 identity.player.puuid 判断 is_self。
    // 本人只存 is_self 标记，不落盘 puuid；他人行仅存统计。
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO games (game_id, queue_id, game_mode, duration_secs, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            game.game_id,
            game.queue_id,
            game.game_mode,
            game.game_duration,
            now_secs()
        ],
    )?;

    for (idx, p) in game.participants.iter().enumerate() {
        let is_self = game
            .participant_identities
            .get(idx)
            .is_some_and(|pi| pi.player.puuid == self_puuid);
        let items: Vec<i32> = [
            p.stats.item0,
            p.stats.item1,
            p.stats.item2,
            p.stats.item3,
            p.stats.item4,
            p.stats.item5,
            p.stats.item6,
        ]
        .into_iter()
        .filter(|v| *v > 0)
        .collect();
        let spells: Vec<i32> = [p.stats.spell1_id, p.stats.spell2_id]
            .into_iter()
            .filter(|v| *v > 0)
            .collect();
        let augments: Vec<i32> = [
            p.stats.player_augment1,
            p.stats.player_augment2,
            p.stats.player_augment3,
            p.stats.player_augment4,
            p.stats.player_augment5,
            p.stats.player_augment6,
        ]
        .into_iter()
        .filter(|v| *v > 0)
        .collect();

        tx.execute(
            "INSERT OR IGNORE INTO players (
                 game_id, participant_id, team_id, champion_id, is_self, win,
                 kills, deaths, assists, gold_earned, damage_dealt, damage_taken, heal,
                 items_json, spells_json, augments_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                game.game_id,
                p.participant_id,
                p.team_id,
                p.champion_id,
                is_self as i32,
                p.stats.win as i32,
                p.stats.kills,
                p.stats.deaths,
                p.stats.assists,
                p.stats.gold_earned,
                p.stats.total_damage_dealt_to_champions,
                p.stats.total_damage_taken,
                p.stats.total_heal,
                serde_json::to_string(&items).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&spells).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&augments).unwrap_or_else(|_| "[]".into()),
            ],
        )?;
    }
    tx.commit()?;
    Ok(true)
}

/// 全局连接版 [`import_game_in`]；连接未就绪返回 None。
pub fn import_game(game: &Game, self_puuid: &str) -> Option<rusqlite::Result<bool>> {
    with_db(|conn| import_game_in(conn, game, self_puuid))
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

fn champion_stats_in(conn: &Connection) -> rusqlite::Result<Vec<ChampionAgg>> {
    let mut stmt = conn.prepare(
        "SELECT champion_id, COUNT(*) AS games, SUM(win),
                SUM(kills), SUM(deaths), SUM(assists)
         FROM players WHERE is_self = 1
         GROUP BY champion_id ORDER BY games DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ChampionAgg {
            champion_id: r.get(0)?,
            games: r.get(1)?,
            wins: r.get(2)?,
            kills: r.get(3)?,
            deaths: r.get(4)?,
            assists: r.get(5)?,
        })
    })?;
    rows.collect()
}

fn augment_stats_in(
    conn: &Connection,
    champion_id: Option<i32>,
) -> rusqlite::Result<Vec<AugmentAgg>> {
    // JSON 数组聚合在 Rust 侧完成（bundled SQLite 不保证 json1 扩展）
    let mut stmt = conn.prepare(if champion_id.is_some() {
        "SELECT augments_json, win FROM players WHERE is_self = 1 AND champion_id = ?1"
    } else {
        "SELECT augments_json, win FROM players WHERE is_self = 1"
    })?;
    let bind = champion_id.unwrap_or_default();
    let mut rows = if champion_id.is_some() {
        stmt.query(params![bind])?
    } else {
        stmt.query([])?
    };

    // (augment_id) -> (games, wins)
    let mut acc: std::collections::HashMap<i64, (i64, i64)> = std::collections::HashMap::new();
    while let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let win: i64 = row.get(1)?;
        let Ok(list) = serde_json::from_str::<Vec<i64>>(&json) else {
            continue;
        };
        for id in list {
            if id <= 0 {
                continue;
            }
            let e = acc.entry(id).or_insert((0, 0));
            e.0 += 1;
            e.1 += win;
        }
    }

    let mut out: Vec<AugmentAgg> = acc
        .into_iter()
        .map(|(augment_id, (games, wins))| AugmentAgg { augment_id, games, wins })
        .collect();
    out.sort_by(|a, b| b.games.cmp(&a.games).then(a.augment_id.cmp(&b.augment_id)));
    Ok(out)
}

// ---------------------------------------------------------------------------
// 全局入口（command 层调用）
// ---------------------------------------------------------------------------

/// 本人英雄聚合（新 → 多排序）；库未就绪返回空表。
pub fn personal_champion_stats() -> Vec<ChampionAgg> {
    with_db(champion_stats_in).unwrap_or_default()
}

/// 本人强化聚合；`champion_id` 过滤单一英雄。
pub fn personal_augment_stats(champion_id: Option<i32>) -> Vec<AugmentAgg> {
    with_db(|conn| augment_stats_in(conn, champion_id)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_schema(&conn).expect("init schema");
        conn
    }

    /// 构造一场最小可解析的 2400 对局摘要（字段集对齐 model.rs 非 default 项）。
    fn game_fixture(game_id: i64, my_win: bool) -> Game {
        let stats_tpl = |win: bool| {
            format!(
                r#"{{
                    "win": {win}, "item0": 3006, "item1": 3153, "item2": 3124,
                    "item3": 0, "item4": 0, "item5": 0, "item6": 3340,
                    "kills": 8, "deaths": 3, "assists": 12,
                    "goldEarned": 15000, "goldSpent": 14000,
                    "totalDamageDealtToChampions": 32000,
                    "totalDamageDealt": 90000,
                    "totalDamageTaken": 21000,
                    "totalHeal": 4200,
                    "totalMinionsKilled": 12,
                    "playerAugment1": 1225, "playerAugment2": 2010, "playerAugment3": 2095,
                    "spell1Id": 4, "spell2Id": 6
                }}"#
            )
        };
        let participant_tpl = |pid: i32, team: i32, champ: i32, win: bool| {
            format!(
                r#"{{"participantId": {pid}, "teamId": {team}, "championId": {champ},
                    "spell1Id": 4, "spell2Id": 6, "stats": {}}}"#,
                stats_tpl(win)
            )
        };
        let identity_tpl = |pid_name: &str, puuid: &str| {
            format!(
                r#"{{"player": {{"accountId": 1, "platformId": "TFT", "summonerName": "{pid_name}",
                     "gameName": "{pid_name}", "tagLine": "cn1", "summonerId": 7, "puuid": "{puuid}"}}}}"#
            )
        };
        let me = "puuuuid-me";
        let json = format!(
            r#"{{
                "endOfGameResult": "GameComplete",
                "gameId": {game_id},
                "gameCreationDate": "2026-08-25T12:00:00.000Z",
                "gameDuration": 1234,
                "gameMode": "ARAM",
                "gameType": "MATCHED_GAME",
                "mapId": 12,
                "queueId": 2400,
                "platformId": "TFT",
                "participantIdentities": [{}, {}],
                "participants": [{}, {}]
            }}"#,
            identity_tpl("me", me),
            identity_tpl("foe", "puuuid-foe"),
            participant_tpl(1, 100, 67, my_win),
            participant_tpl(2, 200, 104, !my_win),
        );
        serde_json::from_str(&json).expect("fixture should deserialize")
    }

    #[test]
    fn import_should_be_idempotent_and_tag_self_rows() {
        let conn = mem_conn();
        let g = game_fixture(4_200_001, true);

        assert!(import_game_in(&conn, &g, "puuuuid-me").expect("first import"));
        // 幂等：重复导入返回 false 且不产生重复行
        assert!(!import_game_in(&conn, &g, "puuuuid-me").expect("second import"));

        let players: i64 = conn
            .query_row("SELECT COUNT(*) FROM players", [], |r| r.get(0))
            .unwrap();
        assert_eq!(players, 2, "两名参与者各一行");

        let (champ, win): (i64, i64) = conn
            .query_row(
                "SELECT champion_id, win FROM players WHERE is_self = 1 AND game_id = 4200001",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((champ, win), (67, 1));

        // 敌方行不得被标记为 self
        let foe_self: i64 = conn
            .query_row("SELECT COUNT(*) FROM players WHERE is_self = 0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(foe_self, 1);
    }

    #[test]
    fn non_mayhem_queue_should_be_rejected() {
        let conn = mem_conn();
        let mut g = game_fixture(4_200_002, true);
        g.queue_id = 450;
        assert!(!import_game_in(&conn, &g, "puuuuid-me").expect("reject"));
        let games: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(games, 0);
    }

    #[test]
    fn aggregations_should_roll_up_by_champion_and_augment() {
        let conn = mem_conn();
        import_game_in(&conn, &game_fixture(4_200_003, true), "puuuuid-me").unwrap();
        import_game_in(&conn, &game_fixture(4_200_004, false), "puuuuid-me").unwrap();

        let champs = champion_stats_in(&conn).expect("agg");
        assert_eq!(champs.len(), 1, "两局同英雄聚合为一行");
        let c = &champs[0];
        assert_eq!((c.champion_id, c.games, c.wins), (67, 2, 1));
        assert_eq!(c.kills, 16);

        let aug_all = augment_stats_in(&conn, None).expect("aug all");
        let tank_engine = aug_all.iter().find(|a| a.augment_id == 1225).expect("aug 1225");
        assert_eq!(tank_engine.games, 2);
        assert_eq!(tank_engine.wins, 1);

        // 按英雄过滤：库里只有 67 号英雄的自采行，过滤后一致；换不存在英雄为空
        assert_eq!(augment_stats_in(&conn, Some(67)).unwrap().len(), aug_all.len());
        assert!(augment_stats_in(&conn, Some(999)).unwrap().is_empty());

        // 装备/召唤师技能 JSON 落库且过滤 0 值
        let (items, spells): (String, String) = conn
            .query_row(
                "SELECT items_json, spells_json FROM players WHERE is_self = 1 LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Vec<i64>>(&items).unwrap().len(), 4); // item0-2 + 3340
        assert_eq!(serde_json::from_str::<Vec<i64>>(&spells).unwrap(), vec![4, 6]);
    }
}
