# Pick/Ban 规则引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an IF-condition-THEN-pick/ban rules engine on top of the existing simple priority list, so users can express position-aware and team-composition-aware automation. Falls back to the existing list when no rule matches.

**Architecture:** Pure-functional Rust evaluator (`rule_engine.rs`) reads `pickRules` / `banRules` from the existing YAML config, walks rules in user order, and returns the first applicable action (champion + lock flag). Wired into the existing `start_select_champion` / `start_ban_champion` polling loops in `automation.rs`; old `pickChampionSlice` / `banChampionSlice` simple-list logic kept verbatim as fallback. Frontend adds a flat-AND rule editor (`RuleEditModal.vue`) above the existing list UI in `Automation.vue`; rules CRUD goes through the existing `put_config` / `get_config` Tauri commands (no new commands).

**Tech Stack:** Rust (Tauri 2.0, serde, tokio), Vue 3 + TypeScript, Naive UI, Vitest.

---

## File Structure

**New files:**
- `lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs` — data types for rules (PickRule, BanRule, RuleCondition, PickAction, BanAction, Position)
- `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs` — pure evaluator + position detection
- `lol-record-analysis-tauri/src-tauri/src/rule_engine_tests.rs` — Rust unit tests
- `lol-record-analysis-tauri/src/types/rules.ts` — TS mirror of Rust types
- `lol-record-analysis-tauri/src/composables/useRules.ts` — frontend CRUD wrapper
- `lol-record-analysis-tauri/src/components/automation/RuleConditionRow.vue` — single-condition editor row
- `lol-record-analysis-tauri/src/components/automation/RuleEditModal.vue` — full rule editor modal
- `lol-record-analysis-tauri/src/components/automation/__tests__/RuleEditModal.spec.ts` — component test

**Modified files:**
- `lol-record-analysis-tauri/src-tauri/src/lcu/api/champion_select.rs` — extend `SelectSession` with `their_team`, extend `OnePlayer` with `assigned_position`
- `lol-record-analysis-tauri/src-tauri/src/automation.rs` — read `pickRules` / `banRules` from config, evaluate before falling back to existing slice logic
- `lol-record-analysis-tauri/src-tauri/src/lib.rs` — register `rule_engine` module (and `rule_config` if not auto-discovered)
- `lol-record-analysis-tauri/src/views/settings/Automation.vue` — embed rule list + edit button above each existing list

**Out of scope for this plan (separate plan):** AI tag suggestion (Feature 2 from spec).

---

## Task 1: Extend SelectSession schema with `their_team` and `assigned_position`

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/lcu/api/champion_select.rs:14-54`

**Why:** Current Rust `SelectSession` only deserializes `my_team` and skips `theirTeam` from the LCU response; `OnePlayer` lacks `assignedPosition`. The rule engine needs both.

- [ ] **Step 1: Add a unit test that deserializes a sample LCU JSON and reads the new fields**

Add at the bottom of `champion_select.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_deserialize_their_team_and_assigned_position() {
        let raw = r#"{
            "myTeam": [{"championId": 1, "puuid": "p1", "assignedPosition": "middle"}],
            "theirTeam": [{"championId": 2, "puuid": "p2", "assignedPosition": ""}],
            "actions": [],
            "timer": {},
            "localPlayerCellId": 0
        }"#;
        let s: SelectSession = serde_json::from_str(raw).unwrap();
        assert_eq!(s.their_team.len(), 1);
        assert_eq!(s.their_team[0].champion_id, 2);
        assert_eq!(s.my_team[0].assigned_position, "middle");
        assert_eq!(s.their_team[0].assigned_position, "");
    }
}
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd lol-record-analysis-tauri/src-tauri
cargo test -p lol-record-analysis-app should_deserialize_their_team_and_assigned_position
```

Expected: compilation error (`their_team` field not found / `assigned_position` field not found).

- [ ] **Step 3: Extend `SelectSession` and `OnePlayer`**

In `champion_select.rs`, change:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectSession {
    pub my_team: Vec<OnePlayer>,
    #[serde(default)]
    pub their_team: Vec<OnePlayer>,
    pub actions: Vec<Vec<Action>>,
    pub timer: Timer,
    pub local_player_cell_id: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OnePlayer {
    pub champion_id: i32,
    pub puuid: String,
    #[serde(default)]
    pub assigned_position: String,
}
```

`#[serde(default)]` keeps backward compatibility with any existing fixtures or cached JSON missing these fields.

- [ ] **Step 4: Re-run test to confirm it passes**

```bash
cargo test -p lol-record-analysis-app should_deserialize_their_team_and_assigned_position
```

Expected: PASS.

- [ ] **Step 5: Run the rest of the existing test suite to confirm no regressions**

```bash
cargo test -p lol-record-analysis-app
```

Expected: all pre-existing tests still pass (default values cover the missing field).

- [ ] **Step 6: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/lcu/api/champion_select.rs
git commit -m "feat: 扩展 SelectSession 增加 their_team 和 assigned_position 字段"
```

---

## Task 2: Define `Position` and `RuleCondition` types

**Files:**
- Create: `lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs`

- [ ] **Step 1: Write a test for serde round-trip of every condition variant**

Create the file with:

```rust
//! 规则引擎使用的数据类型：位置、条件、动作、规则。
//!
//! 与前端 `src/types/rules.ts` 保持同构。

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    Top,
    Jungle,
    Middle,
    Bottom,
    Utility,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RuleCondition {
    Position { value: Position },
    AllyChampionsContains { ids: Vec<i64> },
    AllyChampionsNotContains { ids: Vec<i64> },
    EnemyChampionsContains { ids: Vec<i64> },
    EnemyChampionsNotContains { ids: Vec<i64> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_round_trip() {
        let p = Position::Middle;
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(s, r#""middle""#);
        let back: Position = serde_json::from_str(&s).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn condition_position_round_trip() {
        let c = RuleCondition::Position { value: Position::Top };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains(r#""type":"Position""#));
        let back: RuleCondition = serde_json::from_str(&s).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_ally_contains_round_trip() {
        let c = RuleCondition::AllyChampionsContains { ids: vec![157, 99] };
        let back: RuleCondition = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_enemy_not_contains_round_trip() {
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![89] };
        let back: RuleCondition = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
}
```

- [ ] **Step 2: Register the new module in `command/mod.rs`**

Open `lol-record-analysis-tauri/src-tauri/src/command/mod.rs` and add to the `pub mod` list (alphabetical):

```rust
pub mod rule_config;
```

(If the file uses a different layout, follow that layout; the goal is `crate::command::rule_config` becomes importable.)

- [ ] **Step 3: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_config::tests
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs lol-record-analysis-tauri/src-tauri/src/command/mod.rs
git commit -m "feat: 增加 rule_config 模块（Position + RuleCondition）"
```

---

## Task 3: Define `PickAction`, `BanAction`, `PickRule`, `BanRule`

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs`

- [ ] **Step 1: Add tests for action and rule round-trip**

Append to the `tests` module:

```rust
#[test]
fn pick_action_round_trip() {
    let a = PickAction { champion_id: 157, lock: true };
    let s = serde_json::to_string(&a).unwrap();
    let back: PickAction = serde_json::from_str(&s).unwrap();
    assert_eq!(back.champion_id, 157);
    assert!(back.lock);
}

#[test]
fn ban_action_round_trip() {
    let a = BanAction { champion_id: 89 };
    let s = serde_json::to_string(&a).unwrap();
    let back: BanAction = serde_json::from_str(&s).unwrap();
    assert_eq!(back.champion_id, 89);
}

#[test]
fn pick_rule_round_trip_full() {
    let r = PickRule {
        id: "r1".to_string(),
        name: "中路防刺客".to_string(),
        enabled: true,
        conditions: vec![
            RuleCondition::Position { value: Position::Middle },
            RuleCondition::EnemyChampionsContains { ids: vec![238] },
        ],
        action: PickAction { champion_id: 1, lock: false },
    };
    let s = serde_json::to_string(&r).unwrap();
    let back: PickRule = serde_json::from_str(&s).unwrap();
    assert_eq!(back, r);
}

#[test]
fn ban_rule_serializes_without_lock_field() {
    let r = BanRule {
        id: "b1".to_string(),
        name: "克制 ADC".to_string(),
        enabled: true,
        conditions: vec![RuleCondition::Position { value: Position::Bottom }],
        action: BanAction { champion_id: 89 },
    };
    let s = serde_json::to_string(&r).unwrap();
    assert!(!s.contains("lock"), "BanAction must not serialize a lock field, got: {s}");
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_config::tests
```

Expected: 4 new tests fail (types undefined).

- [ ] **Step 3: Add the type definitions**

Append to `rule_config.rs` above the test module:

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PickAction {
    pub champion_id: i64,
    pub lock: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BanAction {
    pub champion_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PickBanRule<A> {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub conditions: Vec<RuleCondition>,
    pub action: A,
}

pub type PickRule = PickBanRule<PickAction>;
pub type BanRule = PickBanRule<BanAction>;
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_config::tests
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/command/rule_config.rs
git commit -m "feat: 增加 PickAction/BanAction + PickRule/BanRule 类型"
```

---

## Task 4: Helper `detect_my_position`

**Files:**
- Create: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`
- Modify: `lol-record-analysis-tauri/src-tauri/src/lib.rs` (add `pub mod rule_engine;`)

- [ ] **Step 1: Add helper test fixtures + first test**

Create `rule_engine.rs`:

```rust
//! 规则引擎：纯函数式条件求值与规则遍历。
//!
//! 输入：当前选人会话 + 当前用户位置 + 用户配置的规则列表。
//! 输出：第一条命中且目标可执行的 action（或 None）。

use crate::command::rule_config::{
    BanAction, BanRule, PickAction, PickRule, Position, RuleCondition,
};
use crate::lcu::api::champion_select::{OnePlayer, SelectSession};

/// 从选人会话中找到当前用户，读取其 `assigned_position` 并映射到 `Position`。
///
/// 大乱斗 / 普通匹配等 `assignedPosition == ""` 的场景返回 `None`，
/// 此时 `Position` 条件永远不匹配（按设计）。
pub fn detect_my_position(session: &SelectSession, my_puuid: &str) -> Option<Position> {
    let me = session.my_team.iter().find(|p| p.puuid == my_puuid)?;
    parse_position(&me.assigned_position)
}

fn parse_position(s: &str) -> Option<Position> {
    match s.to_ascii_lowercase().as_str() {
        "top"      => Some(Position::Top),
        "jungle"   => Some(Position::Jungle),
        "middle"   => Some(Position::Middle),
        "bottom"   => Some(Position::Bottom),
        "utility"  => Some(Position::Utility),
        _          => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(my_team: Vec<OnePlayer>) -> SelectSession {
        SelectSession {
            my_team,
            their_team: vec![],
            actions: vec![],
            timer: Default::default(),
            local_player_cell_id: 0,
        }
    }

    fn player(puuid: &str, position: &str) -> OnePlayer {
        OnePlayer {
            champion_id: 0,
            puuid: puuid.to_string(),
            assigned_position: position.to_string(),
        }
    }

    #[test]
    fn detect_my_position_when_assigned() {
        let s = make_session(vec![player("me", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Middle));
    }

    #[test]
    fn detect_my_position_returns_none_for_empty_assigned() {
        let s = make_session(vec![player("me", "")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_returns_none_when_puuid_not_found() {
        let s = make_session(vec![player("other", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_handles_uppercase_lcu_strings() {
        let s = make_session(vec![player("me", "JUNGLE")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Jungle));
    }
}
```

- [ ] **Step 2: Register the module**

In `lol-record-analysis-tauri/src-tauri/src/lib.rs`, add (alphabetical with the other `pub mod` lines):

```rust
pub mod rule_engine;
```

- [ ] **Step 3: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs lol-record-analysis-tauri/src-tauri/src/lib.rs
git commit -m "feat: rule_engine 增加 detect_my_position 辅助"
```

---

## Task 5: Position condition matcher

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`

- [ ] **Step 1: Write tests for `match_condition` covering Position variants**

Append to the `tests` module:

```rust
#[test]
fn position_matches_when_equal() {
    let s = make_session(vec![]);
    let c = RuleCondition::Position { value: Position::Middle };
    assert!(match_condition(&c, &s, Some(Position::Middle)));
}

#[test]
fn position_does_not_match_when_different() {
    let s = make_session(vec![]);
    let c = RuleCondition::Position { value: Position::Middle };
    assert!(!match_condition(&c, &s, Some(Position::Top)));
}

#[test]
fn position_does_not_match_when_none() {
    let s = make_session(vec![]);
    let c = RuleCondition::Position { value: Position::Middle };
    assert!(!match_condition(&c, &s, None));
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::position_
```

Expected: compilation error (`match_condition` undefined).

- [ ] **Step 3: Implement `match_condition` with the Position arm**

Add above the `tests` module:

```rust
/// Evaluate a single condition. Other variants are added in subsequent tasks.
pub fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        // remaining variants added in later tasks
        _ => false,
    }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::position_
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs
git commit -m "feat: rule_engine 实现 Position 条件求值"
```

---

## Task 6: AllyChampions{Contains,NotContains} matchers

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`

- [ ] **Step 1: Write tests**

Append to `tests`:

```rust
fn ally_champ(champion_id: i32) -> OnePlayer {
    OnePlayer {
        champion_id,
        puuid: "x".to_string(),
        assigned_position: "".to_string(),
    }
}

#[test]
fn ally_contains_matches_when_at_least_one_ally_has_id() {
    let s = make_session(vec![ally_champ(1), ally_champ(157)]);
    let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
    assert!(match_condition(&c, &s, None));
}

#[test]
fn ally_contains_counts_hovered_champion() {
    // championId != 0 means hovered or locked — both count.
    let s = make_session(vec![ally_champ(238)]);
    let c = RuleCondition::AllyChampionsContains { ids: vec![238] };
    assert!(match_condition(&c, &s, None));
}

#[test]
fn ally_contains_ignores_zero_champion_id() {
    // championId == 0 means "no hover yet" — should NOT match.
    let s = make_session(vec![ally_champ(0)]);
    let c = RuleCondition::AllyChampionsContains { ids: vec![0] };
    assert!(!match_condition(&c, &s, None));
}

#[test]
fn ally_contains_does_not_match_when_no_ally_has_id() {
    let s = make_session(vec![ally_champ(1), ally_champ(2)]);
    let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
    assert!(!match_condition(&c, &s, None));
}

#[test]
fn ally_not_contains_matches_when_team_is_clean() {
    let s = make_session(vec![ally_champ(1), ally_champ(2)]);
    let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
    assert!(match_condition(&c, &s, None));
}

#[test]
fn ally_not_contains_does_not_match_when_one_present() {
    let s = make_session(vec![ally_champ(157)]);
    let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
    assert!(!match_condition(&c, &s, None));
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::ally_
```

Expected: tests fail (the wildcard arm returns `false`).

- [ ] **Step 3: Implement AllyChampions arms**

Replace `match_condition` with:

```rust
pub fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        RuleCondition::AllyChampionsContains { ids } => {
            team_has_any(&session.my_team, ids)
        }
        RuleCondition::AllyChampionsNotContains { ids } => {
            !team_has_any(&session.my_team, ids)
        }
        // EnemyChampions* added in next task
        _ => false,
    }
}

fn team_has_any(team: &[OnePlayer], ids: &[i64]) -> bool {
    team.iter().any(|p| {
        let cid = p.champion_id as i64;
        cid != 0 && ids.contains(&cid)
    })
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::ally_
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs
git commit -m "feat: rule_engine 实现 AllyChampions 条件（含取反）"
```

---

## Task 7: EnemyChampions{Contains,NotContains} matchers

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`

- [ ] **Step 1: Write tests**

Append:

```rust
fn enemy_champ(champion_id: i32) -> OnePlayer {
    OnePlayer {
        champion_id,
        puuid: "y".to_string(),
        assigned_position: "".to_string(),
    }
}

fn make_session_with_enemies(my_team: Vec<OnePlayer>, their_team: Vec<OnePlayer>) -> SelectSession {
    SelectSession {
        my_team,
        their_team,
        actions: vec![],
        timer: Default::default(),
        local_player_cell_id: 0,
    }
}

#[test]
fn enemy_contains_matches_when_visible() {
    let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
    let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
    assert!(match_condition(&c, &s, None));
}

#[test]
fn enemy_contains_does_not_match_during_ban_phase() {
    // During ban phase, enemy championIds are 0 — condition naturally never matches.
    let s = make_session_with_enemies(vec![], vec![enemy_champ(0), enemy_champ(0)]);
    let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
    assert!(!match_condition(&c, &s, None));
}

#[test]
fn enemy_not_contains_matches_when_clean() {
    let s = make_session_with_enemies(vec![], vec![enemy_champ(1)]);
    let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
    assert!(match_condition(&c, &s, None));
}

#[test]
fn enemy_not_contains_does_not_match_when_one_present() {
    let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
    let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
    assert!(!match_condition(&c, &s, None));
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::enemy_
```

Expected: tests fail.

- [ ] **Step 3: Implement EnemyChampions arms**

Replace `match_condition`'s wildcard with explicit arms:

```rust
pub fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        RuleCondition::AllyChampionsContains { ids } => team_has_any(&session.my_team, ids),
        RuleCondition::AllyChampionsNotContains { ids } => !team_has_any(&session.my_team, ids),
        RuleCondition::EnemyChampionsContains { ids } => team_has_any(&session.their_team, ids),
        RuleCondition::EnemyChampionsNotContains { ids } => !team_has_any(&session.their_team, ids),
    }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests
```

Expected: all condition tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs
git commit -m "feat: rule_engine 实现 EnemyChampions 条件（含取反）"
```

---

## Task 8: `evaluate_pick` rule walker

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`

**Semantics (locked in spec §2):**
- Walk rules in order; skip if `enabled == false`; skip if any condition fails.
- All conditions match AND target champion is still pickable (not banned by anyone, not picked/hovered by an ally other than self) → return that action.
- If target unavailable → skip to next rule (best-effort policy from brainstorming Q).
- No rule fits → return `None`, caller falls back to existing slice logic.

- [ ] **Step 1: Write tests**

Append to `tests`:

```rust
fn pick_rule(id: &str, conds: Vec<RuleCondition>, target: i64, lock: bool, enabled: bool) -> PickRule {
    PickRule {
        id: id.to_string(),
        name: id.to_string(),
        enabled,
        conditions: conds,
        action: PickAction { champion_id: target, lock },
    }
}

fn session_with_picks_and_bans(
    my_team: Vec<OnePlayer>,
    their_team: Vec<OnePlayer>,
    actions: Vec<Vec<crate::lcu::api::champion_select::Action>>,
) -> SelectSession {
    SelectSession {
        my_team,
        their_team,
        actions,
        timer: Default::default(),
        local_player_cell_id: 0,
    }
}

#[test]
fn evaluate_pick_returns_first_matching_rule() {
    let s = make_session(vec![player("me", "middle")]);
    let rules = vec![
        pick_rule("r1", vec![RuleCondition::Position { value: Position::Top }], 1, true, true),
        pick_rule("r2", vec![RuleCondition::Position { value: Position::Middle }], 99, true, true),
    ];
    let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 99);
}

#[test]
fn evaluate_pick_skips_disabled_rule() {
    let s = make_session(vec![player("me", "middle")]);
    let rules = vec![
        pick_rule("r1", vec![RuleCondition::Position { value: Position::Middle }], 1, true, false),
        pick_rule("r2", vec![RuleCondition::Position { value: Position::Middle }], 2, true, true),
    ];
    let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 2);
}

#[test]
fn evaluate_pick_returns_none_when_no_rule_fits() {
    let s = make_session(vec![player("me", "middle")]);
    let rules = vec![pick_rule("r1", vec![RuleCondition::Position { value: Position::Top }], 1, true, true)];
    assert!(evaluate_pick(&s, Some(Position::Middle), &rules).is_none());
}

#[test]
fn evaluate_pick_returns_none_when_rules_empty() {
    let s = make_session(vec![]);
    assert!(evaluate_pick(&s, None, &[]).is_none());
}

#[test]
fn evaluate_pick_skips_rule_when_target_already_banned() {
    // Build an action where champion 99 was banned by another cell.
    use crate::lcu::api::champion_select::Action;
    let banned = Action {
        actor_cell_id: 7, // not me (my cell is 0)
        id: 1,
        champion_id: 99,
        completed: true,
        is_ally_action: false,
        is_in_progress: false,
        action_type: "ban".to_string(),
    };
    let s = session_with_picks_and_bans(
        vec![player("me", "middle")],
        vec![],
        vec![vec![banned]],
    );
    let rules = vec![
        pick_rule("r1", vec![RuleCondition::Position { value: Position::Middle }], 99, true, true),
        pick_rule("r2", vec![RuleCondition::Position { value: Position::Middle }], 100, true, true),
    ];
    let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 100);
}

#[test]
fn evaluate_pick_skips_rule_when_target_picked_by_ally() {
    use crate::lcu::api::champion_select::Action;
    let ally_pick = Action {
        actor_cell_id: 7,
        id: 2,
        champion_id: 99,
        completed: false,
        is_ally_action: true,
        is_in_progress: false,
        action_type: "pick".to_string(),
    };
    let s = session_with_picks_and_bans(
        vec![player("me", "middle")],
        vec![],
        vec![vec![ally_pick]],
    );
    let rules = vec![
        pick_rule("r1", vec![RuleCondition::Position { value: Position::Middle }], 99, true, true),
        pick_rule("r2", vec![RuleCondition::Position { value: Position::Middle }], 100, true, true),
    ];
    let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 100);
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::evaluate_pick_
```

Expected: compile errors (`evaluate_pick` undefined, helpers undefined).

- [ ] **Step 3: Implement `evaluate_pick` and supporting helpers**

Append to `rule_engine.rs`:

```rust
/// Walk rules in order; return the first action whose conditions all match
/// AND whose target champion is still pickable.
///
/// "Pickable" = not banned by anyone (completed ban) and not already
/// hover/picked by another cell. The local player's own past hover does
/// not block re-picking the same champion.
pub fn evaluate_pick<'a>(
    session: &SelectSession,
    my_position: Option<Position>,
    rules: &'a [PickRule],
) -> Option<&'a PickAction> {
    let unavailable = unavailable_champion_ids(session);

    for rule in rules.iter().filter(|r| r.enabled) {
        let all_match = rule
            .conditions
            .iter()
            .all(|c| match_condition(c, session, my_position));
        if !all_match {
            continue;
        }
        if !unavailable.contains(&rule.action.champion_id) {
            return Some(&rule.action);
        }
    }
    None
}

/// Set of champion IDs we cannot pick or ban: banned by anyone (completed),
/// or hovered/picked by another cell.
fn unavailable_champion_ids(session: &SelectSession) -> std::collections::HashSet<i64> {
    let my_cell = session.local_player_cell_id;
    let mut unavailable = std::collections::HashSet::new();

    for group in &session.actions {
        for a in group {
            if a.action_type == "ban" && a.completed {
                unavailable.insert(a.champion_id as i64);
            }
            if a.action_type == "pick" && a.actor_cell_id != my_cell && a.champion_id != 0 {
                unavailable.insert(a.champion_id as i64);
            }
        }
    }
    unavailable
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::evaluate_pick_
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs
git commit -m "feat: rule_engine 实现 evaluate_pick + 目标可用性检查"
```

---

## Task 9: `evaluate_ban` rule walker

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/rule_engine.rs`

- [ ] **Step 1: Write tests**

Append:

```rust
fn ban_rule(id: &str, conds: Vec<RuleCondition>, target: i64, enabled: bool) -> BanRule {
    BanRule {
        id: id.to_string(),
        name: id.to_string(),
        enabled,
        conditions: conds,
        action: BanAction { champion_id: target },
    }
}

#[test]
fn evaluate_ban_returns_first_matching() {
    let s = make_session(vec![player("me", "middle")]);
    let rules = vec![
        ban_rule("b1", vec![RuleCondition::Position { value: Position::Top }], 1, true),
        ban_rule("b2", vec![RuleCondition::Position { value: Position::Middle }], 89, true),
    ];
    let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 89);
}

#[test]
fn evaluate_ban_skips_disabled() {
    let s = make_session(vec![player("me", "middle")]);
    let rules = vec![
        ban_rule("b1", vec![], 89, false),
        ban_rule("b2", vec![], 99, true),
    ];
    let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 99);
}

#[test]
fn evaluate_ban_skips_target_already_banned() {
    use crate::lcu::api::champion_select::Action;
    let other_ban = Action {
        actor_cell_id: 9,
        id: 5,
        champion_id: 89,
        completed: true,
        is_ally_action: false,
        is_in_progress: false,
        action_type: "ban".to_string(),
    };
    let s = session_with_picks_and_bans(
        vec![player("me", "middle")],
        vec![],
        vec![vec![other_ban]],
    );
    let rules = vec![
        ban_rule("b1", vec![], 89, true),
        ban_rule("b2", vec![], 99, true),
    ];
    let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
    assert_eq!(action.champion_id, 99);
}

#[test]
fn evaluate_ban_returns_none_when_empty() {
    let s = make_session(vec![]);
    assert!(evaluate_ban(&s, None, &[]).is_none());
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests::evaluate_ban_
```

Expected: compile errors.

- [ ] **Step 3: Implement `evaluate_ban`**

Append to `rule_engine.rs`:

```rust
/// Same logic as `evaluate_pick` but for ban rules. Returns the first
/// rule whose conditions all match and whose target champion has not
/// already been banned/picked by someone else.
pub fn evaluate_ban<'a>(
    session: &SelectSession,
    my_position: Option<Position>,
    rules: &'a [BanRule],
) -> Option<&'a BanAction> {
    let unavailable = unavailable_champion_ids(session);

    for rule in rules.iter().filter(|r| r.enabled) {
        let all_match = rule
            .conditions
            .iter()
            .all(|c| match_condition(c, session, my_position));
        if !all_match {
            continue;
        }
        if !unavailable.contains(&rule.action.champion_id) {
            return Some(&rule.action);
        }
    }
    None
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cargo test -p lol-record-analysis-app rule_engine::tests
```

Expected: every test in the module passes.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/rule_engine.rs
git commit -m "feat: rule_engine 实现 evaluate_ban"
```

---

## Task 10: Wire rule engine into `start_select_champion`

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/automation.rs:429-565`

**Strategy:** Insert rule evaluation **before** the existing slice-based selection logic. Keep the existing logic untouched as the fallback path (read after evaluation returns `None`).

- [ ] **Step 1: Add a helper to read `pickRules` from config**

Right above the existing `start_select_champion` function in `automation.rs`, add:

```rust
async fn load_pick_rules() -> Vec<crate::command::rule_config::PickRule> {
    use crate::command::rule_config::PickRule;
    match get_config("settings.auto.pickRules").await {
        Ok(value) => match serde_json::to_value(&value) {
            Ok(json) => {
                // Config wraps user-facing values as { "value": <actual> }
                let inner = json.get("value").cloned().unwrap_or(json);
                serde_json::from_value::<Vec<PickRule>>(inner).unwrap_or_else(|e| {
                    log::warn!("Failed to parse pickRules from config: {}", e);
                    vec![]
                })
            }
            Err(e) => {
                log::warn!("Failed to bridge config Value -> JSON: {}", e);
                vec![]
            }
        },
        Err(_) => vec![], // missing key is fine — no rules configured
    }
}

async fn load_ban_rules() -> Vec<crate::command::rule_config::BanRule> {
    use crate::command::rule_config::BanRule;
    match get_config("settings.auto.banRules").await {
        Ok(value) => match serde_json::to_value(&value) {
            Ok(json) => {
                let inner = json.get("value").cloned().unwrap_or(json);
                serde_json::from_value::<Vec<BanRule>>(inner).unwrap_or_else(|e| {
                    log::warn!("Failed to parse banRules from config: {}", e);
                    vec![]
                })
            }
            Err(e) => {
                log::warn!("Failed to bridge config Value -> JSON: {}", e);
                vec![]
            }
        },
        Err(_) => vec![],
    }
}
```

- [ ] **Step 2: Modify `start_select_champion` to consult the rule engine first**

Find the function (around line 429). Right after the `let select_session = ...; let my_cell_id = ...;` block, **before** the existing `let my_pick_champion_slice = ...` block, insert:

```rust
    // ===== Rule engine (new) — try first; fall back to slice on miss =====
    let rules = load_pick_rules().await;
    if !rules.is_empty() {
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to get my summoner for rule engine: {}", e);
                // Fall through to existing slice logic
                return start_select_champion_slice_fallback(&select_session, my_cell_id).await;
            }
        };
        let my_pos = crate::rule_engine::detect_my_position(&select_session, &my_summoner.puuid);
        if let Some(action) = crate::rule_engine::evaluate_pick(&select_session, my_pos, &rules) {
            log::info!(
                "Pick rule matched: champion={} lock={}",
                action.champion_id,
                action.lock
            );
            return execute_pick_action(&select_session, my_cell_id, action).await;
        }
        log::debug!("No pick rule matched, falling back to pickChampionSlice");
    }
    // ===== End rule engine =====

    return start_select_champion_slice_fallback(&select_session, my_cell_id).await;
}
```

Then **rename** the existing body of `start_select_champion` (the part starting from `let my_pick_champion_slice = ...` through the end of the function) into a new function `start_select_champion_slice_fallback`:

```rust
async fn start_select_champion_slice_fallback(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
) -> Result<(), String> {
    // ... existing body that reads pickChampionSlice and acts on it ...
    // (keep the original logic verbatim, just refer to `select_session` and `my_cell_id` from the params)
}
```

And add the rule-execution helper:

```rust
async fn execute_pick_action(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
    action: &crate::command::rule_config::PickAction,
) -> Result<(), String> {
    // Find my pick action_id (same lookup as the original).
    let mut action_id = -1;
    let mut is_in_progress = false;
    let mut my_picked_champion_id = -1;
    let mut completed = false;

    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "pick" {
            for pick in action_group {
                if pick.actor_cell_id == my_cell_id {
                    completed = pick.completed;
                    my_picked_champion_id = pick.champion_id;
                    action_id = pick.id;
                    if pick.is_in_progress {
                        is_in_progress = true;
                    }
                    break;
                }
            }
        }
    }

    if action_id == -1 {
        log::warn!("No pick action found for current player");
        return Ok(());
    }

    // Lock semantics:
    //   action.lock == true  → call patch with completed=true (lock-in)
    //   action.lock == false → call patch with completed=false (hover only)
    // BUT only act when it makes sense for the current state, mirroring the existing logic.
    if is_in_progress && !completed {
        log::info!(
            "Rule action: {} champion {} (in_progress)",
            if action.lock { "locking" } else { "hovering" },
            action.champion_id
        );
        crate::lcu::api::champion_select::patch_session_action(
            action_id,
            action.champion_id as i32,
            "pick".to_string(),
            action.lock,
        )
        .await?;
    } else if my_picked_champion_id == 0 && !completed && !is_in_progress {
        // Pre-select hover slot — always hover here regardless of lock flag.
        log::info!("Rule action: hovering champion {} (pre-select)", action.champion_id);
        crate::lcu::api::champion_select::patch_session_action(
            action_id,
            action.champion_id as i32,
            "pick".to_string(),
            false,
        )
        .await?;
    } else {
        log::debug!("No pick action needed under current state");
    }

    Ok(())
}
```

- [ ] **Step 3: Confirm the file compiles**

```bash
cargo check -p lol-record-analysis-app
```

Expected: clean compile.

- [ ] **Step 4: Run all existing tests to confirm no regressions**

```bash
cargo test -p lol-record-analysis-app
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/automation.rs
git commit -m "feat: 把 rule_engine 接入 start_select_champion，没命中走兜底"
```

---

## Task 11: Wire rule engine into `start_ban_champion`

**Files:**
- Modify: `lol-record-analysis-tauri/src-tauri/src/automation.rs:622-755`

Same pattern as Task 10: rule first, fallback to slice on miss.

- [ ] **Step 1: Refactor `start_ban_champion`**

Replace the existing function body with:

```rust
async fn start_ban_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let my_cell_id = select_session.local_player_cell_id;
    log::info!("Current player cell ID: {}", my_cell_id);

    let rules = load_ban_rules().await;
    if !rules.is_empty() {
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to get my summoner for rule engine: {}", e);
                return start_ban_champion_slice_fallback(&select_session, my_cell_id).await;
            }
        };
        let my_pos = crate::rule_engine::detect_my_position(&select_session, &my_summoner.puuid);
        if let Some(action) = crate::rule_engine::evaluate_ban(&select_session, my_pos, &rules) {
            log::info!("Ban rule matched: champion={}", action.champion_id);
            return execute_ban_action(&select_session, my_cell_id, action).await;
        }
        log::debug!("No ban rule matched, falling back to banChampionSlice");
    }

    start_ban_champion_slice_fallback(&select_session, my_cell_id).await
}
```

Move the original body into:

```rust
async fn start_ban_champion_slice_fallback(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
) -> Result<(), String> {
    // ... original `start_ban_champion` body, parameterized on (select_session, my_cell_id) ...
}
```

Add the executor:

```rust
async fn execute_ban_action(
    select_session: &crate::lcu::api::champion_select::SelectSession,
    my_cell_id: i32,
    action: &crate::command::rule_config::BanAction,
) -> Result<(), String> {
    // Mirrors original ban logic: only act when our ban slot is in-progress.
    let mut action_id = -1;
    let mut is_in_progress = false;
    let mut already_completed = false;

    for action_group in &select_session.actions {
        if !action_group.is_empty() && action_group[0].action_type == "ban" {
            for ban in action_group {
                if ban.actor_cell_id == my_cell_id {
                    if ban.completed {
                        already_completed = true;
                    }
                    if ban.is_in_progress {
                        action_id = ban.id;
                        is_in_progress = true;
                    }
                }
            }
        }
    }

    if already_completed {
        log::info!("Ban already completed");
        return Ok(());
    }
    if action_id == -1 || !is_in_progress {
        log::debug!("No ban action in progress for current player");
        return Ok(());
    }

    log::info!("Rule action: banning champion {}", action.champion_id);
    crate::lcu::api::champion_select::patch_session_action(
        action_id,
        action.champion_id as i32,
        "ban".to_string(),
        true,
    )
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Confirm the file compiles**

```bash
cargo check -p lol-record-analysis-app
```

Expected: clean compile.

- [ ] **Step 3: Run all tests**

```bash
cargo test -p lol-record-analysis-app
```

Expected: all tests pass.

- [ ] **Step 4: Run clippy gate**

```bash
cargo clippy -p lol-record-analysis-app --all-targets --all-features -- -Dwarnings
```

Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src-tauri/src/automation.rs
git commit -m "feat: 把 rule_engine 接入 start_ban_champion，没命中走兜底"
```

---

## Task 12: TypeScript type mirror

**Files:**
- Create: `lol-record-analysis-tauri/src/types/rules.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * Pick/Ban 规则引擎前端类型，与 src-tauri/src/command/rule_config.rs 同构。
 * 用 serde 的 #[serde(tag = "type")] tagged-union 形式表示 RuleCondition。
 */

export type Position = 'top' | 'jungle' | 'middle' | 'bottom' | 'utility'

export type RuleCondition =
  | { type: 'Position'; value: Position }
  | { type: 'AllyChampionsContains'; ids: number[] }
  | { type: 'AllyChampionsNotContains'; ids: number[] }
  | { type: 'EnemyChampionsContains'; ids: number[] }
  | { type: 'EnemyChampionsNotContains'; ids: number[] }

export interface PickAction {
  championId: number
  lock: boolean
}

export interface BanAction {
  championId: number
}

export interface PickBanRule<A> {
  id: string
  name: string
  enabled: boolean
  conditions: RuleCondition[]
  action: A
}

export type PickRule = PickBanRule<PickAction>
export type BanRule = PickBanRule<BanAction>

export const POSITION_LABEL: Record<Position, string> = {
  top: '上路',
  jungle: '打野',
  middle: '中路',
  bottom: '下路',
  utility: '辅助',
}

export const CONDITION_TYPE_LABEL: Record<RuleCondition['type'], string> = {
  Position: '我的位置 =',
  AllyChampionsContains: '自家英雄包含',
  AllyChampionsNotContains: '自家英雄不包含',
  EnemyChampionsContains: '对面英雄包含',
  EnemyChampionsNotContains: '对面英雄不包含',
}
```

> ⚠️ **Important camelCase note:** Rust serde with `#[serde(rename_all = "camelCase")]` is NOT applied to `PickAction` / `BanAction` / `PickBanRule` here (they use snake_case fields by default). Verify by running the Rust tests in Task 3 — if Rust serializes `champion_id` not `championId`, change this TS to `champion_id` / `lock` accordingly. **Do this verification before continuing**:
>
> ```bash
> cd lol-record-analysis-tauri/src-tauri
> cargo test -p lol-record-analysis-app rule_config::tests::pick_action_round_trip -- --nocapture
> ```
>
> Look at the `serde_json::to_string` output. If it's `{"champion_id":157,"lock":true}`, switch the TS to snake_case. If it's `{"championId":157,"lock":true}`, the camelCase above is correct.
>
> **Default expectation:** Rust without `rename_all` produces snake_case JSON. So **most likely** the TS should be `champion_id` not `championId`. Adjust before proceeding.

- [ ] **Step 2: Run typecheck**

```bash
cd lol-record-analysis-tauri
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/types/rules.ts
git commit -m "feat: 增加 pick/ban 规则的前端类型定义"
```

---

## Task 13: `useRules` composable for CRUD

**Files:**
- Create: `lol-record-analysis-tauri/src/composables/useRules.ts`

- [ ] **Step 1: Write the file**

```typescript
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { PickRule, BanRule } from '@/types/rules'

const PICK_KEY = 'settings.auto.pickRules'
const BAN_KEY = 'settings.auto.banRules'

/**
 * Wraps the existing put_config / get_config Tauri commands. The config layer
 * stores user-facing values wrapped as `{ value: <actual> }`, so we pass and
 * receive the array directly and let the wrapper handle the envelope.
 */
async function loadList<T>(key: string): Promise<T[]> {
  try {
    const raw = await invoke<unknown>('get_config', { key })
    if (raw == null) return []
    // The Rust config Value enum serializes Map<String,Value> -> JSON object.
    // We stored `{ value: T[] }`, so unwrap.
    if (typeof raw === 'object' && raw && 'value' in raw) {
      const inner = (raw as { value: unknown }).value
      return Array.isArray(inner) ? (inner as T[]) : []
    }
    return Array.isArray(raw) ? (raw as T[]) : []
  } catch (e) {
    // Missing key is fine — return empty.
    console.debug(`useRules: ${key} not yet set`, e)
    return []
  }
}

async function saveList<T>(key: string, list: T[]): Promise<void> {
  await invoke('put_config', { key, value: { value: list } })
}

export function usePickRules() {
  const rules = ref<PickRule[]>([])

  const reload = async () => {
    rules.value = await loadList<PickRule>(PICK_KEY)
  }

  const save = async (next: PickRule[]) => {
    rules.value = next
    await saveList(PICK_KEY, next)
  }

  return { rules, reload, save }
}

export function useBanRules() {
  const rules = ref<BanRule[]>([])

  const reload = async () => {
    rules.value = await loadList<BanRule>(BAN_KEY)
  }

  const save = async (next: BanRule[]) => {
    rules.value = next
    await saveList(BAN_KEY, next)
  }

  return { rules, reload, save }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/composables/useRules.ts
git commit -m "feat: 增加 useRules composable 包装规则 CRUD"
```

---

## Task 14: `RuleConditionRow.vue` single-row condition editor

**Files:**
- Create: `lol-record-analysis-tauri/src/components/automation/RuleConditionRow.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { NSelect, NButton } from 'naive-ui'
import {
  type RuleCondition,
  CONDITION_TYPE_LABEL,
  POSITION_LABEL,
} from '@/types/rules'
import type { ChampionOption } from '@/types/champion' // adjust import to actual existing path

const props = defineProps<{
  modelValue: RuleCondition
  championOptions: ChampionOption[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: RuleCondition): void
  (e: 'remove'): void
}>()

const typeOptions = (Object.keys(CONDITION_TYPE_LABEL) as Array<RuleCondition['type']>).map(
  (t) => ({ label: CONDITION_TYPE_LABEL[t], value: t })
)

const positionOptions = (Object.keys(POSITION_LABEL) as Array<keyof typeof POSITION_LABEL>).map(
  (p) => ({ label: POSITION_LABEL[p], value: p })
)

const currentType = computed(() => props.modelValue.type)

function setType(next: RuleCondition['type']) {
  // Reset payload when type changes.
  if (next === 'Position') {
    emit('update:modelValue', { type: 'Position', value: 'middle' })
  } else {
    emit('update:modelValue', { type: next, ids: [] } as RuleCondition)
  }
}

function setPosition(value: 'top' | 'jungle' | 'middle' | 'bottom' | 'utility') {
  emit('update:modelValue', { type: 'Position', value })
}

function setIds(ids: number[]) {
  if (props.modelValue.type === 'Position') return
  emit('update:modelValue', { ...props.modelValue, ids })
}
</script>

<template>
  <div class="rule-condition-row">
    <n-select
      :value="currentType"
      :options="typeOptions"
      style="width: 180px"
      @update:value="setType"
    />

    <n-select
      v-if="modelValue.type === 'Position'"
      :value="modelValue.value"
      :options="positionOptions"
      style="width: 120px"
      @update:value="setPosition"
    />

    <n-select
      v-else
      multiple
      filterable
      :value="modelValue.ids"
      :options="championOptions.map((c) => ({ label: c.label, value: c.value }))"
      placeholder="选择英雄"
      style="flex: 1; min-width: 200px"
      @update:value="setIds"
    />

    <n-button quaternary type="error" @click="emit('remove')">删除</n-button>
  </div>
</template>

<style scoped>
.rule-condition-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
</style>
```

> If `@/types/champion` does not exist, find the actual `ChampionOption` (or equivalent) type used by the existing Automation.vue champion picker and import it from there. Search: `grep -r "ChampionOption" lol-record-analysis-tauri/src` or look at where Automation.vue imports the option type for its `n-select`.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass (after adjusting the import per the note above).

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/components/automation/RuleConditionRow.vue
git commit -m "feat: 增加 RuleConditionRow 单行条件编辑组件"
```

---

## Task 15: `RuleEditModal.vue` rule editor

**Files:**
- Create: `lol-record-analysis-tauri/src/components/automation/RuleEditModal.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NCard, NInput, NSwitch, NButton, NSelect } from 'naive-ui'
import { v4 as uuid } from 'uuid' // if uuid is not yet a dep, see fallback below
import RuleConditionRow from './RuleConditionRow.vue'
import type {
  PickRule,
  BanRule,
  RuleCondition,
  PickAction,
  BanAction,
} from '@/types/rules'
import type { ChampionOption } from '@/types/champion' // adjust as in Task 14

type Mode = 'pick' | 'ban'

const props = defineProps<{
  show: boolean
  mode: Mode
  initial?: PickRule | BanRule
  championOptions: ChampionOption[]
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'save', v: PickRule | BanRule): void
}>()

// Form state
const id = ref('')
const name = ref('')
const enabled = ref(true)
const conditions = ref<RuleCondition[]>([])
const targetChampion = ref<number | null>(null)
const lock = ref(true) // pick mode only

watch(
  () => props.initial,
  (init) => {
    if (init) {
      id.value = init.id
      name.value = init.name
      enabled.value = init.enabled
      conditions.value = JSON.parse(JSON.stringify(init.conditions))
      targetChampion.value = init.action.championId
      if (props.mode === 'pick') {
        lock.value = (init.action as PickAction).lock
      }
    } else {
      id.value = uuid() // fallback: crypto.randomUUID() if uuid lib unavailable
      name.value = ''
      enabled.value = true
      conditions.value = []
      targetChampion.value = null
      lock.value = true
    }
  },
  { immediate: true }
)

const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    conditions.value.length > 0 &&
    targetChampion.value != null
)

function addCondition() {
  conditions.value.push({ type: 'Position', value: 'middle' })
}

function updateCondition(idx: number, next: RuleCondition) {
  conditions.value[idx] = next
}

function removeCondition(idx: number) {
  conditions.value.splice(idx, 1)
}

function close() {
  emit('update:show', false)
}

function save() {
  if (!canSave.value || targetChampion.value == null) return
  if (props.mode === 'pick') {
    const rule: PickRule = {
      id: id.value,
      name: name.value.trim(),
      enabled: enabled.value,
      conditions: conditions.value,
      action: { championId: targetChampion.value, lock: lock.value } as PickAction,
    }
    emit('save', rule)
  } else {
    const rule: BanRule = {
      id: id.value,
      name: name.value.trim(),
      enabled: enabled.value,
      conditions: conditions.value,
      action: { championId: targetChampion.value } as BanAction,
    }
    emit('save', rule)
  }
  close()
}

const championSelectOptions = computed(() =>
  props.championOptions.map((c) => ({ label: c.label, value: c.value }))
)
</script>

<template>
  <n-modal :show="show" @update:show="close">
    <n-card style="width: 600px" :title="mode === 'pick' ? '编辑 Pick 规则' : '编辑 Ban 规则'">
      <div class="field">
        <label>名称</label>
        <n-input v-model:value="name" placeholder="如：中路防刺客" />
      </div>

      <div class="field">
        <label>启用</label>
        <n-switch v-model:value="enabled" />
      </div>

      <div class="field">
        <label>条件 (全部满足)</label>
        <RuleConditionRow
          v-for="(c, i) in conditions"
          :key="i"
          :model-value="c"
          :champion-options="championOptions"
          @update:model-value="(v) => updateCondition(i, v)"
          @remove="removeCondition(i)"
        />
        <n-button size="small" dashed @click="addCondition">+ 添加条件</n-button>
      </div>

      <div class="field">
        <label>目标英雄</label>
        <n-select
          v-model:value="targetChampion"
          filterable
          :options="championSelectOptions"
          placeholder="选择英雄"
        />
      </div>

      <div v-if="mode === 'pick'" class="field">
        <label>执行后锁定</label>
        <n-switch v-model:value="lock" />
        <span class="hint">关闭则只 hover，不自动确定</span>
      </div>

      <template #footer>
        <div class="footer">
          <n-button @click="close">取消</n-button>
          <n-button type="primary" :disabled="!canSave" @click="save">保存</n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<style scoped>
.field {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: var(--n-text-color-disabled);
}
</style>
```

> **uuid dep:** If `uuid` is not yet a dependency, replace `import { v4 as uuid } from 'uuid'` with:
> ```ts
> const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
> ```
> Verify: `grep '"uuid"' lol-record-analysis-tauri/package.json`. Use the inline fallback unless uuid is already there.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/components/automation/RuleEditModal.vue
git commit -m "feat: 增加 RuleEditModal 规则编辑弹窗"
```

---

## Task 16: Component test — `RuleEditModal.spec.ts`

**Files:**
- Create: `lol-record-analysis-tauri/src/components/automation/__tests__/RuleEditModal.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RuleEditModal from '../RuleEditModal.vue'
import { createPinia } from 'pinia'

const opts = [{ label: '亚索', value: 157 }, { label: '锤石', value: 412 }]

describe('RuleEditModal', () => {
  it('save button is disabled when conditions empty', () => {
    const w = mount(RuleEditModal, {
      props: { show: true, mode: 'pick', championOptions: opts },
      global: { plugins: [createPinia()] },
    })
    const saveBtn = w.findAll('button').find((b) => b.text() === '保存')
    expect(saveBtn?.attributes('disabled')).toBeDefined()
  })

  it('save emits a PickRule with lock field for pick mode', async () => {
    const w = mount(RuleEditModal, {
      props: {
        show: true,
        mode: 'pick',
        championOptions: opts,
        initial: {
          id: 'r1',
          name: '测试',
          enabled: true,
          conditions: [{ type: 'Position', value: 'middle' }],
          action: { championId: 157, lock: false },
        },
      },
      global: { plugins: [createPinia()] },
    })
    // Trigger save by calling component method directly (find button + emit form valid)
    // Easier: simulate form being valid and call save via vm
    await w.vm.$nextTick()
    const saveBtn = w.findAll('button').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')

    const emitted = w.emitted('save')
    expect(emitted).toBeTruthy()
    const rule = emitted![0][0] as any
    expect(rule.action.lock).toBe(false)
    expect(rule.action.championId).toBe(157)
    expect(rule.conditions).toHaveLength(1)
  })

  it('save emits a BanRule without lock field for ban mode', async () => {
    const w = mount(RuleEditModal, {
      props: {
        show: true,
        mode: 'ban',
        championOptions: opts,
        initial: {
          id: 'b1',
          name: '禁刀妹',
          enabled: true,
          conditions: [{ type: 'Position', value: 'top' }],
          action: { championId: 89 },
        },
      },
      global: { plugins: [createPinia()] },
    })
    await w.vm.$nextTick()
    const saveBtn = w.findAll('button').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')

    const rule = (w.emitted('save')![0][0] as any)
    expect(rule.action.championId).toBe(89)
    expect('lock' in rule.action).toBe(false)
  })
})
```

> If a test fails because the `n-button` rendering hides the actual `<button>` element behind teleports/portals, switch to `w.vm.save()` directly via exposed methods, or adjust the find selector. Don't dilute the assertions to make tests pass.

- [ ] **Step 2: Run tests**

```bash
cd lol-record-analysis-tauri
npm run test -- RuleEditModal
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/components/automation/__tests__/RuleEditModal.spec.ts
git commit -m "test: RuleEditModal 单元测试"
```

---

## Task 17: Integrate rule lists into `Automation.vue`

**Files:**
- Modify: `lol-record-analysis-tauri/src/views/settings/Automation.vue`

**Strategy:** Above each existing simple list (pick / ban), insert a new section: rule list with drag-reorder + edit/delete + "添加规则" button. Below the rule list, label the existing list as "兜底（规则都没命中时按顺序选）".

- [ ] **Step 1: Read the existing file to identify where the pick and ban sections are defined**

```bash
grep -n "pickChampionSlice\|banChampionSlice" lol-record-analysis-tauri/src/views/settings/Automation.vue
```

Note the line ranges of the two existing sections. The integration replaces those sections' headers ("自动 Pick" / "自动 Ban") with a wrapper that contains:
1. A `Rules` sub-section (new)
2. The existing list, now under a "兜底" sub-heading (existing markup, untouched)

- [ ] **Step 2: Add imports and composables at the top of the `<script setup>` block**

```ts
import { onMounted, ref } from 'vue'
import { usePickRules, useBanRules } from '@/composables/useRules'
import RuleEditModal from '@/components/automation/RuleEditModal.vue'
import type { PickRule, BanRule } from '@/types/rules'

const { rules: pickRules, reload: reloadPickRules, save: savePickRules } = usePickRules()
const { rules: banRules, reload: reloadBanRules, save: saveBanRules } = useBanRules()

const pickModalShow = ref(false)
const pickEditing = ref<PickRule | undefined>(undefined)
const banModalShow = ref(false)
const banEditing = ref<BanRule | undefined>(undefined)

onMounted(async () => {
  await reloadPickRules()
  await reloadBanRules()
})

function openPickEdit(rule?: PickRule) {
  pickEditing.value = rule
  pickModalShow.value = true
}
async function onPickSave(rule: PickRule | BanRule) {
  const r = rule as PickRule
  const existingIdx = pickRules.value.findIndex((x) => x.id === r.id)
  const next = [...pickRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await savePickRules(next)
}
async function deletePickRule(id: string) {
  await savePickRules(pickRules.value.filter((r) => r.id !== id))
}
async function togglePickRule(id: string, enabled: boolean) {
  await savePickRules(pickRules.value.map((r) => (r.id === id ? { ...r, enabled } : r)))
}

// Same for ban:
function openBanEdit(rule?: BanRule) {
  banEditing.value = rule
  banModalShow.value = true
}
async function onBanSave(rule: PickRule | BanRule) {
  const r = rule as BanRule
  const existingIdx = banRules.value.findIndex((x) => x.id === r.id)
  const next = [...banRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await saveBanRules(next)
}
async function deleteBanRule(id: string) {
  await saveBanRules(banRules.value.filter((r) => r.id !== id))
}
async function toggleBanRule(id: string, enabled: boolean) {
  await saveBanRules(banRules.value.map((r) => (r.id === id ? { ...r, enabled } : r)))
}

function summarize(rule: PickRule | BanRule): string {
  // "中路 + 自家亚索 → 选 卡尔玛 [锁]"
  const parts: string[] = []
  for (const c of rule.conditions) {
    switch (c.type) {
      case 'Position':
        parts.push(`${c.value === 'middle' ? '中路' : c.value === 'top' ? '上路' : c.value === 'jungle' ? '打野' : c.value === 'bottom' ? '下路' : '辅助'}`)
        break
      case 'AllyChampionsContains':
        parts.push(`自家含 ${c.ids.length} 个英雄`)
        break
      case 'AllyChampionsNotContains':
        parts.push(`自家无 ${c.ids.length} 个英雄`)
        break
      case 'EnemyChampionsContains':
        parts.push(`对面含 ${c.ids.length} 个英雄`)
        break
      case 'EnemyChampionsNotContains':
        parts.push(`对面无 ${c.ids.length} 个英雄`)
        break
    }
  }
  const target = `${rule.action.championId}` // resolved to name in the actual UI via championOptions lookup
  const lockTag = 'lock' in rule.action && (rule.action as PickAction).lock ? ' [锁]' : ''
  return `${parts.join(' + ')} → ${('lock' in rule.action) ? '选' : 'Ban'} ${target}${lockTag}`
}
```

> The `summarize` function above uses raw champion IDs as a placeholder — wire it to the existing `championOptions` array (find the variable name in Automation.vue that holds champion list with `{ label, value }`) for proper Chinese names. Quick fix:
> ```ts
> const championNameById = computed(() => {
>   const m = new Map<number, string>()
>   for (const c of championOptions.value) m.set(c.value, c.label)
>   return m
> })
> // then in summarize: const target = championNameById.value.get(rule.action.championId) ?? `#${rule.action.championId}`
> ```

- [ ] **Step 3: Add template markup for pick rules section**

Locate the existing `<n-card title="自动 Pick">` (or equivalent) block. Inside the card body, **before** the existing list markup, insert:

```vue
<div class="rules-section">
  <div class="section-title">
    规则（按顺序匹配，第一条命中即用）
    <n-button size="small" type="primary" @click="openPickEdit()">+ 添加规则</n-button>
  </div>
  <div v-for="rule in pickRules" :key="rule.id" class="rule-row">
    <n-checkbox
      :checked="rule.enabled"
      @update:checked="(v) => togglePickRule(rule.id, v)"
    />
    <span class="rule-name">{{ rule.name }}</span>
    <span class="rule-summary">{{ summarize(rule) }}</span>
    <n-button quaternary size="small" @click="openPickEdit(rule)">编辑</n-button>
    <n-button quaternary type="error" size="small" @click="deletePickRule(rule.id)">删除</n-button>
  </div>
</div>
<div class="section-title">兜底（规则都没命中时按顺序选）</div>
<!-- existing pickChampionSlice list markup stays here, untouched -->
```

And at the end of the pick card (after existing markup):

```vue
<RuleEditModal
  v-model:show="pickModalShow"
  mode="pick"
  :initial="pickEditing"
  :champion-options="championOptions"
  @save="onPickSave"
/>
```

- [ ] **Step 4: Same for ban — symmetric markup**

In the `自动 Ban` card, insert before the existing list:

```vue
<div class="rules-section">
  <div class="section-title">
    规则（按顺序匹配，第一条命中即用）
    <n-button size="small" type="primary" @click="openBanEdit()">+ 添加规则</n-button>
  </div>
  <div v-for="rule in banRules" :key="rule.id" class="rule-row">
    <n-checkbox
      :checked="rule.enabled"
      @update:checked="(v) => toggleBanRule(rule.id, v)"
    />
    <span class="rule-name">{{ rule.name }}</span>
    <span class="rule-summary">{{ summarize(rule) }}</span>
    <n-button quaternary size="small" @click="openBanEdit(rule)">编辑</n-button>
    <n-button quaternary type="error" size="small" @click="deleteBanRule(rule.id)">删除</n-button>
  </div>
</div>
<div class="section-title">兜底（规则都没命中时按顺序选）</div>
<!-- existing banChampionSlice list markup stays here, untouched -->

<RuleEditModal
  v-model:show="banModalShow"
  mode="ban"
  :initial="banEditing"
  :champion-options="championOptions"
  @save="onBanSave"
/>
```

- [ ] **Step 5: Add minimal styles**

```vue
<style scoped>
.rules-section { margin-bottom: 12px; }
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin: 12px 0 8px;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--n-border-color);
}
.rule-name { min-width: 120px; font-weight: 500; }
.rule-summary { flex: 1; color: var(--n-text-color-disabled); font-size: 12px; }
</style>
```

- [ ] **Step 6: Typecheck and lint**

```bash
cd lol-record-analysis-tauri
npm run typecheck
npm run lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lol-record-analysis-tauri/src/views/settings/Automation.vue
git commit -m "feat: Automation 设置页嵌入 pick/ban 规则编辑区"
```

---

## Task 18: Quality gate + manual smoke + ship

**Files:**
- (no code changes — verification only)

- [ ] **Step 1: Run the canonical pre-commit gate**

Per `shipping-changes` skill:

```bash
cd lol-record-analysis-tauri
npm run check
npm run test
cd src-tauri && cargo test && cd ..
```

Expected: all pass. If anything is red, fix the root cause and re-run.

- [ ] **Step 2: Manual smoke test in dev**

```bash
npm run tauri dev
```

Per the manual checklist from the spec:
- [ ] Create a pick rule: 中路 + 自家亚索 → 选 卡尔玛 锁定. Open champ-select, verify it triggers.
- [ ] Switch the same rule to hover-only. Confirm it only hovers, doesn't lock.
- [ ] Delete all rules. Confirm fallback (existing simple list) still works.
- [ ] Create a ban rule: 自家亚索 → ban 蕾欧娜. Verify in ban phase.
- [ ] In ARAM (大乱斗), enable a Position rule. Confirm it does not trigger (assignedPosition empty), and fallback works.

If any case fails, fix and re-run gate before shipping.

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: pick/ban 规则引擎（IF-THEN）" --body "$(cat <<'EOF'
## Summary
- 新增 pick/ban 规则引擎：扁平 AND 条件 + 单一目标行动；规则按用户拖拽顺序匹配，第一条命中即用；目标英雄不可用 → 跳到下一条。
- 没命中任何规则时回退到现有 `pickChampionSlice` / `banChampionSlice` 简单列表，向后完全兼容。
- 每条 pick 规则带 lock 开关（锁定 / 仅 hover）。
- Automation 设置页新增规则编辑区（顶部）+ 兜底列表（底部，原 UI 不变）。

详细设计见 `docs/superpowers/specs/2026-05-01-pickban-rules-and-ai-tags-design.md` §特性 1。

## Test plan
- [x] `npm run check` passes
- [x] `npm run test` passes (Rust + Vitest)
- [x] `cargo test` passes
- [x] Manual: pick 规则锁定 / hover-only / 删空走兜底 / ban 规则 / 大乱斗回退 — 全部 OK
EOF
)"
```

- [ ] **Step 4: Print PR URL back**

The `gh pr create` output gives the URL. Confirm the user sees it.

---

## Self-Review

**Spec coverage check** — every requirement in `docs/superpowers/specs/2026-05-01-pickban-rules-and-ai-tags-design.md` §特性 1 maps to a task here:

| Spec section | Task |
|---|---|
| Position / RuleCondition / PickAction / BanAction / PickRule / BanRule data model | Tasks 2, 3 |
| Storage in YAML config under `pickRules` / `banRules` | Task 13 (frontend save), Tasks 10/11 (backend load) |
| `evaluate_pick` / `evaluate_ban` semantics (order, enabled, target unavailable → next, no match → None) | Tasks 8, 9 |
| Wiring into `start_select_champion` / `start_ban_champion` with fallback | Tasks 10, 11 |
| Position detection from LCU `assignedPosition` | Tasks 1, 4 |
| Condition evaluation rules (Position / Ally* / Enemy* with hover-counted) | Tasks 5, 6, 7 |
| Frontend rule editor UI (RuleConditionRow, RuleEditModal, Automation.vue integration) | Tasks 14, 15, 17 |
| Save button disabled on empty conditions | Task 15 (`canSave` computed) |
| Ban rule has no lock field | Tasks 3 (struct), 15 (mode-conditional UI) |
| Rust unit tests | Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9 |
| Vitest component test for RuleEditModal | Task 16 |
| Manual test plan | Task 18 |

Out-of-scope (separate plan): AI tag suggestion (spec §特性 2).

**No-placeholder check:** All Rust code blocks compile-ready; all Vue components wire up against real exports; the only soft references (`@/types/champion`, uuid lib presence) include explicit verification commands and concrete fallbacks.

**Type consistency:** `PickAction.lock`, `BanAction` (no lock), `PickRule`/`BanRule` aliases over `PickBanRule<A>` — used consistently across Rust types (Tasks 2-3), Rust evaluator (Tasks 8-9), automation wiring (Tasks 10-11), TS types (Task 12), composable (Task 13), modal (Task 15), and tests (Tasks 3, 16). The Task 12 explicit warning about Rust default snake_case vs camelCase serialization keeps the TS/Rust boundary honest.
