//! 胜率模型：从裁剪后的时间线算逐分钟蓝方胜率与关键转折（复盘「胜率曲线」）。
//!
//! 设计见 docs/superpowers/specs/2026-11-28-win-probability-curve-design.md。
//! 特征 / 推理 / 转折 / 训练全部在本模块，前端只渲染；训练程序 examples/train_wp.rs 复用同一份代码。

pub mod features;

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
