//! 胜率模型：特征 × 时间交互的逻辑回归。推理（app）与拟合（examples/train_wp.rs）共用。

use super::features::FEATURES;
use serde::{Deserialize, Serialize};

/// 设计矩阵列数：截距 + 时间 + 16 个特征各自的原值与 ×时间
pub const DESIGN_COLS: usize = 2 + 2 * FEATURES.len();

/// 时间缩放：m = minute / 30
const TIME_SCALE: f64 = 30.0;
/// L2 正则（不作用于截距）
const L2: f64 = 1e-4;
/// Adam 迭代次数与学习率（与 Node 原型 scratchpad/wp/train.mjs 一致）
const ITERS: usize = 600;
const LR: f64 = 0.05;

/// 一行设计矩阵：[1, m, x1, x1·m, …, x16, x16·m]
pub fn design_row(minute: u32, x: &[f64; 16]) -> Vec<f64> {
    let m = minute as f64 / TIME_SCALE;
    let mut r = Vec::with_capacity(DESIGN_COLS);
    r.push(1.0);
    r.push(m);
    for v in x {
        r.push(*v);
        r.push(v * m);
    }
    r
}

/// 训练产物（model.json 的形状）
///
/// - `features`: 特征名，必须与 [`FEATURES`] 逐项一致
/// - `mu` / `sd`: 各列标准化参数（第 0 列截距不标准化，存 0 / 1）
/// - `weights`: 各列权重
/// - `meta`: 训练元信息（时间、局数、AUC 等），推理不读
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Model {
    pub features: Vec<String>,
    pub mu: Vec<f64>,
    pub sd: Vec<f64>,
    pub weights: Vec<f64>,
    #[serde(default)]
    pub meta: serde_json::Value,
}

fn sigmoid(z: f64) -> f64 {
    1.0 / (1.0 + (-z).exp())
}

impl Model {
    /// 解析并校验 model.json。
    ///
    /// # 错误
    /// JSON 非法、特征名与 [`FEATURES`] 不一致、向量长度不是 [`DESIGN_COLS`]
    pub fn from_json(s: &str) -> Result<Model, String> {
        let m: Model = serde_json::from_str(s).map_err(|e| format!("model.json 解析失败: {e}"))?;
        if m.features.len() != FEATURES.len()
            || m.features.iter().zip(FEATURES).any(|(a, b)| a != b)
        {
            return Err(format!("model.json 特征名与代码不一致: {:?}", m.features));
        }
        if [m.mu.len(), m.sd.len(), m.weights.len()]
            .iter()
            .any(|&n| n != DESIGN_COLS)
        {
            return Err("model.json 向量长度不符".to_string());
        }
        Ok(m)
    }

    /// 蓝方胜率 0~1
    pub fn predict(&self, minute: u32, x: &[f64; 16]) -> f64 {
        let r = design_row(minute, x);
        let z: f64 = r
            .iter()
            .enumerate()
            .map(|(j, v)| {
                self.weights[j]
                    * if j == 0 {
                        1.0
                    } else {
                        (v - self.mu[j]) / self.sd[j]
                    }
            })
            .sum();
        sigmoid(z)
    }
}

/// 全批量 Adam 拟合逻辑回归（确定性，不用随机数）。
///
/// # 参数
/// - `rows`: 设计矩阵行（[`design_row`] 产出）
/// - `ys`: 蓝方是否获胜（1 / 0）
pub fn fit(rows: &[Vec<f64>], ys: &[f64]) -> Model {
    let n = rows.len() as f64;
    let d = DESIGN_COLS;
    let mut mu = vec![0.0; d];
    let mut sd = vec![1.0; d];
    for j in 1..d {
        let (s, s2) = rows
            .iter()
            .fold((0.0, 0.0), |(s, s2), r| (s + r[j], s2 + r[j] * r[j]));
        mu[j] = s / n;
        let var = s2 / n - mu[j] * mu[j];
        sd[j] = if var > 1e-12 { var.sqrt() } else { 1.0 };
    }
    let xs: Vec<Vec<f64>> = rows
        .iter()
        .map(|r| {
            (0..d)
                .map(|j| if j == 0 { 1.0 } else { (r[j] - mu[j]) / sd[j] })
                .collect()
        })
        .collect();
    let (mut w, mut m1, mut m2) = (vec![0.0; d], vec![0.0; d], vec![0.0; d]);
    for t in 1..=ITERS {
        let mut g = vec![0.0; d];
        for (x, y) in xs.iter().zip(ys) {
            let z: f64 = x.iter().zip(&w).map(|(a, b)| a * b).sum();
            let e = sigmoid(z) - y;
            for (gj, xj) in g.iter_mut().zip(x) {
                *gj += e * xj;
            }
        }
        let (b1t, b2t) = (1.0 - 0.9f64.powi(t as i32), 1.0 - 0.999f64.powi(t as i32));
        for j in 0..d {
            let gj = g[j] / n + if j > 0 { L2 * w[j] } else { 0.0 };
            m1[j] = 0.9 * m1[j] + 0.1 * gj;
            m2[j] = 0.999 * m2[j] + 0.001 * gj * gj;
            w[j] -= LR * (m1[j] / b1t) / ((m2[j] / b2t).sqrt() + 1e-8);
        }
    }
    Model {
        features: FEATURES.iter().map(|s| s.to_string()).collect(),
        mu,
        sd,
        weights: w,
        meta: serde_json::Value::Null,
    }
}

/// ROC AUC（秩和法；无正例或无负例返回 NaN）
pub fn auc(ps: &[f64], ys: &[f64]) -> f64 {
    let mut idx: Vec<usize> = (0..ps.len()).collect();
    idx.sort_by(|&a, &b| ps[a].total_cmp(&ps[b]));
    let (mut pos, mut rank_sum) = (0.0, 0.0);
    for (r, &i) in idx.iter().enumerate() {
        if ys[i] > 0.5 {
            pos += 1.0;
            rank_sum += (r + 1) as f64;
        }
    }
    let neg = ps.len() as f64 - pos;
    if pos == 0.0 || neg == 0.0 {
        return f64::NAN;
    }
    (rank_sum - pos * (pos + 1.0) / 2.0) / (pos * neg)
}

/// 十档校准的最大 |预测均值 − 实际胜率|（样本 < 50 的档跳过）
pub fn calibration_max_error(ps: &[f64], ys: &[f64]) -> f64 {
    let mut bins = [(0.0, 0.0, 0usize); 10];
    for (p, y) in ps.iter().zip(ys) {
        let b = ((p * 10.0) as usize).min(9);
        bins[b].0 += p;
        bins[b].1 += y;
        bins[b].2 += 1;
    }
    bins.iter()
        .filter(|b| b.2 >= 50)
        .map(|(sp, sy, n)| ((sp - sy) / *n as f64).abs())
        .fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn x_with_gold(g: f64) -> [f64; 16] {
        let mut x = [0.0; 16];
        x[0] = g;
        x
    }

    /// 金币差越大越容易赢的人造数据（确定性：按下标取值，不用随机数）
    fn toy() -> (Vec<Vec<f64>>, Vec<f64>) {
        let (mut rows, mut ys) = (vec![], vec![]);
        for i in 0..2000 {
            let g = (i % 41) as f64 / 4.0 - 5.0; // −5..5
            let minute = 5 + (i % 25) as u32;
            // 规则：g > 0 赢，但每 7 个翻一个当噪声
            let win = if (g > 0.0) ^ (i % 7 == 0) { 1.0 } else { 0.0 };
            rows.push(design_row(minute, &x_with_gold(g)));
            ys.push(win);
        }
        (rows, ys)
    }

    #[test]
    fn design_row_has_intercept_time_and_interactions() {
        let r = design_row(15, &x_with_gold(2.0));
        assert_eq!(r.len(), 34);
        assert_eq!(r[0], 1.0);
        assert!((r[1] - 0.5).abs() < 1e-12);
        assert_eq!(r[2], 2.0);
        assert!((r[3] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn fit_learns_monotonic_gold_and_is_deterministic() {
        let (rows, ys) = toy();
        let a = fit(&rows, &ys);
        let b = fit(&rows, &ys);
        assert_eq!(a.weights, b.weights);
        assert!(a.predict(15, &x_with_gold(3.0)) > a.predict(15, &x_with_gold(0.0)));
        assert!(a.predict(15, &x_with_gold(0.0)) > a.predict(15, &x_with_gold(-3.0)));
    }

    #[test]
    fn json_round_trip_and_feature_mismatch_rejected() {
        let (rows, ys) = toy();
        let m = fit(&rows, &ys);
        let s = serde_json::to_string(&m).unwrap();
        let back = Model::from_json(&s).unwrap();
        assert_eq!(
            back.predict(10, &x_with_gold(1.0)),
            m.predict(10, &x_with_gold(1.0))
        );
        let mut bad = m.clone();
        bad.features[0] = "golddiff".into();
        assert!(Model::from_json(&serde_json::to_string(&bad).unwrap()).is_err());
        let mut short = m.clone();
        short.weights.pop();
        assert!(Model::from_json(&serde_json::to_string(&short).unwrap()).is_err());
    }

    #[test]
    fn auc_and_calibration_basics() {
        assert_eq!(auc(&[0.1, 0.2, 0.8, 0.9], &[0.0, 0.0, 1.0, 1.0]), 1.0);
        assert_eq!(auc(&[0.9, 0.8, 0.2, 0.1], &[0.0, 0.0, 1.0, 1.0]), 0.0);
        let ps: Vec<f64> = (0..1000).map(|i| (i % 10) as f64 / 10.0 + 0.05).collect();
        let ys: Vec<f64> = (0..1000)
            .map(|i| if (i / 10) % 10 < (i % 10) { 1.0 } else { 0.0 })
            .collect();
        assert!(calibration_max_error(&ps, &ys) < 0.06);
    }
}
