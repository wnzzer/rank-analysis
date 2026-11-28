//! # 模式判定（TS `src/services/ai/shared/modeContext.ts`）
//!
//! 把 queueId / gameMode 翻译成模式语义：
//! - ranked：召唤师峡谷有 BP 的模式
//! - augment：强化系统模式（海克斯乱斗、斗魂竞技场）
//! - aram：随机英雄但无强化系统的模式
//! - 其余：TS 兜底与 aram 完全相同（`kind` 也是 `aram`，`Unknown` 从不产出，见计划「TS 疑似问题」）

use serde::{Deserialize, Serialize};

/// 模式大类（TS `ModeKind`）
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModeKind {
    Ranked,
    Aram,
    Augment,
    /// TS 类型里有，但 `classifyMode` 从不返回
    Unknown,
}

/// 英雄分配方式（TS `'pick' | 'random' | 'random-with-bench'`）
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChampionAssignment {
    Pick,
    Random,
    RandomWithBench,
}

/// 模式语义描述符（TS `ModeContext`，字段名一致）
///
/// - `has_lanes`：是否有上中下打野辅助分路（决定分路求解与对位差值）
/// - `has_item_build`：是否展示出装（强化模式为否，`items` 输出空数组）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModeContext {
    pub kind: ModeKind,
    pub description: String,
    pub has_lanes: bool,
    pub has_item_build: bool,
    pub has_augment_system: bool,
    pub champion_assignment: ChampionAssignment,
    pub is_team_mode: bool,
}

/// 有分路的召唤师峡谷队列：TS `RANKED_QUEUE_IDS`（单双 420、灵活 440、匹配 430、快速 480/490、
/// 冠军杯 700）再加普通征召 400——登记 P1-F1：TS 漏了 400，使它落入兜底按大乱斗处理，
/// 与 `position.rs` 把 400 当选秀局（按槽位分路）矛盾
const RANKED_QUEUE_IDS: [i64; 7] = [400, 420, 440, 430, 480, 490, 700];
/// TS `ARAM_QUEUE_IDS`：大乱斗 450、无限火力 900、觉醒之战 1300、1900
const ARAM_QUEUE_IDS: [i64; 4] = [450, 900, 1300, 1900];
/// TS `AUGMENT_QUEUE_IDS`：斗魂 1700、海克斯乱斗 2400
const AUGMENT_QUEUE_IDS: [i64; 2] = [1700, 2400];

const RANKED_DESCRIPTION: &str = concat!(
    "5v5 召唤师峡谷。玩家自选英雄，有 BP 阶段，分上中下打野辅助五个位置。",
    "可基于位置、英雄熟练度、对线克制、装备走向分析。"
);
const ARAM_DESCRIPTION: &str = concat!(
    "大乱斗类（单线、随机英雄）。玩家英雄是随机分配的，无打野，无传统路位。",
    "禁止用\"补位\"或\"英雄选择\"评价。评价应侧重团战参与、伤害承伤、节奏感。"
);

/// 按 queueId / gameMode 判定模式（分支顺序与 TS 一致：斗魂 → 强化队列 → 排位类 → 大乱斗类 → 兜底）
pub fn classify_mode(queue_id: i64, game_mode: &str) -> ModeContext {
    if game_mode == "CHERRY" || queue_id == 1700 {
        return build_augment_context(queue_id, game_mode, true);
    }
    if AUGMENT_QUEUE_IDS.contains(&queue_id) {
        return build_augment_context(queue_id, game_mode, false);
    }
    if RANKED_QUEUE_IDS.contains(&queue_id) {
        return build_ranked_context();
    }
    if ARAM_QUEUE_IDS.contains(&queue_id) {
        return build_aram_context();
    }
    // TS：`{ ...buildAramContext(), kind: 'aram' }`
    ModeContext {
        kind: ModeKind::Aram,
        ..build_aram_context()
    }
}

fn build_ranked_context() -> ModeContext {
    ModeContext {
        kind: ModeKind::Ranked,
        description: RANKED_DESCRIPTION.to_string(),
        has_lanes: true,
        has_item_build: true,
        has_augment_system: false,
        champion_assignment: ChampionAssignment::Pick,
        is_team_mode: false,
    }
}

fn build_aram_context() -> ModeContext {
    ModeContext {
        kind: ModeKind::Aram,
        description: ARAM_DESCRIPTION.to_string(),
        has_lanes: false,
        has_item_build: true,
        has_augment_system: false,
        champion_assignment: ChampionAssignment::RandomWithBench,
        is_team_mode: false,
    }
}

fn build_augment_context(queue_id: i64, game_mode: &str, is_team_mode: bool) -> ModeContext {
    let team_mode_line = if is_team_mode {
        "本模式为 2v2 配对（每队两人），评价应包含双人配合。"
    } else {
        ""
    };
    ModeContext {
        kind: ModeKind::Augment,
        description: format!(
            "强化模式（queueId={queue_id}, gameMode={game_mode}）。英雄随机分配，有强化系统。\
             评价应侧重强化构筑选择、套装搭配、与队友强化的协同。\
             禁止评价装备出装顺序或对线。{team_mode_line}"
        ),
        has_lanes: false,
        has_item_build: false,
        has_augment_system: true,
        champion_assignment: ChampionAssignment::Random,
        is_team_mode,
    }
}

/// TS `snapshot.ts#isAugmentMode`：斗魂 / 海克斯乱斗，或队列中文名含二者之一。
///
/// # 参数
/// - `queue_name`: 队列中文名；`None` 等同 TS `game.queueName || ''`
pub fn is_augment_mode(game_mode: &str, queue_id: i64, queue_name: Option<&str>) -> bool {
    let name = queue_name.unwrap_or("");
    game_mode == "CHERRY"
        || queue_id == 2400
        || queue_id == 1700
        || name.contains("斗魂竞技场")
        || name.contains("海克斯乱斗")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ranked ──
    #[test]
    fn should_classify_420_as_ranked() {
        let ctx = classify_mode(420, "CLASSIC");
        assert_eq!(ctx.kind, ModeKind::Ranked);
        assert!(ctx.has_lanes);
        assert!(ctx.has_item_build);
        assert!(!ctx.has_augment_system);
        assert_eq!(ctx.champion_assignment, ChampionAssignment::Pick);
        assert!(!ctx.is_team_mode);
    }

    #[test]
    fn should_classify_440_as_ranked() {
        assert_eq!(classify_mode(440, "CLASSIC").kind, ModeKind::Ranked);
    }

    #[test]
    fn should_classify_430_as_ranked() {
        assert_eq!(classify_mode(430, "CLASSIC").kind, ModeKind::Ranked);
    }

    #[test]
    fn should_classify_480_and_490_as_ranked() {
        assert_eq!(classify_mode(480, "CLASSIC").kind, ModeKind::Ranked);
        assert_eq!(classify_mode(490, "CLASSIC").kind, ModeKind::Ranked);
    }

    // P1-F1：TS 的 RANKED_QUEUE_IDS 漏了 400，落入兜底按大乱斗处理（hasLanes=false）
    #[test]
    fn should_classify_400_as_ranked_with_lanes() {
        let ctx = classify_mode(400, "CLASSIC");
        assert_eq!(ctx.kind, ModeKind::Ranked);
        assert!(ctx.has_lanes);
        assert_eq!(ctx.champion_assignment, ChampionAssignment::Pick);
        assert_eq!(ctx, classify_mode(420, "CLASSIC"));
    }

    #[test]
    fn should_mention_rift_and_bp_in_ranked_description() {
        let ctx = classify_mode(420, "CLASSIC");
        assert!(ctx.description.contains("召唤师峡谷"));
        assert!(ctx.description.contains("BP"));
    }

    // ── augment ──
    #[test]
    fn should_classify_cherry_as_team_augment() {
        let ctx = classify_mode(1700, "CHERRY");
        assert_eq!(ctx.kind, ModeKind::Augment);
        assert!(ctx.is_team_mode);
        assert!(ctx.has_augment_system);
        assert!(!ctx.has_item_build);
        assert_eq!(ctx.champion_assignment, ChampionAssignment::Random);
    }

    #[test]
    fn should_classify_2400_as_solo_augment() {
        let ctx = classify_mode(2400, "ARAM");
        assert_eq!(ctx.kind, ModeKind::Augment);
        assert!(!ctx.is_team_mode);
        assert!(ctx.has_augment_system);
    }

    #[test]
    fn should_mention_augment_but_not_bp_for_2400() {
        let ctx = classify_mode(2400, "ARAM");
        assert!(ctx.description.contains("强化"));
        assert!(!ctx.description.contains("BP"));
    }

    #[test]
    fn should_mention_2v2_for_cherry() {
        assert!(classify_mode(1700, "CHERRY").description.contains("2v2"));
    }

    // ── aram ──
    #[test]
    fn should_classify_450_as_aram() {
        let ctx = classify_mode(450, "ARAM");
        assert_eq!(ctx.kind, ModeKind::Aram);
        assert!(!ctx.has_lanes);
        assert!(ctx.has_item_build);
        assert!(!ctx.has_augment_system);
        assert_eq!(ctx.champion_assignment, ChampionAssignment::RandomWithBench);
    }

    #[test]
    fn should_classify_1300_as_aram() {
        assert_eq!(classify_mode(1300, "ONEFORALL").kind, ModeKind::Aram);
    }

    #[test]
    fn should_classify_900_as_aram() {
        assert_eq!(classify_mode(900, "URF").kind, ModeKind::Aram);
    }

    #[test]
    fn should_mention_random_but_not_lanes_for_aram() {
        let ctx = classify_mode(450, "ARAM");
        assert!(ctx.description.contains("随机"));
        assert!(!ctx.description.contains("上中下打野辅助"));
    }

    // ── unknown fallback ──
    #[test]
    fn should_fall_back_to_aram_for_unknown_queue() {
        let ctx = classify_mode(9999, "UNKNOWN_GAMEMODE");
        assert_eq!(ctx.kind, ModeKind::Aram);
        assert!(!ctx.has_lanes);
    }

    // ── snapshot.spec.ts: isAugmentMode helper still works ──
    #[test]
    fn should_detect_augment_mode_helper() {
        assert!(is_augment_mode("CHERRY", 1700, Some("排位")));
        assert!(!is_augment_mode("CLASSIC", 420, Some("排位")));
    }

    // 新增：描述原文逐字固定（快照对拍会比对 modeContext.description）
    #[test]
    fn should_keep_descriptions_identical_to_ts() {
        assert_eq!(
            classify_mode(420, "CLASSIC").description,
            "5v5 召唤师峡谷。玩家自选英雄，有 BP 阶段，分上中下打野辅助五个位置。可基于位置、英雄熟练度、对线克制、装备走向分析。"
        );
        assert_eq!(
            classify_mode(450, "ARAM").description,
            "大乱斗类（单线、随机英雄）。玩家英雄是随机分配的，无打野，无传统路位。禁止用\"补位\"或\"英雄选择\"评价。评价应侧重团战参与、伤害承伤、节奏感。"
        );
        assert_eq!(
            classify_mode(1700, "CHERRY").description,
            "强化模式（queueId=1700, gameMode=CHERRY）。英雄随机分配，有强化系统。评价应侧重强化构筑选择、套装搭配、与队友强化的协同。禁止评价装备出装顺序或对线。本模式为 2v2 配对（每队两人），评价应包含双人配合。"
        );
        assert_eq!(
            classify_mode(2400, "ARAM").description,
            "强化模式（queueId=2400, gameMode=ARAM）。英雄随机分配，有强化系统。评价应侧重强化构筑选择、套装搭配、与队友强化的协同。禁止评价装备出装顺序或对线。"
        );
    }
}
