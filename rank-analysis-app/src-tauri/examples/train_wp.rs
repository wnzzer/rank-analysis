//! 胜率模型离线训练：基准语料 DETAILS → 特征 → 逻辑回归 → 验收 → model.json。
//!
//! 运行（在 src-tauri/ 下）：
//!   cargo run --release --example train_wp -- [--corpus ../scripts/baseline/raw/details] [--out src/win_prob/model.json]
//!
//! 留出集 = gameId % 5 == 0。验收不过（15 分钟 AUC < 0.84 或校准误差 > 0.05）非零退出且不写文件。
//! 大版本后随评分基准一起重采语料、重训。

use flate2::read::GzDecoder;
use rank_analysis_lib::lcu::api::timeline::{slim_from_raw, RawDetails, SlimEvent};
use rank_analysis_lib::win_prob::features::{minute_features, MinuteFeatures};
use rank_analysis_lib::win_prob::model::{auc, calibration_max_error, design_row, fit};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

const MIN_FRAMES: usize = 10;
const GATE_AUC_15: f64 = 0.84;
const GATE_CALIB: f64 = 0.05;
const REPORT_MINUTES: [u32; 7] = [5, 10, 15, 20, 25, 30, 35];

struct Game {
    game_id: i64,
    win: f64,
    rows: Vec<MinuteFeatures>,
}

fn arg(name: &str, default: &str) -> PathBuf {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

fn load(path: &std::path::Path) -> Option<Game> {
    let mut text = String::new();
    GzDecoder::new(std::fs::File::open(path).ok()?)
        .read_to_string(&mut text)
        .ok()?;
    // 语料文件有的包了一层 {"json": …}（SGP 原样），有的没包
    let raw = serde_json::from_str::<RawDetails>(&text)
        .map(|r| r.json)
        .or_else(|_| serde_json::from_str(&text))
        .ok()?;
    let slim = slim_from_raw(raw, &HashMap::new());
    let win = slim.events.iter().find_map(|e| match e {
        SlimEvent::GameEnd {
            winning_team: 100, ..
        } => Some(1.0),
        SlimEvent::GameEnd {
            winning_team: 200, ..
        } => Some(0.0),
        _ => None,
    })?;
    let rows = minute_features(&slim)?;
    (rows.len() >= MIN_FRAMES).then_some(Game {
        game_id: slim.game_id,
        win,
        rows,
    })
}

fn main() {
    let corpus = arg("--corpus", "../scripts/baseline/raw/details");
    let out = arg("--out", "src/win_prob/model.json");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&corpus)
        .unwrap_or_else(|e| panic!("读不了语料目录 {}: {e}", corpus.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "gz"))
        .collect();
    files.sort();
    let games: Vec<Game> = files.iter().filter_map(|p| load(p)).collect();
    let (test, train): (Vec<&Game>, Vec<&Game>) = games.iter().partition(|g| g.game_id % 5 == 0);
    println!(
        "语料 {} 份，可用 {} 局：训练 {}，留出 {}",
        files.len(),
        games.len(),
        train.len(),
        test.len()
    );

    let (mut rows, mut ys) = (vec![], vec![]);
    for g in &train {
        for r in &g.rows {
            rows.push(design_row(r.minute, &r.x));
            ys.push(g.win);
        }
    }
    let mut model = fit(&rows, &ys);

    let mut aucs = serde_json::Map::new();
    for m in REPORT_MINUTES {
        let (ps, yy): (Vec<f64>, Vec<f64>) = test
            .iter()
            .filter_map(|g| {
                g.rows
                    .iter()
                    .find(|r| r.minute == m)
                    .map(|r| (model.predict(r.minute, &r.x), g.win))
            })
            .unzip();
        let a = if ps.len() >= 100 {
            auc(&ps, &yy)
        } else {
            f64::NAN
        };
        println!("  {m:>2} 分 AUC {a:.3}（{} 局）", ps.len());
        aucs.insert(
            m.to_string(),
            serde_json::json!((a * 1000.0).round() / 1000.0),
        );
    }
    let (ps, yy): (Vec<f64>, Vec<f64>) = test
        .iter()
        .flat_map(|g| g.rows.iter().map(move |r| (r, g.win)))
        .map(|(r, w)| (model.predict(r.minute, &r.x), w))
        .unzip();
    let calib = calibration_max_error(&ps, &yy);
    println!("  校准最大误差 {calib:.3}");

    let auc15 = aucs.get("15").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if !(auc15 >= GATE_AUC_15 && calib <= GATE_CALIB) {
        eprintln!("验收不过：15 分 AUC {auc15:.3}（需 ≥ {GATE_AUC_15}），校准 {calib:.3}（需 ≤ {GATE_CALIB}）；未写文件");
        std::process::exit(1);
    }
    model.meta = serde_json::json!({
        "trainedAt": chrono_like_now(),
        "games": games.len(),
        "trainGames": train.len(),
        "testGames": test.len(),
        "auc": aucs,
        "calibrationMaxError": (calib * 1000.0).round() / 1000.0,
    });
    std::fs::write(&out, serde_json::to_string_pretty(&model).unwrap())
        .expect("写 model.json 失败");
    println!("已写入 {}", out.display());
}

/// 训练时间（UTC，秒精度）；不为一个时间戳引入 chrono
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}
