//! 对拍语料导出：拉本人最近 50 局（LCU 对局 + SGP 裁剪时间线），写成与回归 fixture 相同的
//! `{ game, slim }` JSON，供 `scripts/parity/golden.eval.ts` 生成黄金。
//!
//! ⚠️ 输出含 puuid / 召唤师名：**只能写到仓库外目录，绝不入库**。
//!
//! 用法（客户端已登录；在 src-tauri/ 下；先清掉 shell 代理，否则 SGP 可能走代理超时）：
//!   env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
//!     cargo run --example dump_parity_corpus -- <输出目录>
//!
//! 取数路径与 app 一致：`get_match_history_by_puuid(本人, 0, 49)`（gameDetail 补全 + 中文队列名），
//! 再对 mapId 11/12 的对局调 `fetch_game_timeline`（与前端 `supportsTimeline` 一致；**未 remap**，
//! remap 交给 TS / Rust 各自做），失败写 `null`。全程只读 LCU（仅 GET）。
//! 输出目录若落在当前 git 仓库内，直接报错退出（在联系 LCU 之前）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use rank_analysis_lib::command::match_history::get_match_history_by_puuid;
use rank_analysis_lib::constant::game::CHAMPION_MAP;
use rank_analysis_lib::lcu::api::summoner::Summoner;
use rank_analysis_lib::lcu::api::timeline::fetch_game_timeline;
use serde_json::{json, Value};

#[tokio::main]
async fn main() -> Result<(), String> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("用法：dump_parity_corpus <输出目录>")?,
    );
    ensure_outside_repo(&out)?;
    std::fs::create_dir_all(&out).map_err(|e| format!("创建目录失败: {e}"))?;

    let me = Summoner::get_my_summoner().await?;
    let history = get_match_history_by_puuid(me.puuid.clone(), 0, 49).await?;
    let games = &history.games.games;

    let mut with_timeline = 0usize;
    let mut timeline_failed = 0usize;
    let mut no_timeline_map = 0usize;
    let mut detail_missing = 0usize;
    let mut queues: BTreeMap<i64, usize> = BTreeMap::new();
    for game in games {
        if game.game_detail.participants.is_empty() {
            detail_missing += 1;
        }
        *queues.entry(game.queue_id as i64).or_default() += 1;
        let slim = if game.map_id == 11 || game.map_id == 12 {
            match fetch_game_timeline(&game.platform_id, game.game_id).await {
                Ok(s) => {
                    with_timeline += 1;
                    Some(s)
                }
                Err(e) => {
                    timeline_failed += 1;
                    eprintln!("[时间线] {}: {e}", game.game_id);
                    None
                }
            }
        } else {
            no_timeline_map += 1;
            None
        };
        let body = json!({ "game": game, "slim": slim });
        std::fs::write(out.join(format!("{}.json", game.game_id)), body.to_string())
            .map_err(|e| format!("写 {} 失败: {e}", game.game_id))?;
    }

    let champions: Vec<Value> = CHAMPION_MAP
        .entries()
        .filter(|(id, _)| **id != 0)
        .map(|(_, c)| json!({ "value": c.value, "label": c.label }))
        .collect();
    std::fs::write(
        out.join("champions.json"),
        Value::from(champions).to_string(),
    )
    .map_err(|e| format!("写 champions.json 失败: {e}"))?;

    println!(
        "导出 {} 局（带时间线 {with_timeline}，时间线失败 {timeline_failed}，地图不支持时间线 {no_timeline_map}，gameDetail 缺失 {detail_missing}）到 {}",
        games.len(),
        out.display()
    );
    println!("队列分布（queueId: 局数）: {queues:?}");
    Ok(())
}

/// 拒绝把含 puuid / 召唤师名的输出写进当前 git 仓库：输出目录（规范化后）在 toplevel 内即报错。
fn ensure_outside_repo(out: &Path) -> Result<(), String> {
    let top = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let Some(top) = top else {
        return Ok(()); // 不在 git 仓库内（或无 git），无需防护
    };
    let top = std::fs::canonicalize(top).map_err(|e| format!("规范化仓库路径失败: {e}"))?;
    // 输出目录可能尚不存在：规范化最近的已存在祖先，再拼回剩余部分
    let abs = std::path::absolute(out).map_err(|e| format!("解析输出路径失败: {e}"))?;
    let mut existing = abs.as_path();
    let mut rest = Vec::new();
    while !existing.exists() {
        rest.push(existing.file_name().unwrap_or_default().to_owned());
        existing = existing.parent().ok_or("输出路径无有效祖先目录")?;
    }
    let mut canon =
        std::fs::canonicalize(existing).map_err(|e| format!("规范化输出路径失败: {e}"))?;
    canon.extend(rest.iter().rev());
    if canon.starts_with(&top) {
        return Err(format!(
            "拒绝：输出目录 {} 位于 git 仓库 {} 内（输出含 puuid / 召唤师名，不得入库）",
            canon.display(),
            top.display()
        ));
    }
    Ok(())
}
