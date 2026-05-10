//! 临时探针：复用现有 LCU 鉴权，把斗魂相关的原始 JSON 落盘，方便看真实 schema。
//! 输出目录：<repo>/.claude/plans/arena-probe/
//!
//! 运行：cargo run -p lol-record-analysis-app --example probe_arena

use lol_record_analysis_app_lib::lcu::util::http::lcu_get;
use serde_json::Value;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), String> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let out = repo_root()
        .join(".claude")
        .join("plans")
        .join("arena-probe");
    std::fs::create_dir_all(&out).map_err(|e| format!("mkdir failed: {e}"))?;
    println!("output dir: {}", out.display());

    // 1) gameflow session
    match lcu_get::<Value>("lol-gameflow/v1/session").await {
        Ok(v) => write_json(&out.join("session.json"), &v)?,
        Err(e) => println!("[session] skip: {e}"),
    }

    // 2) champ-select session（斗魂排队/选英雄阶段）
    match lcu_get::<Value>("lol-champ-select/v1/session").await {
        Ok(v) => write_json(&out.join("champ-select.json"), &v)?,
        Err(e) => println!("[champ-select] skip: {e}"),
    }

    // 2.1) lobby & 相关——可能有 subteamIndex 直接给 1-8
    for uri in [
        "lol-lobby/v2/lobby",
        "lol-lobby/v2/lobby/members",
        "lol-lobby/v2/party-active",
        "lol-lobby/v1/parties",
        "lol-lobby/v1/lobby",
        "lol-lobby-team-builder/v1/matchmaking",
        "lol-end-of-game/v1/gameclient-eog-stats-block",
    ] {
        match lcu_get::<Value>(uri).await {
            Ok(v) => {
                let safe = uri.replace('/', "_");
                write_json(&out.join(format!("{safe}.json")), &v)?;
            }
            Err(e) => println!("[{uri}] skip: {e}"),
        }
    }

    // 2.2) lol-cherry/... 试探：任何斗魂专属端点？
    for uri in [
        "lol-cherry/v1/state",
        "lol-cherry/v1/lobby-state",
        "lol-cherry/v1/team-builder",
        "lol-cherry/v1/subteams",
    ] {
        match lcu_get::<Value>(uri).await {
            Ok(v) => {
                let safe = uri.replace('/', "_");
                write_json(&out.join(format!("{safe}.json")), &v)?;
            }
            Err(e) => println!("[{uri}] skip: {e}"),
        }
    }

    // 2.3) game flow / spectator 上报当前游戏 metadata，可能含 subteam 信息
    for uri in [
        "lol-gameflow/v1/early-exit-notifications/missions",
        "lol-spectator/v1/spectate/launch",
        "lol-end-of-game/v1/eog-stats-block",
        "lol-end-of-game/v1/champion-mastery-updates",
        "lol-game-rules/v1/active-game-rules",
        "lol-game-queues/v1/queues",
        "lol-game-data/assets/v1/cherry-augments.json",
    ] {
        match lcu_get::<Value>(uri).await {
            Ok(v) => {
                let safe = uri.replace('/', "_");
                write_json(&out.join(format!("{safe}.json")), &v)?;
            }
            Err(e) => println!("[{uri}] skip: {e}"),
        }
    }

    // 2.4) 列出 LCU 全量 swagger schema（如果可用），里面有所有 endpoint 名字
    for uri in ["help?format=Full", "help?format=Console"] {
        match lcu_get::<Value>(uri).await {
            Ok(v) => {
                let safe = uri.replace(['/', '?', '='], "_");
                write_json(&out.join(format!("{safe}.json")), &v)?;
                break; // 一个就够了，太大
            }
            Err(e) => println!("[{uri}] skip: {e}"),
        }
    }

    // 3) 当前召唤师
    let me: Value = match lcu_get("lol-summoner/v1/current-summoner").await {
        Ok(v) => v,
        Err(e) => return Err(format!("get current-summoner failed: {e}")),
    };
    write_json(&out.join("me.json"), &me)?;
    let puuid = me
        .get("puuid")
        .and_then(|v| v.as_str())
        .ok_or("no puuid")?
        .to_string();

    // 4) 最近 10 场对局列表
    let matches_uri = format!(
        "lol-match-history/v1/products/lol/{}/matches?begIndex=0&endIndex=9",
        puuid
    );
    let matches: Value = match lcu_get(&matches_uri).await {
        Ok(v) => v,
        Err(e) => return Err(format!("get matches failed: {e}")),
    };
    write_json(&out.join("matches.json"), &matches)?;

    // 5) 找一场斗魂（1700/1710/1810/1820）拉详情
    let arena_queues = [1700, 1710, 1810, 1820];
    let games = matches
        .pointer("/games/games")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let arena_game = games.into_iter().find(|g| {
        g.get("queueId")
            .and_then(|q| q.as_i64())
            .map(|q| arena_queues.contains(&(q as i32)))
            .unwrap_or(false)
    });

    if let Some(g) = arena_game {
        let game_id = g
            .get("gameId")
            .and_then(|v| v.as_i64())
            .ok_or("no gameId")?;
        let queue_id = g.get("queueId").and_then(|v| v.as_i64()).unwrap_or(0);
        println!("found arena game: gameId={game_id} queueId={queue_id}");
        let detail: Value = lcu_get(&format!("lol-match-history/v1/games/{}", game_id))
            .await
            .map_err(|e| format!("get arena detail failed: {e}"))?;
        write_json(&out.join("arena-detail.json"), &detail)?;
    } else {
        println!("no arena game in last 10");
    }

    // 6) 顺手存一场普通排位/匹配作对照
    let normal_queues = [420, 430, 440, 450, 700];
    let games2 = matches
        .pointer("/games/games")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let normal_game = games2.into_iter().find(|g| {
        g.get("queueId")
            .and_then(|q| q.as_i64())
            .map(|q| normal_queues.contains(&(q as i32)))
            .unwrap_or(false)
    });
    if let Some(g) = normal_game {
        let game_id = g
            .get("gameId")
            .and_then(|v| v.as_i64())
            .ok_or("no gameId")?;
        let queue_id = g.get("queueId").and_then(|v| v.as_i64()).unwrap_or(0);
        println!("found normal game: gameId={game_id} queueId={queue_id}");
        let detail: Value = lcu_get(&format!("lol-match-history/v1/games/{}", game_id))
            .await
            .map_err(|e| format!("get normal detail failed: {e}"))?;
        write_json(&out.join("normal-detail.json"), &detail)?;
    }

    println!("done");
    Ok(())
}

fn write_json(path: &std::path::Path, v: &Value) -> Result<(), String> {
    let s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(path, s).map_err(|e| format!("write {} failed: {e}", path.display()))?;
    println!("wrote {}", path.display());
    Ok(())
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR 指向 src-tauri，向上一级回到 lol-record-analysis-tauri，再上一级到仓库根
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest)
        .parent()
        .and_then(|p| p.parent())
        .unwrap()
        .to_path_buf()
}
