//! 胜率模型：从裁剪后的时间线算逐分钟蓝方胜率与关键转折（复盘「胜率曲线」）。
//!
//! 设计见 docs/superpowers/specs/2026-11-28-win-probability-curve-design.md。
//! 特征 / 推理 / 转折 / 训练全部在本模块，前端只渲染；训练程序 examples/train_wp.rs 复用同一份代码。

pub mod features;
pub mod model;
pub mod turning;

use serde::{Deserialize, Serialize};

/// 一局的胜率结果（蓝方视角）
///
/// - `blue`: 逐分钟蓝方胜率 0~1，`blue[i]` 对应第 i+1 分钟帧
/// - `turning_points`: 最多 3 个关键转折，按时间升序
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WinProbability {
    pub blue: Vec<f32>,
    pub turning_points: Vec<TurningPoint>,
}

/// 一个关键转折：窗口 (minute-1, minute] 内胜率从 `from` 变到 `to`
///
/// - `text`: 窗口内事实拼成的短句（不含胜率数字，由前端渲染）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurningPoint {
    pub minute: u32,
    pub from: f32,
    pub to: f32,
    pub text: String,
}

use crate::lcu::api::timeline::SlimTimeline;
use model::Model;
use std::sync::OnceLock;

/// 入库系数（examples/train_wp.rs 产出）
const MODEL_JSON: &str = include_str!("model.json");
/// 分钟点少于此数不出结果（重开 / 极短局）
const MIN_POINTS: usize = 5;

/// 进程内只解析一次；失败只告警一次，之后一律 None
fn bundled_model() -> Option<&'static Model> {
    static MODEL: OnceLock<Option<Model>> = OnceLock::new();
    MODEL
        .get_or_init(|| {
            Model::from_json(MODEL_JSON)
                .inspect_err(|e| log::warn!("胜率模型不可用: {e}"))
                .ok()
        })
        .as_ref()
}

/// 计算一局的胜率曲线与关键转折。
///
/// # 返回值
/// 数据不完整（某帧非 10 人、分钟点 < 5）或模型不可用时为 None；调用方据此不显示胜率。
pub fn analyze(tl: &SlimTimeline) -> Option<WinProbability> {
    let model = bundled_model()?;
    let Some(rows) = features::minute_features(tl) else {
        log::debug!("胜率：帧数据不完整，跳过 {}", tl.game_id);
        return None;
    };
    if rows.len() < MIN_POINTS {
        log::debug!(
            "胜率：分钟点 {} < {MIN_POINTS}，跳过 {}",
            rows.len(),
            tl.game_id
        );
        return None;
    }
    let blue: Vec<f32> = rows
        .iter()
        .map(|r| model.predict(r.minute, &r.x) as f32)
        .collect();
    let turning_points = turning::select(&blue)
        .into_iter()
        .map(|i| TurningPoint {
            minute: rows[i].minute,
            from: blue[i - 1],
            to: blue[i],
            text: turning::describe(&tl.events, rows[i - 1].frame_ts, rows[i].frame_ts),
        })
        .collect();
    Some(WinProbability {
        blue,
        turning_points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::timeline::{slim_from_raw, RawDetails};
    use std::collections::HashMap;

    const SAMPLE: &str = include_str!("../../tests/fixtures/sgp_details_sample.json");

    fn sample() -> SlimTimeline {
        slim_from_raw(
            serde_json::from_str::<RawDetails>(SAMPLE).unwrap().json,
            &HashMap::new(),
        )
    }

    #[test]
    fn bundled_model_loads() {
        assert!(Model::from_json(MODEL_JSON).is_ok());
    }

    #[test]
    fn analyze_fixture_gives_one_point_per_minute_in_range() {
        let tl = sample(); // 8 帧：0..7 分
        let wp = analyze(&tl).expect("完整帧应有结果");
        assert_eq!(wp.blue.len(), 7);
        assert!(wp.blue.iter().all(|p| (0.0..=1.0).contains(p)));
        assert!(wp.turning_points.len() <= 3);
        for t in &wp.turning_points {
            assert!(!t.text.is_empty());
        }
    }

    #[test]
    fn analyze_none_for_short_or_broken_games() {
        let mut short = sample();
        short.frames.truncate(5); // 0..4 分 → 4 个分钟点 < 5
        assert!(analyze(&short).is_none());
        let mut broken = sample();
        broken.frames[3].players.pop();
        assert!(analyze(&broken).is_none());
    }
}
