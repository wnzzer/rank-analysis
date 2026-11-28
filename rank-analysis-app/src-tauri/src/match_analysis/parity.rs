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
/// - `when`: 取值谓词（见 [`DiffValues`]）；有谓词时路径命中且谓词成立才算登记内，
///   只放行「修复本该产生的那种值变化」，同一字段的其他差异仍报错
/// - `test`: 覆盖此差异的测试名
/// - `affects_score`: 影响总分 / 标签时为 true，须附 106 条标注复测（一致率 ≥ 51%）
#[derive(Debug, Clone)]
pub struct ExpectedDiff {
    pub id: &'static str,
    pub paths: &'static [&'static str],
    pub queues: &'static [i64],
    pub when: Option<fn(&DiffValues<'_>) -> bool>,
    pub ts: &'static str,
    pub rust: &'static str,
    pub reason: &'static str,
    pub test: &'static str,
    pub affects_score: bool,
}

/// 登记谓词看到的一处差异的取值
///
/// - `expected` / `actual`: 该字段的 TS 值 / Rust 值
/// - `actual_parent`: Rust 输出里该字段所在的对象（如同一名玩家），供谓词对照兄弟字段；取不到为 `None`
#[derive(Debug, Clone, Copy)]
pub struct DiffValues<'a> {
    pub expected: &'a Value,
    pub actual: &'a Value,
    pub actual_parent: Option<&'a Value>,
}

impl ExpectedDiff {
    /// 该登记是否放行 `queue_id` 局里 `path` 处取值为 `values` 的差异
    pub fn covers(&self, path: &str, queue_id: i64, values: &DiffValues<'_>) -> bool {
        (self.queues.is_empty() || self.queues.contains(&queue_id))
            && self.paths.iter().any(|p| path_matches(p, path))
            && self.when.is_none_or(|f| f(values))
    }
}

/// P1-F3 谓词：TS 为 0 或 null（读了废弃字段），Rust 为数字，且等于同一玩家 Rust 的
/// `visionWardsBought`（该兄弟字段仍与 TS 直接比对，可作基准）
fn f3_zero_to_vision_wards_bought(v: &DiffValues<'_>) -> bool {
    let ts_zero = v.expected.is_null() || v.expected.as_f64() == Some(0.0);
    let sibling = v.actual_parent.map(|p| &p["visionWardsBought"]);
    ts_zero && v.actual.is_number() && sibling == Some(v.actual)
}

/// P1-F4 谓词：TS 拼名 `gameName#tagLine` 的某一段缺失（空串或整段 `undefined`），
/// 且 Rust 给出的正是规则对应的兜底名。
///
/// - TS 为 `g#` / `g#undefined`（g 非空且不是 `undefined`）→ Rust 必须恰为 `g`
/// - TS 以 `#` / `undefined#` 开头（含 `#`、`undefined#undefined`）→ Rust 走 summonerName / 未知玩家，
///   不得含 `#` 或 `undefined`
///
/// `undefined` 只按整段匹配，名字里恰好含 "undefined" 的真实玩家不会被放行。
fn f4_display_name_fallback(v: &DiffValues<'_>) -> bool {
    let (Some(ts), Some(rust)) = (v.expected.as_str(), v.actual.as_str()) else {
        return false;
    };
    let Some((game_name, tag_line)) = ts.split_once('#') else {
        return false;
    };
    let missing = |s: &str| s.is_empty() || s == "undefined";
    if !missing(game_name) {
        missing(tag_line) && rust == game_name
    } else {
        !rust.contains('#') && !rust.contains("undefined")
    }
}

/// 按差异路径（如 `snapshot.players[3].kda`）取其父对象；`roots` 给出各根名对应的值
fn parent_of<'a>(roots: &[(&str, &'a Value)], path: &str) -> Option<&'a Value> {
    let parent = &path[..path.rfind('.')?];
    let root_len = parent.find(['.', '[']).unwrap_or(parent.len());
    let (_, mut cur) = roots.iter().find(|(r, _)| *r == &parent[..root_len])?;
    let mut rest = &parent[root_len..];
    while !rest.is_empty() {
        if let Some(r) = rest.strip_prefix('[') {
            let end = r.find(']')?;
            cur = cur.get(r[..end].parse::<usize>().ok()?)?;
            rest = &r[end + 1..];
        } else {
            let r = rest.strip_prefix('.')?;
            let end = r.find(['.', '[']).unwrap_or(r.len());
            cur = cur.get(&r[..end])?;
            rest = &r[end..];
        }
    }
    Some(cur)
}

/// 预期差异登记表：经用户批准的 TS 疑似问题修复（编号 `P1-Fn`，Task 12）。
/// 表外的一切不一致都是移植错误。
///
/// P1-F2（isMe 按 puuid）**故意不登记**：对拍的 `me_puuid` 取输入里的战绩查询对象，与 TS 的
/// `currentPlayerKey` 是同一人，A/B 与本人 50 局 isMe 零差异；只有改名 / 显示名撞车局会分歧，
/// 那种局出现时应作为登记表外差异暴露、由人判断，而不是被路径放行吞掉。行为由单测
/// `input::tests::should_mark_me_by_puuid_when_renamed` 覆盖。
pub const EXPECTED_DIFFS: &[ExpectedDiff] = &[ExpectedDiff {
    id: "P1-F1",
    paths: &[
        "snapshot.modeContext.kind",
        "snapshot.modeContext.description",
        "snapshot.modeContext.hasLanes",
        "snapshot.modeContext.championAssignment",
        "snapshot.players[*].teamPosition",
        "snapshot.players[*].vsLaneOpponent",
        "snapshot.teams[*].players[*].teamPosition",
        "snapshot.teams[*].players[*].vsLaneOpponent",
    ],
    queues: &[400],
    when: None,
    ts: "队列 400（普通征召）不在 RANKED_QUEUE_IDS，兜底成大乱斗：kind=aram、hasLanes=false、\
         championAssignment=random-with-bench，分路走推断、vsLaneOpponent 恒为 null",
    rust:
        "400 与 420/440 同为有分路的排位类：kind=ranked、hasLanes=true、championAssignment=pick，\
           分路走选秀槽位（position.rs 已把 400 列为槽位队列），有对位差值",
    reason: "400 是有 BP、有分路的征召模式；TS 两处口径矛盾，槽位分路与对位差值在 400 永远不生效。\
             会改变 400 局的评分口径，标注复测：P3（评分进 Rust 后执行）",
    test: "mode::tests::should_classify_400_as_ranked_with_lanes, \
           snapshot::tests::should_assign_slot_positions_for_normal_draft_400, \
           parity::tests::should_match_ts_golden_regression_a_queue_400",
    affects_score: true,
}, ExpectedDiff {
    id: "P1-F3",
    paths: &[
        "snapshot.players[*].controlWardsPlaced",
        "snapshot.teams[*].players[*].controlWardsPlaced",
    ],
    queues: &[],
    when: Some(f3_zero_to_vision_wards_bought),
    ts: "controlWardsPlaced = stats.sightWardsBoughtInGame ?? null（已废弃字段，原始 LCU 战绩里恒为 0）",
    rust: "controlWardsPlaced = stats.visionWardsBoughtInGame（真眼购买数）；app 的 Game 不带该字段时仍为 null",
    reason: "回归局 A/B 共 20 人 sightWardsBoughtInGame 全为 0；visionWardsBoughtInGame 16 人非 0，\
             20 人中 16 人与时间线 ITEM_PURCHASED itemId 2055（真眼）次数相等，不等的 4 人都是辅助位且 LCU 数更大。\
             快照字段不进评分（评分的真眼指标取时间线 WARD_PLACED）",
    test: "snapshot::tests::should_read_control_wards_from_vision_wards_bought, \
           parity::tests::should_require_control_wards_to_match_rust_vision_wards_bought, \
           parity::tests::should_flag_control_ward_mutation_outside_predicate, \
           parity::tests::should_match_ts_golden_regression_a, \
           parity::tests::should_match_ts_golden_regression_b, \
           parity::tests::should_match_ts_golden_regression_a_queue_400, \
           parity::tests::should_match_ts_golden_regression_a_missing_names",
    affects_score: false,
}, ExpectedDiff {
    id: "P1-F4",
    paths: &[
        "snapshot.players[*].name",
        "snapshot.teams[*].players[*].name",
        "snapshot.players[*].vsLaneOpponent.opponentName",
        "snapshot.teams[*].players[*].vsLaneOpponent.opponentName",
    ],
    queues: &[],
    when: Some(f4_display_name_fallback),
    ts: "`${gameName}#${tagLine}`：缺字段拼出 \"undefined#undefined\" / \"甲#undefined\"，缺 player 抛错",
    rust: "gameName#tagLine → gameName → summonerName → 未知玩家（空串视同缺失）；缺整条身份仍为 玩家<pid>；\
           本人键 currentPlayerKey 用同一规则",
    reason: "显示名会进 AI 提示词与界面，不能出现 undefined。只有缺名局会出差异（真实国服数据极少）。\
             isMe 不登记：有 puuid 时按 puuid 判定、与显示名无关；无 puuid 时本人键与显示名同规则，\
             isMe 若因此变化会作为登记表外差异暴露",
    test: "input::tests::should_build_display_name_with_fallbacks, \
           input::tests::should_name_missing_player_and_missing_identity, \
           input::tests::should_mark_me_when_tag_line_missing, \
           parity::tests::should_accept_only_rule_shaped_display_name_fallbacks, \
           parity::tests::should_match_ts_golden_regression_a_missing_names, \
           parity::tests::should_match_ts_golden_regression_a_app_blank_names",
    affects_score: false,
}];

/// 差异示例里该路径的取值是否含个人信息（名字 / puuid），须脱敏后再打印
///
/// 命中规则：路径以 `.name` / `.opponentName` 结尾，或最后一段（去掉下标）含 `Name` / `puuid`（不分大小写）
pub fn is_sensitive_path(path: &str) -> bool {
    let last = path.rsplit('.').next().unwrap_or(path);
    let last = last.split('[').next().unwrap_or(last).to_lowercase();
    path.ends_with(".name")
        || path.ends_with(".opponentName")
        || last.contains("name")
        || last.contains("puuid")
}

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

/// 在给定登记表里找放行 `queue_id` 局 `path` 处取值为 `values` 的差异的条目（测试可传自建表）
pub fn find_expected_in(
    registry: &'static [ExpectedDiff],
    path: &str,
    queue_id: i64,
    values: &DiffValues<'_>,
) -> Option<&'static ExpectedDiff> {
    registry.iter().find(|d| d.covers(path, queue_id, values))
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
/// 名称表完全取自黄金（`championNames` / `spellNames` / `spellFallback`），不用 Rust 内置表；
/// `me_puuid` 取输入里的战绩查询对象（[`LcuGame::queried_puuid`]，即 app 调用方将传入的值），
/// 不看 TS 结果，所以 isMe 的任何分歧都会以登记表外差异暴露。
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

    let match_input = from_lcu(&game, slim.as_ref(), &names, game.queried_puuid());
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
    let roots = [("snapshot", &snapshot), ("remappedTimeline", &remapped)];
    for d in &mut diffs {
        let values = DiffValues {
            expected: &d.expected,
            actual: &d.actual,
            actual_parent: parent_of(&roots, &d.path),
        };
        d.registered =
            find_expected_in(EXPECTED_DIFFS, &d.path, game.queue_id, &values).map(|e| e.id);
    }
    Ok(GoldenReport { name, diffs })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GOLDEN_A: &str = include_str!("../../tests/fixtures/parity/regression-a.golden.json");
    const GOLDEN_B: &str = include_str!("../../tests/fixtures/parity/regression-b.golden.json");
    /// 回归局 A 的变体（`game.queueId` 420 → 400），TS 实生成
    const GOLDEN_A_Q400: &str =
        include_str!("../../tests/fixtures/parity/regression-a-q400.golden.json");
    /// 回归局 A 的变体（gameDetail 身份：pid 3 删 tagLine；pid 7 删 gameName/tagLine、
    /// 加 summonerName；pid 8 名字全删），TS 实生成
    const GOLDEN_A_NAMES: &str =
        include_str!("../../tests/fixtures/parity/regression-a-missing-names.golden.json");
    /// 回归局 A 的 app 形状变体：经 app `Game` serde 往返（与本人语料同形，名字字段是 String），
    /// 再把 gameDetail 身份 pid 3 的 tagLine、pid 7 的 gameName/tagLine（另设 summonerName）、
    /// pid 8 的 gameName/summonerName 置为空串，TS 实生成
    const GOLDEN_A_APP_NAMES: &str =
        include_str!("../../tests/fixtures/parity/regression-a-app-blank-names.golden.json");

    fn diffs(expected: Value, actual: Value) -> Vec<Diff> {
        let mut out = Vec::new();
        diff_json("root", &expected, &actual, &mut out);
        out
    }

    #[test]
    fn should_redact_name_and_puuid_paths_only() {
        for p in [
            "snapshot.players[3].name",
            "snapshot.teams[0].players[1].vsLaneOpponent.opponentName",
            "snapshot.players[0].summonerName",
            "snapshot.players[0].puuid",
            "snapshot.me.PUUID",
            "snapshot.currentPlayerKey.gameName",
        ] {
            assert!(is_sensitive_path(p), "{p} 应脱敏");
        }
        for p in [
            "snapshot.players[3].teamPosition",
            "snapshot.players[0].kills",
            "snapshot.players[0].controlWardsPlaced",
        ] {
            assert!(!is_sensitive_path(p), "{p} 不应脱敏");
        }
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

    /// 无父对象的取值（自建表测试用）
    fn vals<'a>(expected: &'a Value, actual: &'a Value) -> DiffValues<'a> {
        DiffValues {
            expected,
            actual,
            actual_parent: None,
        }
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
            when: None,
            ts: "ts",
            rust: "rust",
            reason: "测试",
            test: "should_find_registered_diff_in_custom_registry",
            affects_score: false,
        }];
        let (e, a) = (json!(1), json!(2));
        let find =
            |path: &str, q: i64| find_expected_in(REGISTRY, path, q, &vals(&e, &a)).map(|d| d.id);
        assert_eq!(find("snapshot.players[7].kda", 420), Some("T-1"));
        assert_eq!(find("snapshot.teams[1].players[2].kda", 450), Some("T-1"));
        assert!(find("snapshot.players[7].gold", 420).is_none());
    }

    #[test]
    fn should_only_cover_listed_queues() {
        const REGISTRY: &[ExpectedDiff] = &[ExpectedDiff {
            id: "T-2",
            paths: &["snapshot.modeContext.hasLanes"],
            queues: &[400],
            when: None,
            ts: "ts",
            rust: "rust",
            reason: "测试",
            test: "should_only_cover_listed_queues",
            affects_score: false,
        }];
        let (f, t) = (json!(false), json!(true));
        let path = "snapshot.modeContext.hasLanes";
        assert!(find_expected_in(REGISTRY, path, 400, &vals(&f, &t)).is_some());
        assert!(find_expected_in(REGISTRY, path, 420, &vals(&f, &t)).is_none());
    }

    #[test]
    fn should_not_register_when_value_predicate_fails() {
        fn ts_is_zero(v: &DiffValues<'_>) -> bool {
            v.expected.as_f64() == Some(0.0)
        }
        const REGISTRY: &[ExpectedDiff] = &[ExpectedDiff {
            id: "T-3",
            paths: &["snapshot.players[*].kda"],
            queues: &[],
            when: Some(ts_is_zero),
            ts: "ts",
            rust: "rust",
            reason: "测试",
            test: "should_not_register_when_value_predicate_fails",
            affects_score: false,
        }];
        let path = "snapshot.players[0].kda";
        let (zero, two, three) = (json!(0), json!(2), json!(3));
        assert!(find_expected_in(REGISTRY, path, 420, &vals(&zero, &three)).is_some());
        assert!(find_expected_in(REGISTRY, path, 420, &vals(&two, &three)).is_none());
    }

    /// 用真实登记表判一处差异；`parent` 为 Rust 输出里该字段所在对象
    fn registered_as(
        path: &str,
        e: Value,
        a: Value,
        parent: Option<Value>,
    ) -> Option<&'static str> {
        let values = DiffValues {
            expected: &e,
            actual: &a,
            actual_parent: parent.as_ref(),
        };
        find_expected_in(EXPECTED_DIFFS, path, 420, &values).map(|d| d.id)
    }

    #[test]
    fn should_require_control_wards_to_match_rust_vision_wards_bought() {
        let cw = "snapshot.players[1].controlWardsPlaced";
        let player =
            |vwb: Value| Some(json!({ "controlWardsPlaced": 3, "visionWardsBought": vwb }));
        assert_eq!(
            registered_as(cw, json!(0), json!(3), player(json!(3))),
            Some("P1-F3")
        );
        assert_eq!(
            registered_as(cw, Value::Null, json!(3), player(json!(3))),
            Some("P1-F3")
        );
        // Rust 值与同一玩家的 visionWardsBought 不等 → 登记表外
        assert_eq!(
            registered_as(cw, json!(0), json!(3), player(json!(4))),
            None
        );
        assert_eq!(
            registered_as(cw, json!(0), json!(3), player(Value::Null)),
            None
        );
        assert_eq!(registered_as(cw, json!(0), json!(3), None), None);
        // TS 不是 0 / null，或 Rust 不是数字 → 登记表外
        assert_eq!(
            registered_as(cw, json!(2), json!(3), player(json!(3))),
            None
        );
        assert_eq!(
            registered_as(cw, json!(0), Value::Null, player(Value::Null)),
            None
        );
    }

    #[test]
    fn should_accept_only_rule_shaped_display_name_fallbacks() {
        for path in [
            "snapshot.teams[0].players[1].name",
            "snapshot.players[2].vsLaneOpponent.opponentName",
        ] {
            let f4 = |e: &str, a: &str| registered_as(path, json!(e), json!(a), None);
            // g# / g#undefined → Rust 恰为 g
            assert_eq!(f4("丙#", "丙"), Some("P1-F4"));
            assert_eq!(f4("甲#undefined", "甲"), Some("P1-F4"));
            // #… / undefined#… → summonerName / 未知玩家（无 # 无 undefined）
            assert_eq!(f4("#", "未知玩家"), Some("P1-F4"));
            assert_eq!(f4("#9", "旧召唤师名"), Some("P1-F4"));
            assert_eq!(f4("undefined#undefined", "未知玩家"), Some("P1-F4"));
            assert_eq!(f4("undefined#9", "旧名"), Some("P1-F4"));
            // Rust 值不对
            assert_eq!(f4("丙#", "丁"), None);
            assert_eq!(f4("甲#undefined", "甲#undefined"), None);
            // Rust 值带 # / undefined
            assert_eq!(f4("#9", "某#9"), None);
            assert_eq!(f4("undefined#undefined", "undefined"), None);
            // 真实名字里含 undefined，不是缺字段
            assert_eq!(f4("myundefined#1", "myundefined"), None);
            assert_eq!(f4("甲#undefinedX", "甲"), None);
            // 两段都齐全的普通改名
            assert_eq!(f4("甲#1", "乙#1"), None);
            assert_eq!(f4("甲#1", "甲"), None);
        }
    }

    #[test]
    fn should_resolve_parent_of_diff_path() {
        let snap = json!({ "players": [{ "a": 1 }, { "a": 2, "o": { "b": 3 } }] });
        let tl = json!({ "frames": [] });
        let roots = [("snapshot", &snap), ("remappedTimeline", &tl)];
        assert_eq!(
            parent_of(&roots, "snapshot.players[1].a"),
            Some(&snap["players"][1])
        );
        assert_eq!(
            parent_of(&roots, "snapshot.players[1].o.b"),
            Some(&snap["players"][1]["o"])
        );
        assert_eq!(
            parent_of(&roots, "remappedTimeline.frames.length"),
            Some(&tl["frames"])
        );
        assert_eq!(parent_of(&roots, "snapshot.players[9].a"), None);
        assert_eq!(parent_of(&roots, "other.x"), None);
    }

    #[test]
    fn should_flag_control_ward_mutation_outside_predicate() {
        let paths = mutated_paths(|e| {
            e["snapshot"]["players"][1]["controlWardsPlaced"] = Value::from(7);
        });
        assert_eq!(paths, vec!["snapshot.players[1].controlWardsPlaced"]);
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
    fn should_flag_flipped_is_me_as_unregistered() {
        for idx in [0usize, 3] {
            let paths = mutated_paths(|e| {
                let v = &mut e["snapshot"]["players"][idx]["isMe"];
                *v = Value::Bool(!v.as_bool().unwrap());
            });
            assert_eq!(paths, vec![format!("snapshot.players[{idx}].isMe")]);
        }
    }

    #[test]
    fn should_derive_me_puuid_from_queried_player_not_ts_output() {
        let golden: Value = serde_json::from_str(GOLDEN_A).unwrap();
        let game: LcuGame = serde_json::from_value(golden["input"]["game"].clone()).unwrap();
        let me = game.queried_puuid().expect("回归局 A 顶层身份有 puuid");
        let input = from_lcu(&game, None, &NameTable::default(), Some(me));
        let me_pids: Vec<i64> = input
            .players
            .iter()
            .filter(|p| p.is_me)
            .map(|p| p.participant_id)
            .collect();
        assert_eq!(me_pids, vec![4]);
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

    /// 登记表外为 0，且登记内差异按编号计数恰好等于 `pinned`（防止登记项悄悄多放行或修复失效）
    fn assert_registered_exactly(text: &str, pinned: &[(&str, usize)]) {
        assert_golden_clean(text);
        let golden: Value = serde_json::from_str(text).unwrap();
        let report = check_golden(&golden).unwrap();
        let mut got: std::collections::BTreeMap<&str, usize> = Default::default();
        for d in &report.diffs {
            *got.entry(d.registered.unwrap()).or_default() += 1;
        }
        let want: std::collections::BTreeMap<&str, usize> = pinned.iter().copied().collect();
        assert_eq!(got, want, "{} 的登记内差异与钉住的不符", report.name);
    }

    #[test]
    fn should_match_ts_golden_regression_a() {
        assert_registered_exactly(GOLDEN_A, &[("P1-F3", 16)]);
    }

    #[test]
    fn should_match_ts_golden_regression_b() {
        assert_registered_exactly(GOLDEN_B, &[("P1-F3", 16)]);
    }

    /// 回归局 A 改 queueId=400 后由 TS 实生成的黄金：F1 全部生效
    #[test]
    fn should_match_ts_golden_regression_a_queue_400() {
        assert_registered_exactly(GOLDEN_A_Q400, &[("P1-F1", 32), ("P1-F3", 16)]);
    }

    /// 回归局 A 删掉三名玩家的部分名字字段后由 TS 实生成的黄金：F4 全部生效
    /// app 形状、空串名字：TS 拼出 "玩家3#"、"#"、"#0000"；app Stats 无视野字段，F3 不出现
    #[test]
    fn should_match_ts_golden_regression_a_app_blank_names() {
        assert_registered_exactly(GOLDEN_A_APP_NAMES, &[("P1-F4", 12)]);
    }

    #[test]
    fn should_match_ts_golden_regression_a_missing_names() {
        assert_registered_exactly(GOLDEN_A_NAMES, &[("P1-F3", 16), ("P1-F4", 12)]);
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
