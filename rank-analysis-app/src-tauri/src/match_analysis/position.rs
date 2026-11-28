//! # 分路（TS `positionInfer.ts` / `positionAssign.ts`；快照里的优先级见 [`resolve_positions`]，T7 加入）
//!
//! - 逐人启发式 [`infer_team_position`]：LCU 真实值透传 → 惩戒 → 传送 → 治疗/屏障 → 虚弱 → 点燃 → 职业兜底
//! - 整队求解 [`assign_team_positions`]：恰 5 人时，选秀队列（400/420/440）且槽位可信按
//!   participantId 槽位（每队依次上/野/中/下/辅），否则排除法：吃野定打野 → 补刀垫底定辅助 →
//!   ADC/治疗屏障定下路 → 战士 vs 法师刺客 + 传送分上中

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::input::PlayerInput;

/// 分路（TS `TeamPosition`），序列化为 `"TOP"` … `"UNKNOWN"`
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "UPPERCASE")]
pub enum TeamPosition {
    Top,
    Jungle,
    Middle,
    Bottom,
    Utility,
    Unknown,
}

impl TeamPosition {
    /// 解析五个真实分路；空串、`NONE`、`UNKNOWN` 等一律 `None`（TS 里 `=== 'TOP' || …` 的判定）
    pub fn parse_lane(s: &str) -> Option<Self> {
        match s {
            "TOP" => Some(Self::Top),
            "JUNGLE" => Some(Self::Jungle),
            "MIDDLE" => Some(Self::Middle),
            "BOTTOM" => Some(Self::Bottom),
            "UTILITY" => Some(Self::Utility),
            _ => None,
        }
    }
}

// 粗粒度英雄分类（与 TS positionInfer.ts 逐项相同，含 99 同时在辅助与法师）
pub const ADC_CHAMPIONS: &[i64] = &[
    22, 51, 222, 119, 21, 42, 67, 81, 110, 145, 202, 236, 360, 429, 498, 18, 15, 96, 203, 523, 221,
    200, 532,
];
pub const SUPPORT_CHAMPIONS: &[i64] = &[
    117, 412, 25, 16, 37, 40, 43, 53, 89, 99, 111, 143, 201, 235, 267, 350, 432, 497, 555, 526,
    901, 223, 161,
];
pub const MAGE_CHAMPIONS: &[i64] = &[
    1, 8, 13, 17, 30, 34, 45, 50, 61, 63, 69, 74, 90, 101, 112, 115, 134, 142, 163, 268, 300, 99,
    4, 26, 27, 36, 950, 84,
];
pub const FIGHTER_CHAMPIONS: &[i64] = &[
    2, 23, 24, 39, 41, 48, 54, 57, 58, 62, 75, 77, 78, 80, 82, 83, 86, 92, 98, 102, 106, 113, 114,
    122, 126, 150, 154, 157, 164, 240, 254, 266, 421, 516, 517, 875, 887, 888,
];
pub const ASSASSIN_CHAMPIONS: &[i64] = &[
    7, 28, 38, 55, 56, 60, 91, 103, 121, 131, 141, 238, 245, 246, 105, 35,
];

const SPELL_SMITE: i64 = 11;
const SPELL_TELEPORT: i64 = 12;
const SPELL_HEAL: i64 = 7;
const SPELL_BARRIER: i64 = 21;
const SPELL_EXHAUST: i64 = 3;
const SPELL_IGNITE: i64 = 14;

/// participantId 按「上/野/中/下/辅」槽位排序的队列：匹配征召 400、单双排 420、灵活 440
const SLOT_ORDERED_QUEUES: [i64; 3] = [400, 420, 440];
const SLOT_POSITIONS: [TeamPosition; 5] = [
    TeamPosition::Top,
    TeamPosition::Jungle,
    TeamPosition::Middle,
    TeamPosition::Bottom,
    TeamPosition::Utility,
];

/// 逐人推断输入（TS `PositionInferInput`）
pub struct PositionInferInput<'a> {
    /// LCU 下发的 teamPosition 原值；缺失传 `""`
    pub team_position: &'a str,
    pub spell_ids: &'a [i64],
    pub champion_id: i64,
}

/// 逐人启发式分路（TS `inferTeamPosition`，分支顺序逐行一致）
pub fn infer_team_position(input: &PositionInferInput<'_>) -> TeamPosition {
    if let Some(pos) = TeamPosition::parse_lane(input.team_position) {
        return pos;
    }
    let has = |spell: i64| input.spell_ids.contains(&spell);
    let c = input.champion_id;

    if has(SPELL_SMITE) {
        return TeamPosition::Jungle;
    }
    if has(SPELL_TELEPORT) {
        if FIGHTER_CHAMPIONS.contains(&c) {
            return TeamPosition::Top;
        }
        if MAGE_CHAMPIONS.contains(&c) || ASSASSIN_CHAMPIONS.contains(&c) {
            return TeamPosition::Middle;
        }
    }
    if has(SPELL_HEAL) || has(SPELL_BARRIER) {
        if ADC_CHAMPIONS.contains(&c) {
            return TeamPosition::Bottom;
        }
        if SUPPORT_CHAMPIONS.contains(&c) {
            return TeamPosition::Utility;
        }
    }
    if has(SPELL_EXHAUST) && SUPPORT_CHAMPIONS.contains(&c) {
        return TeamPosition::Utility;
    }
    if has(SPELL_IGNITE) && (MAGE_CHAMPIONS.contains(&c) || ASSASSIN_CHAMPIONS.contains(&c)) {
        return TeamPosition::Middle;
    }
    // 技能全无信号时按职业兜底；战士刻意不兜底
    if ADC_CHAMPIONS.contains(&c) {
        return TeamPosition::Bottom;
    }
    if SUPPORT_CHAMPIONS.contains(&c) {
        return TeamPosition::Utility;
    }
    TeamPosition::Unknown
}

/// 整队分配输入（TS `PositionAssignInput`）
///
/// - `minions_killed`: 小兵补刀（totalMinionsKilled）
/// - `jungle_minions_killed`: 野怪击杀（neutralMinionsKilled）
/// - `participant_id`: LCU participantId（1-10）；有值且队列按槽位排序时优先按槽位
#[derive(Debug, Clone, PartialEq)]
pub struct PositionAssignInput {
    pub champion_id: i64,
    pub spell_ids: Vec<i64>,
    pub minions_killed: i64,
    pub jungle_minions_killed: i64,
    pub participant_id: Option<i64>,
}

fn has_spell(p: &PositionAssignInput, spell: i64) -> bool {
    p.spell_ids.contains(&spell)
}

/// 按 participantId 槽位取分路；槽位不可信返回 `None`。
///
/// 可信条件：五人恰占同一队的五个连续槽（1-5 或 6-10），且槽位 2 是本队打野
/// （唯一带惩戒者；全队无惩戒时取吃野量最高者，平分取先出现者——TS `reduce` 的 `>`）。
fn assign_by_slot(players: &[PositionAssignInput]) -> Option<Vec<TeamPosition>> {
    let pids: Vec<i64> = players
        .iter()
        .map(|p| p.participant_id.unwrap_or(0))
        .collect();
    let base = *pids.iter().min()?;
    if base != 1 && base != 6 {
        return None;
    }
    let slots: Vec<i64> = pids.iter().map(|id| id - base).collect();
    let unique: HashSet<i64> = slots.iter().copied().collect();
    if unique.len() != 5 || slots.iter().any(|&s| s > 4) {
        return None;
    }
    let smiters: Vec<usize> = players
        .iter()
        .enumerate()
        .filter(|(_, p)| has_spell(p, SPELL_SMITE))
        .map(|(i, _)| i)
        .collect();
    // 双惩戒说明阵容异常，槽位不足为凭
    if smiters.len() > 1 {
        return None;
    }
    let jungler = match smiters.first() {
        Some(&i) => i,
        None => players.iter().enumerate().skip(1).fold(0, |a, (b, p)| {
            if p.jungle_minions_killed > players[a].jungle_minions_killed {
                b
            } else {
                a
            }
        }),
    };
    let slot_two = slots.iter().position(|&s| s == 1)?;
    if jungler != slot_two {
        return None;
    }
    Some(slots.iter().map(|&s| SLOT_POSITIONS[s as usize]).collect())
}

/// 从 `remaining` 里取 `score` 最高者：平分时先比 `tie_break` 降序，再取先出现的下标
/// （TS `pick`；`remaining` 保持升序插入顺序，与 TS `Set` 迭代一致）。
fn pick(
    players: &[PositionAssignInput],
    remaining: &mut Vec<usize>,
    score: impl Fn(&PositionAssignInput) -> i64,
    tie_break: impl Fn(&PositionAssignInput) -> i64,
) -> usize {
    let mut best: Option<usize> = None;
    for &i in remaining.iter() {
        let Some(b) = best else {
            best = Some(i);
            continue;
        };
        let d = score(&players[i]) - score(&players[b]);
        if d > 0 || (d == 0 && tie_break(&players[i]) > tie_break(&players[b])) {
            best = Some(i);
        }
    }
    let best = best.expect("五人队伍的 remaining 非空");
    remaining.retain(|&i| i != best);
    best
}

/// 给一支队伍分配分路，返回与输入同序的位置数组（TS `assignTeamPositions`）。
///
/// # 行为
/// - 非 5 人：逐人 [`infer_team_position`]（可能 UNKNOWN / 重复）
/// - 5 人且 `queue_id` 为选秀队列：槽位可信则按槽位
/// - 否则排除法，每个位置恰好一人
pub fn assign_team_positions(
    players: &[PositionAssignInput],
    queue_id: Option<i64>,
) -> Vec<TeamPosition> {
    if players.len() != 5 {
        return players
            .iter()
            .map(|p| {
                infer_team_position(&PositionInferInput {
                    team_position: "",
                    spell_ids: &p.spell_ids,
                    champion_id: p.champion_id,
                })
            })
            .collect();
    }

    if let Some(q) = queue_id {
        if SLOT_ORDERED_QUEUES.contains(&q) {
            if let Some(by_slot) = assign_by_slot(players) {
                return by_slot;
            }
        }
    }

    let mut result = vec![TeamPosition::Unknown; 5];
    let mut remaining: Vec<usize> = vec![0, 1, 2, 3, 4];

    // 1. 打野：惩戒决定性，吃野量兜底
    let jungle = pick(
        players,
        &mut remaining,
        |p| {
            (if has_spell(p, SPELL_SMITE) {
                100_000
            } else {
                0
            }) + p.jungle_minions_killed
        },
        |_| 0,
    );
    result[jungle] = TeamPosition::Jungle;

    // 2. 辅助：剩余四人补刀（含野怪）垫底者；平分时辅助职业优先
    let utility = pick(
        players,
        &mut remaining,
        |p| -(p.minions_killed + p.jungle_minions_killed),
        |p| i64::from(SUPPORT_CHAMPIONS.contains(&p.champion_id)),
    );
    result[utility] = TeamPosition::Utility;

    // 3. 下路：ADC 职业 4 分，治疗/屏障 2 分；平分比小兵补刀
    let bottom = pick(
        players,
        &mut remaining,
        |p| {
            (if ADC_CHAMPIONS.contains(&p.champion_id) {
                4
            } else {
                0
            }) + (if has_spell(p, SPELL_HEAL) || has_spell(p, SPELL_BARRIER) {
                2
            } else {
                0
            })
        },
        |p| p.minions_killed,
    );
    result[bottom] = TeamPosition::Bottom;

    // 4. 剩两人分上/中：战士 +4，法师/刺客 −4，传送 +1
    let top = pick(
        players,
        &mut remaining,
        |p| {
            (if FIGHTER_CHAMPIONS.contains(&p.champion_id) {
                4
            } else {
                0
            }) + (if MAGE_CHAMPIONS.contains(&p.champion_id)
                || ASSASSIN_CHAMPIONS.contains(&p.champion_id)
            {
                -4
            } else {
                0
            }) + (if has_spell(p, SPELL_TELEPORT) { 1 } else { 0 })
        },
        |_| 0,
    );
    result[top] = TeamPosition::Top;
    result[remaining[0]] = TeamPosition::Middle;

    result
}

/// 整队求解（TS `snapshot.ts#buildTeamPositionMap`）：有分路模式下，每支恰 5 人的队伍
/// 走 [`assign_team_positions`]；LCU 下发了真实 teamPosition 的成员保留真实值。
///
/// # 返回
/// participantId → 分路；不满足条件（无分路 / 非 5 人队）的成员不在表里
fn build_team_position_map(
    players: &[PlayerInput],
    has_lanes: bool,
    queue_id: i64,
) -> HashMap<i64, TeamPosition> {
    let mut map = HashMap::new();
    if !has_lanes {
        return map;
    }
    // 队伍按首次出现顺序分组（TS Map 插入序）
    let mut by_team: Vec<(i64, Vec<&PlayerInput>)> = Vec::new();
    for p in players {
        match by_team
            .iter_mut()
            .find(|(team_id, _)| *team_id == p.team_id)
        {
            Some((_, list)) => list.push(p),
            None => by_team.push((p.team_id, vec![p])),
        }
    }
    for (_, team) in &by_team {
        if team.len() != 5 {
            continue;
        }
        let inputs: Vec<PositionAssignInput> = team
            .iter()
            .map(|p| PositionAssignInput {
                champion_id: p.champion_id,
                spell_ids: p.spell_ids.to_vec(),
                minions_killed: p.stats.total_minions_killed,
                jungle_minions_killed: p.stats.neutral_minions_killed,
                participant_id: Some(p.participant_id),
            })
            .collect();
        let assigned = assign_team_positions(&inputs, Some(queue_id));
        for (i, p) in team.iter().enumerate() {
            let pos = TeamPosition::parse_lane(&p.lcu_team_position).unwrap_or(assigned[i]);
            map.insert(p.participant_id, pos);
        }
    }
    map
}

/// 快照分路（TS `buildMatchSnapshot` 里 `teamPosition` 的三级取值），与输入同序。
///
/// 优先级：SGP 真值（仅有分路模式采信，TS `truthPositionMap`）→ 整队求解
/// （[`build_team_position_map`]）→ 逐人启发式（TS `readTeamPosition`）。
pub fn resolve_positions(
    players: &[PlayerInput],
    has_lanes: bool,
    queue_id: i64,
) -> Vec<TeamPosition> {
    let team_map = build_team_position_map(players, has_lanes, queue_id);
    players
        .iter()
        .map(|p| {
            let truth = if has_lanes { p.truth_position } else { None };
            truth
                .or_else(|| team_map.get(&p.participant_id).copied())
                .unwrap_or_else(|| {
                    infer_team_position(&PositionInferInput {
                        team_position: &p.lcu_team_position,
                        spell_ids: &p.spell_ids,
                        champion_id: p.champion_id,
                    })
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use TeamPosition::{Bottom, Jungle, Middle, Top, Unknown, Utility};

    fn infer(team_position: &str, spell_ids: &[i64], champion_id: i64) -> TeamPosition {
        infer_team_position(&PositionInferInput {
            team_position,
            spell_ids,
            champion_id,
        })
    }

    // ═════ positionInfer.spec.ts ═════
    #[test]
    fn should_pass_through_explicit_position() {
        assert_eq!(infer("JUNGLE", &[4, 11], 64), Jungle);
    }

    #[test]
    fn should_fall_through_on_empty_position() {
        assert_eq!(infer("", &[4, 11], 64), Jungle);
    }

    #[test]
    fn should_fall_through_on_none_position() {
        assert_eq!(infer("NONE", &[4, 11], 64), Jungle);
    }

    #[test]
    fn should_infer_jungle_from_smite_regardless_of_champion() {
        assert_eq!(infer("", &[4, 11], 22), Jungle); // 寒冰（ADC）带惩戒
    }

    #[test]
    fn should_infer_top_from_teleport_fighter() {
        assert_eq!(infer("", &[4, 12], 86), Top); // 盖伦
    }

    #[test]
    fn should_infer_middle_from_teleport_mage() {
        assert_eq!(infer("", &[4, 12], 1), Middle); // 安妮
    }

    #[test]
    fn should_infer_middle_from_ignite_assassin() {
        assert_eq!(infer("", &[4, 14], 91), Middle); // 男刀
    }

    #[test]
    fn should_infer_bottom_from_heal_adc() {
        assert_eq!(infer("", &[4, 7], 22), Bottom);
    }

    #[test]
    fn should_infer_bottom_from_barrier_adc() {
        assert_eq!(infer("", &[4, 21], 51), Bottom); // 女警
    }

    #[test]
    fn should_infer_utility_from_heal_support() {
        assert_eq!(infer("", &[4, 7], 412), Utility); // 锤石
    }

    #[test]
    fn should_infer_utility_from_exhaust_support() {
        assert_eq!(infer("", &[4, 3], 117), Utility); // 璐璐
    }

    #[test]
    fn should_fall_back_to_bottom_for_adc_without_spell_signal() {
        assert_eq!(infer("", &[4, 6], 21), Bottom); // 赏金猎人 闪现+疾行
    }

    #[test]
    fn should_fall_back_to_utility_for_support_with_ignite() {
        assert_eq!(infer("", &[4, 14], 412), Utility);
    }

    #[test]
    fn should_not_fall_back_for_fighter() {
        assert_eq!(infer("", &[4, 6], 122), Unknown); // 诺手
    }

    #[test]
    fn should_return_unknown_without_any_signal() {
        assert_eq!(infer("", &[4, 14], 999_999), Unknown);
    }

    // ═════ positionAssign.spec.ts ═════
    fn p(champion_id: i64, spell_ids: &[i64], cs: i64, jungle_cs: i64) -> PositionAssignInput {
        PositionAssignInput {
            champion_id,
            spell_ids: spell_ids.to_vec(),
            minions_killed: cs,
            jungle_minions_killed: jungle_cs,
            participant_id: None,
        }
    }

    fn with_pid(pid: i64, input: PositionAssignInput) -> PositionAssignInput {
        PositionAssignInput {
            participant_id: Some(pid),
            ..input
        }
    }

    /// 败方：蛮王(上) 男枪(野) 卢锡安(下) 维克托(中) 星籁歌姬(辅)
    fn team_loss() -> Vec<PositionAssignInput> {
        vec![
            p(23, &[14, 6], 206, 4),
            p(104, &[11, 4], 32, 164),
            p(236, &[4, 1], 150, 0),
            p(112, &[4, 12], 175, 0),
            p(147, &[4, 14], 50, 0),
        ]
    }

    /// 胜方：波比(上) 悟空(野) 阿狸(中) 女枪(下) 基兰(辅)
    fn team_win() -> Vec<PositionAssignInput> {
        vec![
            p(78, &[14, 4], 141, 0),
            p(62, &[11, 4], 29, 184),
            p(103, &[14, 4], 172, 8),
            p(21, &[4, 21], 196, 0),
            p(26, &[4, 3], 50, 0),
        ]
    }

    /// 2026-10-25 单双排蓝方：悟空点燃上单、维克托传送下路（APC 配悠米）
    fn team_apc_bot() -> Vec<PositionAssignInput> {
        vec![
            with_pid(1, p(62, &[14, 4], 208, 0)),
            with_pid(2, p(64, &[4, 11], 46, 236)),
            with_pid(3, p(246, &[14, 4], 188, 29)),
            with_pid(4, p(112, &[4, 12], 207, 0)),
            with_pid(5, p(350, &[3, 7], 27, 4)),
        ]
    }

    const SLOT_ORDER: [TeamPosition; 5] = [Top, Jungle, Middle, Bottom, Utility];

    #[test]
    fn should_assign_real_losing_team() {
        assert_eq!(
            assign_team_positions(&team_loss(), None),
            vec![Top, Jungle, Bottom, Middle, Utility]
        );
    }

    #[test]
    fn should_assign_real_winning_team() {
        assert_eq!(
            assign_team_positions(&team_win(), None),
            vec![Top, Jungle, Middle, Bottom, Utility]
        );
    }

    #[test]
    fn should_pick_jungle_by_smite_then_jungle_cs() {
        let team = vec![
            p(23, &[14, 6], 200, 0),
            p(64, &[4, 14], 40, 150), // 盲僧没带惩戒但野怪 150
            p(236, &[4, 7], 160, 0),
            p(112, &[4, 12], 170, 0),
            p(147, &[4, 14], 30, 0),
        ];
        assert_eq!(assign_team_positions(&team, None)[1], Jungle);
    }

    #[test]
    fn should_fall_back_per_player_when_team_not_five() {
        let team = vec![p(104, &[11, 4], 32, 164), p(51, &[4, 7], 200, 0)];
        assert_eq!(assign_team_positions(&team, None), vec![Jungle, Bottom]);
    }

    #[test]
    fn should_assign_each_position_exactly_once() {
        let out: HashSet<TeamPosition> = assign_team_positions(&team_loss(), None)
            .into_iter()
            .collect();
        assert_eq!(out.len(), 5);
    }

    #[test]
    fn should_use_participant_slots_for_ranked_queue() {
        assert_eq!(
            assign_team_positions(&team_apc_bot(), Some(420)),
            SLOT_ORDER.to_vec()
        );
    }

    #[test]
    fn should_use_slots_for_red_side_in_flex() {
        let red: Vec<PositionAssignInput> = team_apc_bot()
            .into_iter()
            .map(|x| PositionAssignInput {
                participant_id: x.participant_id.map(|id| id + 5),
                ..x
            })
            .collect();
        assert_eq!(assign_team_positions(&red, Some(440)), SLOT_ORDER.to_vec());
    }

    #[test]
    fn should_return_in_input_order_when_shuffled() {
        let t = team_apc_bot();
        let shuffled = vec![
            t[3].clone(),
            t[0].clone(),
            t[4].clone(),
            t[1].clone(),
            t[2].clone(),
        ];
        assert_eq!(
            assign_team_positions(&shuffled, Some(420)),
            vec![Bottom, Top, Utility, Jungle, Middle]
        );
    }

    #[test]
    fn should_distrust_slots_when_slot_two_is_not_jungler() {
        let mut swapped = vec![
            with_pid(1, p(64, &[4, 11], 46, 236)),
            with_pid(2, p(62, &[14, 4], 208, 0)),
        ];
        swapped.extend(team_apc_bot().into_iter().skip(2));
        assert_eq!(assign_team_positions(&swapped, Some(420))[0], Jungle);
    }

    #[test]
    fn should_distrust_slots_in_blind_queue() {
        assert_ne!(
            assign_team_positions(&team_apc_bot(), Some(430)),
            SLOT_ORDER.to_vec()
        );
    }

    #[test]
    fn should_fall_back_to_exclusion_without_participant_ids() {
        assert_eq!(
            assign_team_positions(&team_loss(), Some(420)),
            vec![Top, Jungle, Bottom, Middle, Utility]
        );
    }
}
