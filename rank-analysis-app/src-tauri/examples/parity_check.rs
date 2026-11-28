//! 整局黄金对拍：逐局比较 Rust `build_snapshot` 与 TS 黄金输出（子项目 2 删除）。
//!
//! 用法（在 src-tauri/ 下）：
//!   cargo run --example parity_check -- <黄金目录>
//!       比对目录下全部 *.golden.json；按归一化字段路径汇总差异
//!   cargo run --example parity_check -- --sgp-smoke <games.jsonl> [局数，默认 300]
//!       SGP 适配层自洽冒烟（TS 无 SGP 快照路径，无黄金可比）：人数一致、有分路队列的
//!       快照分路等于 SUMMARY 真值
//!
//! 退出码：0 全部通过；1 有登记表外差异 / 黄金解析失败 / 目录项读取失败 / 冒烟违例、坏行或 0 局；
//! 2 用法错误、读目录或读文件失败、目录下无黄金。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rank_analysis_lib::match_analysis::input::{from_sgp, NameTable, SgpSummary};
use rank_analysis_lib::match_analysis::parity::{check_golden, normalize_path, Diff};
use rank_analysis_lib::match_analysis::position::TeamPosition;
use rank_analysis_lib::match_analysis::snapshot::build_snapshot;
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("--sgp-smoke") => match args.get(1) {
            Some(file) => {
                let limit = args.get(2).and_then(|n| n.parse().ok()).unwrap_or(300);
                sgp_smoke(Path::new(file), limit)
            }
            None => usage(),
        },
        Some(dir) => golden_dir(Path::new(dir)),
        None => usage(),
    };
    std::process::exit(code);
}

fn usage() -> i32 {
    eprintln!("用法：parity_check <黄金目录> | parity_check --sgp-smoke <games.jsonl> [局数]");
    2
}

/// 某归一化路径上的差异统计
struct PathStat {
    count: usize,
    registered: Option<&'static str>,
    example: String,
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 120 {
        format!("{}…", s.chars().take(120).collect::<String>())
    } else {
        s
    }
}

fn record(by_path: &mut BTreeMap<String, PathStat>, game: &str, d: &Diff) {
    let entry = by_path
        .entry(normalize_path(&d.path))
        .or_insert_with(|| PathStat {
            count: 0,
            registered: d.registered,
            example: format!(
                "{game} {} TS={} Rust={}",
                d.path,
                short(&d.expected),
                short(&d.actual)
            ),
        });
    entry.count += 1;
}

fn golden_dir(dir: &Path) -> i32 {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut entry_errors = 0usize;
    match std::fs::read_dir(dir) {
        Ok(rd) => {
            for entry in rd {
                match entry {
                    Ok(e) => {
                        let p = e.path();
                        if p.to_string_lossy().ends_with(".golden.json") {
                            files.push(p);
                        }
                    }
                    Err(e) => {
                        entry_errors += 1;
                        eprintln!("[错误] 读目录项失败 {}: {e}", dir.display());
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("读目录失败 {}: {e}", dir.display());
            return 2;
        }
    }
    files.sort();
    if files.is_empty() {
        eprintln!("{} 下没有 *.golden.json", dir.display());
        return 2;
    }

    let mut by_path: BTreeMap<String, PathStat> = BTreeMap::new();
    let (mut clean, mut errors) = (0usize, entry_errors);
    for file in &files {
        let report = std::fs::read_to_string(file)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()))
            .and_then(|v| check_golden(&v));
        match report {
            Ok(r) => {
                if r.diffs.is_empty() {
                    clean += 1;
                }
                for d in &r.diffs {
                    record(&mut by_path, &r.name, d);
                }
            }
            Err(e) => {
                errors += 1;
                eprintln!("[错误] {}: {e}", file.display());
            }
        }
    }

    let unregistered: usize = by_path
        .values()
        .filter(|s| s.registered.is_none())
        .map(|s| s.count)
        .sum();
    let registered: usize = by_path
        .values()
        .filter(|s| s.registered.is_some())
        .map(|s| s.count)
        .sum();
    println!(
        "对拍 {} 局：完全一致 {clean}，解析失败 {errors}；登记内差异 {registered}，登记外差异 {unregistered}",
        files.len()
    );
    for (path, s) in &by_path {
        println!(
            "  [{}] {path} ×{}  例：{}",
            s.registered.unwrap_or("未登记"),
            s.count,
            s.example
        );
    }
    if unregistered > 0 || errors > 0 {
        1
    } else {
        0
    }
}

fn sgp_smoke(file: &Path, limit: usize) -> i32 {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("读文件失败 {}: {e}", file.display());
            return 2;
        }
    };
    let names = NameTable::default();
    let (mut games, mut bad_lines, mut violations) = (0usize, 0usize, 0usize);
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        if games >= limit {
            break;
        }
        let Ok(summary) = serde_json::from_str::<SgpSummary>(line) else {
            bad_lines += 1;
            continue;
        };
        games += 1;
        let snap = build_snapshot(&from_sgp(&summary, None, &names));
        if snap.players.len() != summary.participants.len() {
            violations += 1;
            eprintln!(
                "[人数] {}: 快照 {} ≠ SUMMARY {}",
                summary.game_id,
                snap.players.len(),
                summary.participants.len()
            );
            continue;
        }
        if !snap.mode_context.has_lanes {
            continue;
        }
        for (p, sp) in snap.players.iter().zip(&summary.participants) {
            let truth = sp
                .team_position
                .as_deref()
                .and_then(TeamPosition::parse_lane);
            if truth.is_some_and(|t| t != p.team_position) {
                violations += 1;
                eprintln!(
                    "[分路] {} pid {}: 真值 {truth:?} 快照 {:?}",
                    summary.game_id, p.participant_id, p.team_position
                );
            }
        }
    }
    println!("SGP 冒烟 {games} 局（坏行 {bad_lines}）：违例 {violations}");
    if games == 0 {
        eprintln!("[失败] 一局都没解析成功（空文件或全是坏行），冒烟不能算通过");
        return 1;
    }
    if bad_lines > 0 {
        eprintln!("[失败] 有 {bad_lines} 行无法解析为 SgpSummary，冒烟不能算通过");
        return 1;
    }
    if violations > 0 {
        1
    } else {
        0
    }
}
