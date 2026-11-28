//! # 对拍：预期差异登记表与黄金比对（只给 `examples/parity_check.rs` 与测试用，子项目 2 随 TS 一起删）
//!
//! 黄金文件由 `scripts/parity/golden.eval.ts` 用现有 TS 生成：
//! `{ version, kind: "lcu", name, input: { game, slim, championNames, spellNames, spellFallback },
//! expected: { snapshot, remappedTimeline } }`。
//!
//! 比对规则：数值 |差| ≤ [`NUM_TOLERANCE`]；字符串 / 布尔完全一致；数组等长且逐项按序比较；
//! 对象取键并集、缺键视同 `null`（TS `JSON.stringify` 会丢掉 undefined 字段）。
//! 任何差异先查登记表 [`EXPECTED_DIFFS`]，查不到即移植错误。

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use super::input::{from_lcu, LcuGame, NameTable};
use super::snapshot::build_snapshot;
use crate::lcu::api::timeline::SlimTimeline;

/// 黄金格式版本（与 `scripts/parity/golden.eval.ts` 的 `GOLDEN_VERSION` 同步）
pub const GOLDEN_VERSION: u64 = 1;
/// 数值对拍容差（绝对差）
pub const NUM_TOLERANCE: f64 = 1e-9;

/// 一条有意的行为差异登记。
///
/// - `paths`: 归一化字段路径（下标写 `[*]`），或以 `**` 结尾的前缀；一处修复可能落在多个字段上
/// - `queues`: 只放行这些队列的局；空切片表示不限队列（能限就限，免得吞掉别的队列的移植错误）
/// - `test`: 覆盖此差异的测试名
/// - `affects_score`: 影响总分 / 标签时为 true，须附 106 条标注复测（一致率 ≥ 51%）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedDiff {
    pub id: &'static str,
    pub paths: &'static [&'static str],
    pub queues: &'static [i64],
    pub ts: &'static str,
    pub rust: &'static str,
    pub reason: &'static str,
    pub test: &'static str,
    pub affects_score: bool,
}

impl ExpectedDiff {
    /// 该登记是否放行 `queue_id` 局里 `path` 处的差异
    pub fn covers(&self, path: &str, queue_id: i64) -> bool {
        (self.queues.is_empty() || self.queues.contains(&queue_id))
            && self.paths.iter().any(|p| path_matches(p, path))
    }
}

/// 预期差异登记表：经用户批准的 TS 疑似问题修复（编号 `P1-Fn`，Task 12）。
/// 表外的一切不一致都是移植错误。
pub const EXPECTED_DIFFS: &[ExpectedDiff] = &[];

/// 一处差异；`registered` 为命中的登记编号
#[derive(Debug, Clone, PartialEq)]
pub struct Diff {
    pub path: String,
    pub expected: Value,
    pub actual: Value,
    pub registered: Option<&'static str>,
}

/// 一局的比对结果
#[derive(Debug, Clone, PartialEq)]
pub struct GoldenReport {
    pub name: String,
    pub diffs: Vec<Diff>,
}

impl GoldenReport {
    /// 登记表外的差异
    pub fn unregistered(&self) -> impl Iterator<Item = &Diff> + '_ {
        self.diffs.iter().filter(|d| d.registered.is_none())
    }
}

/// 把路径里的数组下标归一成 `[*]`：`players[3].kda` → `players[*].kda`
pub fn normalize_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut in_index = false;
    for ch in path.chars() {
        match ch {
            '[' => {
                in_index = true;
                out.push_str("[*");
            }
            ']' => {
                in_index = false;
                out.push(']');
            }
            _ if in_index => {}
            _ => out.push(ch),
        }
    }
    out
}

/// 登记路径匹配：归一化后相等，或模式以 `**` 结尾且为前缀。
///
/// 前缀必须落在路径段边界上：前缀以 `.` 结尾直接算；以 `]` 结尾时，其后须是结尾、`.` 或 `[`。
/// 因此 `snapshot.players**` 这种写法永远匹配不到 `snapshot.playersX`（并且
/// [`validate_pattern`] 也会拒绝它）。
pub fn path_matches(pattern: &str, path: &str) -> bool {
    let normalized = normalize_path(path);
    match pattern.strip_suffix("**") {
        Some(prefix) => match normalized.strip_prefix(prefix) {
            Some(rest) => {
                (prefix.ends_with('.') || prefix.ends_with(']'))
                    && (prefix.ends_with('.')
                        || rest.is_empty()
                        || rest.starts_with('.')
                        || rest.starts_with('['))
            }
            None => false,
        },
        None => normalized == pattern,
    }
}

/// 校验一条登记路径模式，防止写得过宽把真正的移植错误吞掉。
///
/// 规则：不能为空；`**` 只能出现在结尾一次，且紧跟在 `.` 或 `]` 之后；
/// `**` 之前的固定前缀至少 2 段（`snapshot.**` 太宽，须写成 `snapshot.players[*].**` 这类）。
///
/// # 错误
/// 返回违反的规则说明
pub fn validate_pattern(pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("模式为空".to_string());
    }
    let Some(idx) = pattern.find("**") else {
        return Ok(());
    };
    if idx + 2 != pattern.len() || pattern[..idx].contains("**") {
        return Err(format!("{pattern}: `**` 只能出现在模式结尾"));
    }
    let prefix = &pattern[..idx];
    if prefix.is_empty() {
        return Err(format!("{pattern}: `**` 前缀为空"));
    }
    if !(prefix.ends_with('.') || prefix.ends_with(']')) {
        return Err(format!("{pattern}: `**` 必须紧跟在 `.` 或 `]` 之后"));
    }
    let segments = prefix
        .trim_end_matches('.')
        .split('.')
        .filter(|s| !s.is_empty())
        .count();
    if segments < 2 {
        return Err(format!("{pattern}: `**` 前的固定前缀不足 2 段，范围过宽"));
    }
    Ok(())
}

/// 在给定登记表里找放行 `queue_id` 局 `path` 处差异的条目（测试可传自建表）
pub fn find_expected_in(
    registry: &'static [ExpectedDiff],
    path: &str,
    queue_id: i64,
) -> Option<&'static ExpectedDiff> {
    registry.iter().find(|d| d.covers(path, queue_id))
}

/// 记一处差异；是否命中登记表由 [`check_golden`] 按本局队列统一判定
fn push_diff(out: &mut Vec<Diff>, path: String, expected: Value, actual: Value) {
    out.push(Diff {
        path,
        expected,
        actual,
        registered: None,
    });
}

/// 递归比较两段 JSON，差异追加到 `out`（规则见模块文档；此处 `registered` 一律为 `None`）
pub fn diff_json(path: &str, expected: &Value, actual: &Value, out: &mut Vec<Diff>) {
    match (expected, actual) {
        (Value::Number(e), Value::Number(a)) => {
            let e = e.as_f64().unwrap_or(f64::NAN);
            let a = a.as_f64().unwrap_or(f64::NAN);
            let same = (e - a).abs() <= NUM_TOLERANCE;
            if !same {
                push_diff(out, path.to_string(), expected.clone(), actual.clone());
            }
        }
        (Value::Object(e), Value::Object(a)) => {
            let keys: BTreeSet<&String> = e.keys().chain(a.keys()).collect();
            for k in keys {
                diff_json(
                    &format!("{path}.{k}"),
                    e.get(k).unwrap_or(&Value::Null),
                    a.get(k).unwrap_or(&Value::Null),
                    out,
                );
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                push_diff(
                    out,
                    format!("{path}.length"),
                    Value::from(e.len()),
                    Value::from(a.len()),
                );
                return;
            }
            for (i, (ev, av)) in e.iter().zip(a).enumerate() {
                diff_json(&format!("{path}[{i}]"), ev, av, out);
            }
        }
        _ => {
            if expected != actual {
                push_diff(out, path.to_string(), expected.clone(), actual.clone());
            }
        }
    }
}

/// `{ "<id>": "<名>" }` → id→名表（英雄名与技能名同形）
fn parse_name_map(label: &str, v: &Value) -> Result<HashMap<i64, String>, String> {
    let Some(map) = v.as_object() else {
        return Ok(HashMap::new());
    };
    map.iter()
        .map(|(k, name)| {
            let id = k
                .parse::<i64>()
                .map_err(|e| format!("{label} 键 {k} 不是数字: {e}"))?;
            Ok((id, name.as_str().unwrap_or_default().to_string()))
        })
        .collect()
}

/// 对一份黄金跑 Rust 并比对：`from_lcu` → `build_snapshot` 对 `expected.snapshot`，
/// `MatchInput.timeline`（Rust remap 结果）对 `expected.remappedTimeline`。
/// 名称表完全取自黄金（`championNames` / `spellNames` / `spellFallback`），不用 Rust 内置表。
///
/// # 错误
/// 版本不符、kind 不是 `lcu`、输入解析失败
pub fn check_golden(golden: &Value) -> Result<GoldenReport, String> {
    let name = golden["name"].as_str().unwrap_or("?").to_string();
    let version = golden["version"].as_u64().unwrap_or(0);
    if version != GOLDEN_VERSION {
        return Err(format!(
            "{name}: 黄金版本 {version} ≠ {GOLDEN_VERSION}，请重新生成"
        ));
    }
    if golden["kind"] != "lcu" {
        return Err(format!("{name}: 不支持的 kind {}", golden["kind"]));
    }
    let input = &golden["input"];
    let game: LcuGame = serde_json::from_value(input["game"].clone())
        .map_err(|e| format!("{name}: input.game 解析失败: {e}"))?;
    let slim: Option<SlimTimeline> = serde_json::from_value(input["slim"].clone())
        .map_err(|e| format!("{name}: input.slim 解析失败: {e}"))?;
    let fallback = input["spellFallback"]
        .as_str()
        .ok_or_else(|| format!("{name}: input.spellFallback 缺失"))?
        .to_string();
    let names = NameTable::with_spells(
        parse_name_map("championNames", &input["championNames"])?,
        parse_name_map("spellNames", &input["spellNames"])?,
        fallback,
    );

    let match_input = from_lcu(&game, slim.as_ref(), &names);
    let snapshot = serde_json::to_value(build_snapshot(&match_input))
        .map_err(|e| format!("{name}: 快照序列化失败: {e}"))?;
    let remapped = serde_json::to_value(&match_input.timeline)
        .map_err(|e| format!("{name}: 时间线序列化失败: {e}"))?;

    let mut diffs = Vec::new();
    diff_json(
        "snapshot",
        &golden["expected"]["snapshot"],
        &snapshot,
        &mut diffs,
    );
    diff_json(
        "remappedTimeline",
        &golden["expected"]["remappedTimeline"],
        &remapped,
        &mut diffs,
    );
    for d in &mut diffs {
        d.registered = find_expected_in(EXPECTED_DIFFS, &d.path, game.queue_id).map(|e| e.id);
    }
    Ok(GoldenReport { name, diffs })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GOLDEN_A: &str = include_str!("../../tests/fixtures/parity/regression-a.golden.json");
    const GOLDEN_B: &str = include_str!("../../tests/fixtures/parity/regression-b.golden.json");

    fn diffs(expected: Value, actual: Value) -> Vec<Diff> {
        let mut out = Vec::new();
        diff_json("root", &expected, &actual, &mut out);
        out
    }

    #[test]
    fn should_treat_missing_key_as_null() {
        assert!(diffs(json!({ "a": 1, "b": null }), json!({ "a": 1 })).is_empty());
        assert!(diffs(json!({ "a": 1 }), json!({ "a": 1, "c": null })).is_empty());
        let d = diffs(json!({ "a": 1 }), json!({ "a": 1, "c": 2 }));
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "root.c");
    }

    #[test]
    fn should_tolerate_tiny_float_noise_only() {
        assert!(diffs(json!({ "x": 1.0 }), json!({ "x": 1.0 + 1e-10 })).is_empty());
        assert!(diffs(json!({ "x": 6 }), json!({ "x": 6.0 })).is_empty());
        assert_eq!(
            diffs(json!({ "x": 1.0 }), json!({ "x": 1.000001 })).len(),
            1
        );
    }

    #[test]
    fn should_flag_string_bool_and_order_differences() {
        assert_eq!(diffs(json!("胜方"), json!("败方")).len(), 1);
        assert_eq!(diffs(json!(true), json!(false)).len(), 1);
        let d = diffs(json!([1, 2]), json!([2, 1]));
        let paths: Vec<&str> = d.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(paths, vec!["root[0]", "root[1]"]);
        assert_eq!(diffs(json!(1), json!("1")).len(), 1);
    }

    #[test]
    fn should_flag_array_length_mismatch_once() {
        let d = diffs(json!({ "xs": [1, 2, 3] }), json!({ "xs": [1, 2] }));
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "root.xs.length");
        assert_eq!(d[0].expected, json!(3));
        assert_eq!(d[0].actual, json!(2));
    }

    #[test]
    fn should_normalize_indices_and_match_patterns() {
        assert_eq!(
            normalize_path("snapshot.players[3].kda"),
            "snapshot.players[*].kda"
        );
        assert_eq!(
            normalize_path("snapshot.teams[1].players[12].perks.primary"),
            "snapshot.teams[*].players[*].perks.primary"
        );
        assert!(path_matches(
            "snapshot.players[*].kda",
            "snapshot.players[0].kda"
        ));
        assert!(!path_matches(
            "snapshot.players[*].kda",
            "snapshot.players[0].kdaDiff"
        ));
        assert!(path_matches(
            "snapshot.players[*].**",
            "snapshot.players[4].multiKills.double"
        ));
        assert!(!path_matches(
            "snapshot.players[*].**",
            "snapshot.teams[0].result"
        ));
    }

    #[test]
    fn should_find_registered_diff_in_custom_registry() {
        const REGISTRY: &[ExpectedDiff] = &[ExpectedDiff {
            id: "T-1",
            paths: &[
                "snapshot.players[*].kda",
                "snapshot.teams[*].players[*].kda",
            ],
            queues: &[],
            ts: "ts",
            rust: "rust",
            reason: "测试",
            test: "should_find_registered_diff_in_custom_registry",
            affects_score: false,
        }];
        assert_eq!(
            find_expected_in(REGISTRY, "snapshot.players[7].kda", 420).map(|d| d.id),
            Some("T-1")
        );
        assert_eq!(
            find_expected_in(REGISTRY, "snapshot.teams[1].players[2].kda", 450).map(|d| d.id),
            Some("T-1")
        );
        assert!(find_expected_in(REGISTRY, "snapshot.players[7].gold", 420).is_none());
    }

    #[test]
    fn should_only_cover_listed_queues() {
        const REGISTRY: &[ExpectedDiff] = &[ExpectedDiff {
            id: "T-2",
            paths: &["snapshot.modeContext.hasLanes"],
            queues: &[400],
            ts: "ts",
            rust: "rust",
            reason: "测试",
            test: "should_only_cover_listed_queues",
            affects_score: false,
        }];
        assert!(find_expected_in(REGISTRY, "snapshot.modeContext.hasLanes", 400).is_some());
        assert!(find_expected_in(REGISTRY, "snapshot.modeContext.hasLanes", 420).is_none());
    }

    #[test]
    fn should_keep_registry_entries_complete_and_unique() {
        let mut ids = std::collections::HashSet::new();
        for d in EXPECTED_DIFFS {
            assert!(ids.insert(d.id), "登记编号重复: {}", d.id);
            assert!(!d.paths.is_empty(), "{} 没有登记路径", d.id);
            for (field, v) in [
                ("ts", d.ts),
                ("rust", d.rust),
                ("reason", d.reason),
                ("test", d.test),
            ] {
                assert!(!v.trim().is_empty(), "{} 的 {field} 为空", d.id);
            }
        }
    }

    #[test]
    fn should_validate_registry_patterns() {
        for d in EXPECTED_DIFFS {
            for p in d.paths {
                validate_pattern(p).unwrap_or_else(|e| panic!("{} 的路径 {p} 非法: {e}", d.id));
            }
        }
    }

    #[test]
    fn should_accept_good_and_reject_bad_patterns() {
        for good in [
            "snapshot.players[*].kda",
            "snapshot.players[*].**",
            "snapshot.modeContext.**",
            "remappedTimeline.frames[*].**",
        ] {
            assert!(validate_pattern(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "**",
            ".**",
            "snapshot.**",
            "snapshot**",
            "snapshot.players**",
            "snapshot.players[*]**x",
            "snapshot.**.kda",
            "a.b.****",
        ] {
            assert!(validate_pattern(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn should_not_match_across_segment_boundary() {
        assert!(!path_matches("snapshot.players**", "snapshot.playersX"));
        assert!(!path_matches(
            "snapshot.players[*]**",
            "snapshot.players[0]X"
        ));
        assert!(path_matches(
            "snapshot.players[*]**",
            "snapshot.players[0].kda"
        ));
    }

    fn mutated_paths(mutate: impl FnOnce(&mut Value)) -> Vec<String> {
        let mut golden: Value = serde_json::from_str(GOLDEN_A).unwrap();
        mutate(&mut golden["expected"]);
        let report = check_golden(&golden).unwrap();
        report.unregistered().map(|d| d.path.clone()).collect()
    }

    #[test]
    fn should_detect_remapped_timeline_mutations() {
        let paths = mutated_paths(|e| {
            let g = &mut e["remappedTimeline"]["frames"][1]["players"][0]["totalGold"];
            *g = Value::from(g.as_f64().unwrap() + 1.0);
        });
        assert_eq!(
            paths,
            vec!["remappedTimeline.frames[1].players[0].totalGold"]
        );

        let paths = mutated_paths(|e| {
            e["remappedTimeline"]["events"]
                .as_array_mut()
                .unwrap()
                .pop();
        });
        assert_eq!(paths, vec!["remappedTimeline.events.length"]);
    }

    #[test]
    fn should_detect_removed_snapshot_player_key() {
        let paths = mutated_paths(|e| {
            e["snapshot"]["players"][0]
                .as_object_mut()
                .unwrap()
                .remove("kda");
        });
        assert_eq!(paths, vec!["snapshot.players[0].kda"]);
    }

    #[test]
    fn should_detect_swapped_snapshot_players() {
        let paths = mutated_paths(|e| e["snapshot"]["players"].as_array_mut().unwrap().swap(0, 1));
        assert!(
            paths.iter().any(|p| p.starts_with("snapshot.players[0].")),
            "{paths:?}"
        );
        assert!(
            paths.iter().any(|p| p.starts_with("snapshot.players[1].")),
            "{paths:?}"
        );
        assert!(
            paths.iter().all(|p| p.starts_with("snapshot.players[")),
            "{paths:?}"
        );
    }

    #[test]
    fn should_detect_extra_array_elements() {
        for key in ["players", "teams"] {
            let paths = mutated_paths(|e| {
                let arr = e["snapshot"][key].as_array_mut().unwrap();
                let first = arr[0].clone();
                arr.push(first);
            });
            assert_eq!(paths, vec![format!("snapshot.{key}.length")]);
        }
    }

    fn assert_golden_clean(text: &str) {
        let golden: Value = serde_json::from_str(text).expect("黄金是合法 JSON");
        let report = check_golden(&golden).expect("黄金可比对");
        let bad: Vec<&Diff> = report.unregistered().collect();
        assert!(
            bad.is_empty(),
            "{} 有 {} 处登记表外差异，前 10 处：{:#?}",
            report.name,
            bad.len(),
            &bad[..bad.len().min(10)]
        );
    }

    #[test]
    fn should_match_ts_golden_regression_a() {
        assert_golden_clean(GOLDEN_A);
    }

    #[test]
    fn should_match_ts_golden_regression_b() {
        assert_golden_clean(GOLDEN_B);
    }

    #[test]
    fn should_detect_injected_mutation() {
        let mut golden: Value = serde_json::from_str(GOLDEN_A).unwrap();
        let kda = golden["expected"]["snapshot"]["players"][0]["kda"]
            .as_f64()
            .unwrap();
        golden["expected"]["snapshot"]["players"][0]["kda"] = Value::from(kda + 0.01);
        golden["expected"]["snapshot"]["teams"][0]["result"] = Value::from("平局");
        let report = check_golden(&golden).unwrap();
        let paths: Vec<&str> = report.unregistered().map(|d| d.path.as_str()).collect();
        assert!(paths.contains(&"snapshot.players[0].kda"), "{paths:?}");
        assert!(paths.contains(&"snapshot.teams[0].result"), "{paths:?}");
    }

    #[test]
    fn should_reject_unknown_golden_version() {
        let err = check_golden(&json!({ "version": 99, "kind": "lcu", "name": "x" })).unwrap_err();
        assert!(err.contains("版本"), "{err}");
    }
}
