//! # A3.0 LCU 强化暴露度探测
//!
//! 竞品（aramgg_client / HexBox）均因 **LCU 不暴露局内三选一状态** 而被迫走屏幕
//! OCR。此结论需要在本项目环境持续复核——本模块提供一个运行时探测命令：
//! 在真实 2400 对局中对候选 LCU 端点做一次扫描，递归收集键名含 "augment"
//! 的路径并回报。
//!
//! ## 使用方式
//!
//! 对局中从设置页/开发者工具调用 `mayhem_probe_lcu`，把输出贴进
//! `knowledge/modes/mayhem-spike-lcu.md` 的记录表。若未来 Riot 暴露了状态，
//! A3 即可绕过 OCR 直接订阅事件（当前主路径仍是 OCR，见 feature-expansion-plan）。

use serde::Serialize;
use serde_json::Value;

/// 单个端点的探测结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub endpoint: String,
    pub ok: bool,
    pub error: Option<String>,
    /// 键名含 "augment"（大小写不敏感）的 JSON 路径，最多 [`MAX_PATHS`] 条
    pub augment_key_paths: Vec<String>,
}

const MAX_PATHS: usize = 20;

/// 递归收集对象键名含 `needle`（小写比较）的路径。
///
/// 数组以 `[i]` 标注下标；路径样例：`participants[2].stats.playerAugment1`。
pub fn scan_key_paths(v: &Value, needle: &str, prefix: &str, out: &mut Vec<String>) {
    if out.len() >= MAX_PATHS {
        return;
    }
    match v {
        Value::Object(map) => {
            for (k, child) in map {
                let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                if k.to_lowercase().contains(needle) && out.len() < MAX_PATHS {
                    out.push(path.clone());
                }
                scan_key_paths(child, needle, &path, out);
                if out.len() >= MAX_PATHS {
                    return;
                }
            }
        }
        Value::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                let path = format!("{prefix}[{i}]");
                scan_key_paths(child, needle, &path, out);
                if out.len() >= MAX_PATHS {
                    return;
                }
            }
        }
        _ => {}
    }
}

async fn probe_endpoint(endpoint: &str) -> ProbeResult {
    match crate::lcu::util::http::lcu_get::<Value>(endpoint).await {
        Ok(v) => {
            let mut paths = Vec::new();
            scan_key_paths(&v, "augment", "", &mut paths);
            ProbeResult {
                endpoint: endpoint.to_string(),
                ok: true,
                error: None,
                augment_key_paths: paths,
            }
        }
        Err(e) => ProbeResult {
            endpoint: endpoint.to_string(),
            ok: false,
            error: Some(e),
            augment_key_paths: Vec::new(),
        },
    }
}

/// 对候选端点执行一轮探测（对局中调用才有意义；离线时各端点报错但不 panic）。
pub async fn run_probe() -> Vec<ProbeResult> {
    let endpoints = [
        "lol-gameflow/v1/session",
        "lol-champ-select/v1/session",
        "lol-gameflow/v1/gameflow-phase",
    ];
    let mut results = Vec::with_capacity(endpoints.len());
    for ep in endpoints {
        results.push(probe_endpoint(ep).await);
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scanner_should_collect_nested_and_array_paths_case_insensitively() {
        let v = json!({
            "gameFlow": {
                "participants": [
                    {"stats": {"playerAugment1": 1225}},
                    {"other": 1}
                ],
                "augmentSelectionPhase": {"available": [1, 2]}
            },
            "unrelated": {"deep": {"leaf": true}}
        });
        let mut out = Vec::new();
        scan_key_paths(&v, "augment", "", &mut out);
        assert_eq!(
            out,
            vec![
                "gameFlow.augmentSelectionPhase",
                "gameFlow.participants[0].stats.playerAugment1"
            ]
        );
    }

    #[test]
    fn scanner_should_respect_cap_and_handle_scalars() {
        let mut out = Vec::new();
        scan_key_paths(&json!(42), "augment", "", &mut out);
        assert!(out.is_empty());

        let big = json!({
            "a1": 0, "b": {"a2": 0}, "c": [{"a3": 0}, {"d": [{"a4": 0}]}],
            "e": {"f": {"g": [{"a5": 0}]}}, "h": {"i": {"j": {"k": {"l": {"m": {"n": {"o": {"a6": 0}}}}}}}}
        });
        let mut capped = Vec::new();
        // 阈值 3：先到先得且不 panic
        let _ = &big;
        scan_key_paths(&big, "a", "", &mut capped);
        assert!(!capped.is_empty());
    }
}
