//! # 中立输入与适配层
//!
//! - [`MatchInput`]：分析核心唯一的输入，与数据来源无关；名称已由调用方的 [`NameTable`] 填好，
//!   时间线 participantId 已是 LCU 口径
//! - [`from_lcu`]：LCU 对局（app 路径 / 回归 fixture）→ `MatchInput`，负责 TS `remapTimeline` 的工作
//! - `from_sgp`（T6）：SGP SUMMARY（基准管线，子项目 3）→ `MatchInput`
//!
//! TS 对应：`snapshot.ts` 里读 `Game` 的部分、`timeline/remap.ts`、`summonerSpells.ts`、`champion-names.ts#getChampionName`。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::position::TeamPosition;
use crate::lcu::api::match_history::Game;
use crate::lcu::api::timeline::{
    SlimEvent, SlimFrame, SlimParticipant, SlimPlayerFrame, SlimTimeline,
};

// ─────────────────────────── 中立输入 ───────────────────────────

/// 一局对局的中立输入。
///
/// - `queue_name`: 队列中文名；原始 LCU JSON 无此字段时为 `None`（TS 快照里该键缺失）
/// - `players`: 顺序即 TS `getParticipants` 的顺序（gameDetail 优先），快照玩家顺序沿用
/// - `timeline`: 已 remap 到 LCU participantId 的裁剪时间线（P1 只用到 participants）
/// - `me_puuid`: 「本人」的 puuid（战绩查询对象，LCU 路径由调用方传入；SGP 路径为 `None`），
///   `players[].is_me` 据此判定（登记 P1-F2）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchInput {
    pub game_id: i64,
    pub queue_id: i64,
    pub queue_name: Option<String>,
    pub game_mode: String,
    pub map_id: i64,
    pub duration_seconds: i64,
    pub players: Vec<PlayerInput>,
    pub timeline: Option<SlimTimeline>,
    pub me_puuid: Option<String>,
}

/// 一名玩家的中立输入。
///
/// - `name`: 显示名：`gameName#tagLine` → `gameName` → `summonerName` → `未知玩家`（登记 P1-F4），
///   缺整条身份为 `玩家<pid>`（同 TS）
/// - `is_me`: 本人判定。`me_puuid` 与本玩家 puuid 都非空时按 puuid 相等（登记 P1-F2，改名不误判），
///   否则退回 TS 的显示名比较（`displayName === currentPlayerKey`）
/// - `lcu_team_position`: LCU participant 的 `teamPosition` 原值，缺失为 `""`
/// - `lane` / `role`: LCU `participant.timeline.lane/role`，缺失为 `""`
/// - `truth_position`: SGP SUMMARY 真实分路（只收五个合法值）；是否采信由快照按 `hasLanes` 决定
/// - `sgp_*`: SGP SUMMARY 终局指标，优先于 LCU 同名字段（TS `sgpScoringInputs`）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInput {
    pub participant_id: i64,
    pub team_id: i64,
    pub name: String,
    pub puuid: String,
    pub is_me: bool,
    pub champion_id: i64,
    pub champion_name: String,
    pub spell_ids: [i64; 2],
    pub spell_names: Vec<String>,
    pub lcu_team_position: String,
    pub lane: String,
    pub role: String,
    pub truth_position: Option<TeamPosition>,
    pub sgp_vision_score: Option<i64>,
    pub sgp_objective_damage: Option<i64>,
    pub sgp_cc_seconds: Option<i64>,
    pub stats: PlayerStats,
}

/// 终局统计（LCU `stats` 中快照用到的字段）。`Option` 字段缺失即 `None`，不能伪装成 0。
///
/// - `augments`: playerAugment1..6；`items`: item0..5；`trinket_id`: item6
/// - `double_kills` 等：TS `?? 0`，缺失为 0
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub win: bool,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub gold_earned: i64,
    pub total_damage_dealt_to_champions: i64,
    pub total_damage_taken: i64,
    pub total_heal: i64,
    pub damage_dealt_to_turrets: i64,
    pub total_minions_killed: i64,
    pub neutral_minions_killed: i64,
    pub perk0: i64,
    pub perk_sub_style: i64,
    pub augments: [i64; 6],
    pub items: [i64; 6],
    pub trinket_id: i64,
    pub damage_dealt_to_objectives: Option<i64>,
    #[serde(rename = "timeCCingOthers")]
    pub time_c_cing_others: Option<i64>,
    pub vision_score: Option<i64>,
    pub sight_wards_bought_in_game: Option<i64>,
    pub vision_wards_bought_in_game: Option<i64>,
    pub double_kills: i64,
    pub triple_kills: i64,
    pub quadra_kills: i64,
    pub penta_kills: i64,
}

// ─────────────────────────── 名称表 ───────────────────────────

/// 调用方传入的名称表：核心计算不查任何全局表，保证测试与对拍确定性。
///
/// # 示例
/// ```
/// use std::collections::HashMap;
/// use rank_analysis_lib::match_analysis::input::NameTable;
/// let names = NameTable::new(HashMap::from([(64, "盲僧".to_string())]));
/// assert_eq!(names.champion_name(64), "盲僧");
/// assert_eq!(names.champion_name(1), "英雄1");
/// assert_eq!(names.spell_name(4), "闪现");
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct NameTable {
    pub champions: HashMap<i64, String>,
    pub spells: HashMap<i64, String>,
    /// 技能 id 查不到时的兜底名
    pub spell_fallback: String,
}

impl NameTable {
    /// 英雄名表 + 内置召唤师技能表（[`builtin_spell_names`]）
    pub fn new(champions: HashMap<i64, String>) -> Self {
        Self {
            champions,
            spells: builtin_spell_names(),
            spell_fallback: "未知技能".to_string(),
        }
    }

    /// 自带技能名表与兜底名（对拍时直接用黄金里的表，不依赖内置表）
    pub fn with_spells(
        champions: HashMap<i64, String>,
        spells: HashMap<i64, String>,
        spell_fallback: String,
    ) -> Self {
        Self {
            champions,
            spells,
            spell_fallback,
        }
    }

    /// TS `getChampionName`：`championNameMap[id] || 英雄<id>`（空串也走占位）
    pub fn champion_name(&self, id: i64) -> String {
        match self.champions.get(&id) {
            Some(name) if !name.is_empty() => name.clone(),
            _ => format!("英雄{id}"),
        }
    }

    /// TS `spellIdToName`：`SPELL_NAMES[id] ?? '未知技能'`
    pub fn spell_name(&self, id: i64) -> String {
        self.spells
            .get(&id)
            .cloned()
            .unwrap_or_else(|| self.spell_fallback.clone())
    }

    /// TS `spellIdsToNames`
    pub fn spell_names(&self, ids: &[i64]) -> Vec<String> {
        ids.iter().map(|&id| self.spell_name(id)).collect()
    }
}

impl Default for NameTable {
    /// 空英雄名表（全部 `英雄<id>`）+ 内置技能表
    fn default() -> Self {
        Self::new(HashMap::new())
    }
}

/// 召唤师技能中文名，与 TS `summonerSpells.ts` 的 `SPELL_NAMES` 逐项相同
pub fn builtin_spell_names() -> HashMap<i64, String> {
    [
        (1, "净化"),
        (3, "虚弱"),
        (4, "闪现"),
        (6, "幽魂"),
        (7, "治疗"),
        (11, "惩戒"),
        (12, "传送"),
        (13, "洞悉"),
        (14, "点燃"),
        (21, "屏障"),
        (32, "雪球"),
    ]
    .into_iter()
    .map(|(id, name)| (id, name.to_string()))
    .collect()
}

// ─────────────────────────── LCU 宽松视图 ───────────────────────────

/// LCU 对局的宽松视图（TS `Game` 实际被读到的字段），全部字段缺省可空。
///
/// 同时接受原始 LCU JSON（回归 fixture）与 app 序列化给前端的 `Game` JSON。
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LcuGame {
    pub game_id: i64,
    pub queue_id: i64,
    pub queue_name: Option<String>,
    pub game_mode: String,
    pub map_id: i64,
    pub game_duration: i64,
    pub platform_id: String,
    pub participant_identities: Vec<LcuIdentity>,
    pub participants: Vec<LcuParticipant>,
    pub game_detail: Option<LcuGameDetail>,
}

/// `gameDetail`：10 人完整数据
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LcuGameDetail {
    pub participant_identities: Vec<LcuIdentity>,
    pub participants: Vec<LcuParticipant>,
}

/// 参与者身份
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct LcuIdentity {
    pub player: Option<LcuPlayer>,
}

/// 身份里的玩家信息
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LcuPlayer {
    pub game_name: Option<String>,
    pub tag_line: Option<String>,
    /// 旧版召唤师名；只在缺 `gameName` 时作显示名兜底（登记 P1-F4）
    pub summoner_name: Option<String>,
    pub puuid: Option<String>,
}

/// 参与者；`team_position` / `timeline` 只有原始 LCU JSON 才可能有
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LcuParticipant {
    pub participant_id: i64,
    pub team_id: i64,
    pub champion_id: i64,
    pub spell1_id: i64,
    pub spell2_id: i64,
    pub team_position: Option<String>,
    pub stats: LcuStats,
    pub timeline: Option<LcuParticipantTimeline>,
}

/// `participant.timeline`（只取 lane / role）
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct LcuParticipantTimeline {
    pub lane: Option<String>,
    pub role: Option<String>,
}

/// `participant.stats`
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LcuStats {
    pub win: bool,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub gold_earned: i64,
    pub total_damage_dealt_to_champions: i64,
    pub total_damage_taken: i64,
    pub total_heal: i64,
    pub damage_dealt_to_turrets: i64,
    pub total_minions_killed: i64,
    pub neutral_minions_killed: i64,
    pub perk0: i64,
    pub perk_sub_style: i64,
    pub player_augment1: i64,
    pub player_augment2: i64,
    pub player_augment3: i64,
    pub player_augment4: i64,
    pub player_augment5: i64,
    pub player_augment6: i64,
    pub item0: i64,
    pub item1: i64,
    pub item2: i64,
    pub item3: i64,
    pub item4: i64,
    pub item5: i64,
    pub item6: i64,
    pub damage_dealt_to_objectives: Option<i64>,
    #[serde(rename = "timeCCingOthers")]
    pub time_c_cing_others: Option<i64>,
    pub vision_score: Option<i64>,
    pub sight_wards_bought_in_game: Option<i64>,
    pub vision_wards_bought_in_game: Option<i64>,
    pub double_kills: Option<i64>,
    pub triple_kills: Option<i64>,
    pub quadra_kills: Option<i64>,
    pub penta_kills: Option<i64>,
}

impl From<&LcuStats> for PlayerStats {
    fn from(s: &LcuStats) -> Self {
        PlayerStats {
            win: s.win,
            kills: s.kills,
            deaths: s.deaths,
            assists: s.assists,
            gold_earned: s.gold_earned,
            total_damage_dealt_to_champions: s.total_damage_dealt_to_champions,
            total_damage_taken: s.total_damage_taken,
            total_heal: s.total_heal,
            damage_dealt_to_turrets: s.damage_dealt_to_turrets,
            total_minions_killed: s.total_minions_killed,
            neutral_minions_killed: s.neutral_minions_killed,
            perk0: s.perk0,
            perk_sub_style: s.perk_sub_style,
            augments: [
                s.player_augment1,
                s.player_augment2,
                s.player_augment3,
                s.player_augment4,
                s.player_augment5,
                s.player_augment6,
            ],
            items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5],
            trinket_id: s.item6,
            damage_dealt_to_objectives: s.damage_dealt_to_objectives,
            time_c_cing_others: s.time_c_cing_others,
            vision_score: s.vision_score,
            sight_wards_bought_in_game: s.sight_wards_bought_in_game,
            vision_wards_bought_in_game: s.vision_wards_bought_in_game,
            double_kills: s.double_kills.unwrap_or(0),
            triple_kills: s.triple_kills.unwrap_or(0),
            quadra_kills: s.quadra_kills.unwrap_or(0),
            penta_kills: s.penta_kills.unwrap_or(0),
        }
    }
}

/// 缺显示名时的兜底（登记 P1-F4）
const UNKNOWN_PLAYER_NAME: &str = "未知玩家";

/// 玩家显示名（登记 P1-F4，TS `buildDisplayName` 的修正版）。
///
/// 规则（空串视同缺失）：`gameName` 与 `tagLine` 都有 → `gameName#tagLine`；只有 `gameName` →
/// `gameName`；否则 `summonerName`；都没有（含缺 `player`）→ `未知玩家`。绝不输出 `undefined`
/// （TS 缺字段时拼出 `undefined#undefined`，缺 `player` 直接抛错）。
fn player_display_name(player: Option<&LcuPlayer>) -> String {
    let non_empty = |v: Option<&String>| v.filter(|s| !s.is_empty()).cloned();
    let game_name = non_empty(player.and_then(|p| p.game_name.as_ref()));
    let tag_line = non_empty(player.and_then(|p| p.tag_line.as_ref()));
    let summoner_name = non_empty(player.and_then(|p| p.summoner_name.as_ref()));
    match (game_name, tag_line) {
        (Some(g), Some(t)) => format!("{g}#{t}"),
        (Some(g), None) => g,
        (None, _) => summoner_name.unwrap_or_else(|| UNKNOWN_PLAYER_NAME.to_string()),
    }
}

/// 快照里的显示名：缺整条身份时同 TS 为 `玩家<pid>`，否则 [`player_display_name`]
fn display_name(identity: Option<&LcuIdentity>, fallback_id: i64) -> String {
    match identity {
        None => format!("玩家{fallback_id}"),
        Some(identity) => player_display_name(identity.player.as_ref()),
    }
}

impl LcuGame {
    /// app 路径：把 Rust `Game` 走一次 serde 往返，得到前端 TS 实际看到的形状
    pub fn from_app_game(game: &Game) -> Result<Self, String> {
        let value = serde_json::to_value(game).map_err(|e| format!("序列化 Game 失败: {e}"))?;
        serde_json::from_value(value).map_err(|e| format!("Game 转 LcuGame 失败: {e}"))
    }

    /// TS `getParticipants`：gameDetail 有参与者时用它，否则用顶层
    pub fn snapshot_participants(&self) -> &[LcuParticipant] {
        match &self.game_detail {
            Some(d) if !d.participants.is_empty() => &d.participants,
            _ => &self.participants,
        }
    }

    /// TS `getParticipantIdentities` / `buildPuuidMap` 的身份来源：gameDetail 有身份时用它
    pub fn snapshot_identities(&self) -> &[LcuIdentity] {
        match &self.game_detail {
            Some(d) if !d.participant_identities.is_empty() => &d.participant_identities,
            _ => &self.participant_identities,
        }
    }

    /// TS `getCurrentPlayerKey`：**顶层**身份第一个（战绩查询对象）的显示名，无则 `""`。
    /// 与玩家显示名同一套兜底规则（登记 P1-F4），否则缺 tagLine 的本人会对不上。
    pub fn current_player_key(&self) -> String {
        match self
            .participant_identities
            .first()
            .and_then(|i| i.player.as_ref())
        {
            Some(p) => player_display_name(Some(p)),
            None => String::new(),
        }
    }
}

// ─────────────────────────── 时间线 remap ───────────────────────────

/// TS `buildPuuidMap`：puuid → LCU participantId（身份数组下标 + 1）。
///
/// 空 puuid 忽略；出现多次的 puuid 整体丢弃（宁可对不上记 0，也不能把两人并成一人）。
pub fn build_puuid_map(game: &LcuGame) -> HashMap<String, i64> {
    let mut out: HashMap<String, i64> = HashMap::new();
    let mut dup: HashSet<String> = HashSet::new();
    for (i, identity) in game.snapshot_identities().iter().enumerate() {
        let Some(puuid) = identity
            .player
            .as_ref()
            .and_then(|p| p.puuid.as_deref())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        if out.contains_key(puuid) {
            dup.insert(puuid.to_string());
        } else {
            out.insert(puuid.to_string(), (i + 1) as i64);
        }
    }
    for puuid in dup {
        out.remove(&puuid);
    }
    out
}

/// 事件里的 participantId 逐个改写（TS `remapTimeline` 的 switch；GAME_END 不动）
fn remap_event(e: &SlimEvent, m: &impl Fn(i64) -> i64) -> SlimEvent {
    let mut out = e.clone();
    match &mut out {
        SlimEvent::ChampionKill {
            killer_id,
            victim_id,
            assisting,
            damage_received,
            ..
        } => {
            *killer_id = m(*killer_id);
            *victim_id = m(*victim_id);
            for a in assisting.iter_mut() {
                *a = m(*a);
            }
            for d in damage_received.iter_mut() {
                d.participant_id = m(d.participant_id);
            }
        }
        SlimEvent::WardPlaced { creator_id, .. } => *creator_id = m(*creator_id),
        SlimEvent::ItemPurchased { participant_id, .. }
        | SlimEvent::ItemSold { participant_id, .. }
        | SlimEvent::ItemUndo { participant_id, .. }
        | SlimEvent::SkillLevelUp { participant_id, .. } => *participant_id = m(*participant_id),
        SlimEvent::GameEnd { .. } => {}
        SlimEvent::ChampionSpecialKill { killer_id, .. }
        | SlimEvent::EliteMonsterKill { killer_id, .. }
        | SlimEvent::BuildingKill { killer_id, .. }
        | SlimEvent::TurretPlateDestroyed { killer_id, .. }
        | SlimEvent::WardKill { killer_id, .. } => *killer_id = m(*killer_id),
    }
    out
}

/// TS `remapTimeline`：时间线所有 participantId 改写成 LCU 编号。
///
/// # 行为
/// - DETAILS 侧 puuid 为空或在时间线里出现多次 → 不可信，记 0
/// - 对不上 LCU 名册的 → 0；原值 ≤ 0 的保持原样
/// - 帧内玩家：改写后丢掉 0，再按 participantId 稳定排序
pub fn remap_timeline(tl: &SlimTimeline, lcu_pid_by_puuid: &HashMap<String, i64>) -> SlimTimeline {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    for p in &tl.participants {
        *seen.entry(p.puuid.as_str()).or_insert(0) += 1;
    }
    let mut by_details: HashMap<i64, i64> = HashMap::new();
    for p in &tl.participants {
        let trusted = !p.puuid.is_empty() && seen.get(p.puuid.as_str()) == Some(&1);
        let lcu = if trusted {
            lcu_pid_by_puuid.get(&p.puuid).copied().unwrap_or(0)
        } else {
            0
        };
        by_details.insert(p.participant_id, lcu);
    }
    let m = |pid: i64| -> i64 {
        if pid > 0 {
            by_details.get(&pid).copied().unwrap_or(0)
        } else {
            pid
        }
    };

    SlimTimeline {
        game_id: tl.game_id,
        frame_interval_ms: tl.frame_interval_ms,
        participants: tl
            .participants
            .iter()
            .map(|p| SlimParticipant {
                participant_id: m(p.participant_id),
                ..p.clone()
            })
            .collect(),
        frames: tl
            .frames
            .iter()
            .map(|f| {
                let mut players: Vec<SlimPlayerFrame> = f
                    .players
                    .iter()
                    .map(|p| SlimPlayerFrame {
                        participant_id: m(p.participant_id),
                        ..p.clone()
                    })
                    .filter(|p| p.participant_id > 0)
                    .collect();
                players.sort_by_key(|p| p.participant_id);
                SlimFrame {
                    timestamp: f.timestamp,
                    players,
                }
            })
            .collect(),
        events: tl.events.iter().map(|e| remap_event(e, &m)).collect(),
        items: tl.items.clone(),
    }
}

// ─────────────────────────── LCU 适配层 ───────────────────────────

/// LCU 对局 → 中立输入（app 路径与回归 fixture）。
///
/// # 参数
/// - `game`: LCU 对局视图（app 路径先 [`LcuGame::from_app_game`]）
/// - `timeline`: Rust `get_match_timeline` 返回的**未 remap** 裁剪时间线（SGP participantId）
/// - `names`: 调用方提供的名称表
/// - `me_puuid`: 本人（战绩查询对象）的 puuid；`None` 或空串时本人判定完全按 TS 显示名比较
///
/// # 行为
/// - 玩家顺序、身份匹配（`identities[pid-1] ?? identities[index]`）、显示名与 TS 快照一致
/// - isMe：`me_puuid` 与玩家 puuid 都非空时按 puuid 相等，否则按显示名（登记 P1-F2）
/// - 时间线按 [`build_puuid_map`] + [`remap_timeline`] 改写；remap 后 participants 里
///   pid > 0 且分路合法的写入 `truth_position`（同 pid 后者覆盖），终局指标按 pid 取最后一条
pub fn from_lcu(
    game: &LcuGame,
    timeline: Option<&SlimTimeline>,
    names: &NameTable,
    me_puuid: Option<&str>,
) -> MatchInput {
    let me_puuid = me_puuid.filter(|s| !s.is_empty());
    let participants = game.snapshot_participants();
    let identities = game.snapshot_identities();
    let current_key = game.current_player_key();
    let remapped = timeline.map(|tl| remap_timeline(tl, &build_puuid_map(game)));

    let players: Vec<PlayerInput> = {
        let mut truth: HashMap<i64, TeamPosition> = HashMap::new();
        let mut sgp: HashMap<i64, &SlimParticipant> = HashMap::new();
        if let Some(tl) = &remapped {
            for p in &tl.participants {
                if let (true, Some(pos)) = (
                    p.participant_id > 0,
                    TeamPosition::parse_lane(&p.team_position),
                ) {
                    truth.insert(p.participant_id, pos);
                }
                sgp.insert(p.participant_id, p);
            }
        }
        participants
            .iter()
            .enumerate()
            .map(|(index, p)| {
                let identity = usize::try_from(p.participant_id - 1)
                    .ok()
                    .and_then(|i| identities.get(i))
                    .or_else(|| identities.get(index));
                let name = display_name(identity, p.participant_id);
                let puuid = identity
                    .and_then(|i| i.player.as_ref())
                    .and_then(|pl| pl.puuid.clone())
                    .unwrap_or_default();
                // P1-F2：两边 puuid 都在时按 puuid 判本人（改名不误判），否则照 TS 比显示名
                let is_me = match me_puuid {
                    Some(me) if !puuid.is_empty() => puuid == me,
                    _ => name == current_key,
                };
                let sgp_p = sgp.get(&p.participant_id).copied();
                let spell_ids = [p.spell1_id, p.spell2_id];
                PlayerInput {
                    participant_id: p.participant_id,
                    team_id: p.team_id,
                    name,
                    puuid,
                    is_me,
                    champion_id: p.champion_id,
                    champion_name: names.champion_name(p.champion_id),
                    spell_ids,
                    spell_names: names.spell_names(&spell_ids),
                    lcu_team_position: p.team_position.clone().unwrap_or_default(),
                    lane: p
                        .timeline
                        .as_ref()
                        .and_then(|t| t.lane.clone())
                        .unwrap_or_default(),
                    role: p
                        .timeline
                        .as_ref()
                        .and_then(|t| t.role.clone())
                        .unwrap_or_default(),
                    truth_position: truth.get(&p.participant_id).copied(),
                    sgp_vision_score: sgp_p.and_then(|x| x.vision_score),
                    sgp_objective_damage: sgp_p.and_then(|x| x.damage_dealt_to_objectives),
                    sgp_cc_seconds: sgp_p.and_then(|x| x.time_c_cing_others),
                    stats: PlayerStats::from(&p.stats),
                }
            })
            .collect()
    };

    MatchInput {
        game_id: game.game_id,
        queue_id: game.queue_id,
        queue_name: game.queue_name.clone(),
        game_mode: game.game_mode.clone(),
        map_id: game.map_id,
        duration_seconds: game.game_duration,
        players,
        timeline: remapped,
        me_puuid: me_puuid.map(str::to_string),
    }
}

// ─────────────────────────── SGP 适配层（子项目 3 预备） ───────────────────────────

/// 有分路的队列：缺 `mapId` 时按 `scripts/baseline/corpus.ts` 推地图（有分路 11，否则 12）
const LANED_QUEUES: [i64; 2] = [420, 440];

/// SGP 单局 SUMMARY（match-v5）中用到的字段；`games.jsonl` 精简行同名同义。
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpSummary {
    pub game_id: i64,
    pub platform_id: String,
    pub queue_id: i64,
    pub game_duration: i64,
    pub game_mode: Option<String>,
    pub map_id: Option<i64>,
    pub participants: Vec<SgpParticipant>,
}

/// SGP SUMMARY 的一名参与者（缺失字段按 0 / None）
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpParticipant {
    pub participant_id: i64,
    pub team_id: i64,
    pub puuid: String,
    pub champion_id: i64,
    pub win: bool,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub total_damage_dealt_to_champions: i64,
    pub gold_earned: i64,
    pub total_minions_killed: i64,
    pub neutral_minions_killed: i64,
    pub total_damage_taken: i64,
    pub total_heal: i64,
    pub damage_dealt_to_turrets: i64,
    pub vision_score: Option<i64>,
    pub damage_dealt_to_objectives: Option<i64>,
    #[serde(rename = "timeCCingOthers")]
    pub time_c_cing_others: Option<i64>,
    pub team_position: Option<String>,
    pub summoner1_id: i64,
    pub summoner2_id: i64,
    pub riot_id_game_name: Option<String>,
    pub riot_id_tagline: Option<String>,
    pub item0: i64,
    pub item1: i64,
    pub item2: i64,
    pub item3: i64,
    pub item4: i64,
    pub item5: i64,
    pub item6: i64,
    pub double_kills: i64,
    pub triple_kills: i64,
    pub quadra_kills: i64,
    pub penta_kills: i64,
}

/// SGP SUMMARY → 中立输入（基准管线用，子项目 3 接入；P1 只做自洽冒烟）。
///
/// # 参数
/// - `summary`: SGP SUMMARY（或 games.jsonl 一行）
/// - `timeline`: 同源 DETAILS 裁剪时间线，participantId 与 SUMMARY 一致，**原样保留不 remap**
/// - `names`: 调用方提供的名称表
///
/// # 行为
/// - 真实分路 / 终局指标直接取 SUMMARY 字段（`truth_position` 只收五个合法值）
/// - 无本人概念：`is_me = false`；无 LCU 字段：`lcu_team_position` / `lane` / `role` 为 `""`
pub fn from_sgp(
    summary: &SgpSummary,
    timeline: Option<&SlimTimeline>,
    names: &NameTable,
) -> MatchInput {
    let players = summary
        .participants
        .iter()
        .map(|p| {
            let name = match (&p.riot_id_game_name, &p.riot_id_tagline) {
                (Some(g), Some(t)) if !g.is_empty() => format!("{g}#{t}"),
                _ => format!("玩家{}", p.participant_id),
            };
            let spell_ids = [p.summoner1_id, p.summoner2_id];
            PlayerInput {
                participant_id: p.participant_id,
                team_id: p.team_id,
                name,
                puuid: p.puuid.clone(),
                is_me: false,
                champion_id: p.champion_id,
                champion_name: names.champion_name(p.champion_id),
                spell_ids,
                spell_names: names.spell_names(&spell_ids),
                lcu_team_position: String::new(),
                lane: String::new(),
                role: String::new(),
                truth_position: p
                    .team_position
                    .as_deref()
                    .and_then(TeamPosition::parse_lane),
                sgp_vision_score: p.vision_score,
                sgp_objective_damage: p.damage_dealt_to_objectives,
                sgp_cc_seconds: p.time_c_cing_others,
                stats: PlayerStats {
                    win: p.win,
                    kills: p.kills,
                    deaths: p.deaths,
                    assists: p.assists,
                    gold_earned: p.gold_earned,
                    total_damage_dealt_to_champions: p.total_damage_dealt_to_champions,
                    total_damage_taken: p.total_damage_taken,
                    total_heal: p.total_heal,
                    damage_dealt_to_turrets: p.damage_dealt_to_turrets,
                    total_minions_killed: p.total_minions_killed,
                    neutral_minions_killed: p.neutral_minions_killed,
                    perk0: 0,
                    perk_sub_style: 0,
                    augments: [0; 6],
                    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5],
                    trinket_id: p.item6,
                    damage_dealt_to_objectives: p.damage_dealt_to_objectives,
                    time_c_cing_others: p.time_c_cing_others,
                    vision_score: p.vision_score,
                    sight_wards_bought_in_game: None,
                    vision_wards_bought_in_game: None,
                    double_kills: p.double_kills,
                    triple_kills: p.triple_kills,
                    quadra_kills: p.quadra_kills,
                    penta_kills: p.penta_kills,
                },
            }
        })
        .collect();

    MatchInput {
        game_id: summary.game_id,
        queue_id: summary.queue_id,
        queue_name: None,
        game_mode: summary.game_mode.clone().unwrap_or_default(),
        map_id: summary
            .map_id
            .unwrap_or(if LANED_QUEUES.contains(&summary.queue_id) {
                11
            } else {
                12
            }),
        duration_seconds: summary.game_duration,
        players,
        timeline: timeline.cloned(),
        me_puuid: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::game_detail::GameDetail;
    use crate::lcu::api::model::{Participant, ParticipantIdentity, Player, Stats};
    use crate::lcu::api::timeline::DamageSource;
    use crate::match_analysis::test_support::{make_scoring_game, regression_fixture};
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    // ═════ summonerSpells.spec.ts（技能名由 NameTable 内置表提供） ═════
    fn spell(id: i64) -> String {
        NameTable::default().spell_name(id)
    }

    #[test]
    fn should_name_spell_4_flash() {
        assert_eq!(spell(4), "闪现");
    }
    #[test]
    fn should_name_spell_12_teleport() {
        assert_eq!(spell(12), "传送");
    }
    #[test]
    fn should_name_spell_11_smite() {
        assert_eq!(spell(11), "惩戒");
    }
    #[test]
    fn should_name_spell_14_ignite() {
        assert_eq!(spell(14), "点燃");
    }
    #[test]
    fn should_name_spell_7_heal() {
        assert_eq!(spell(7), "治疗");
    }
    #[test]
    fn should_name_spell_21_barrier() {
        assert_eq!(spell(21), "屏障");
    }
    #[test]
    fn should_name_spell_1_cleanse() {
        assert_eq!(spell(1), "净化");
    }
    #[test]
    fn should_name_spell_3_exhaust() {
        assert_eq!(spell(3), "虚弱");
    }
    #[test]
    fn should_name_spell_6_ghost() {
        assert_eq!(spell(6), "幽魂");
    }
    #[test]
    fn should_name_spell_13_clarity() {
        assert_eq!(spell(13), "洞悉");
    }
    #[test]
    fn should_name_spell_32_snowball() {
        assert_eq!(spell(32), "雪球");
    }
    #[test]
    fn should_name_unknown_spell() {
        assert_eq!(spell(999), "未知技能");
    }
    #[test]
    fn should_map_spell_ids_in_order() {
        assert_eq!(
            NameTable::default().spell_names(&[4, 12]),
            vec!["闪现", "传送"]
        );
    }
    #[test]
    fn should_map_empty_spell_ids() {
        assert!(NameTable::default().spell_names(&[]).is_empty());
    }

    // ═════ timeline/__tests__/remap.spec.ts ═════
    fn frame_player(pid: i64, gold: i64) -> SlimPlayerFrame {
        SlimPlayerFrame {
            participant_id: pid,
            total_gold: gold,
            xp: 0,
            level: 1,
            cs: 0,
            jungle_cs: 0,
            x: 0,
            y: 0,
            damage_to_champions: 0,
        }
    }

    fn slim_participant(pid: i64, puuid: &str) -> SlimParticipant {
        SlimParticipant {
            participant_id: pid,
            puuid: puuid.to_string(),
            team_position: String::new(),
            vision_score: None,
            damage_dealt_to_objectives: None,
            time_c_cing_others: None,
        }
    }

    fn remap_fixture() -> SlimTimeline {
        SlimTimeline {
            game_id: 1,
            frame_interval_ms: 60000,
            participants: vec![slim_participant(1, "a"), slim_participant(2, "b")],
            frames: vec![SlimFrame {
                timestamp: 0,
                players: vec![frame_player(1, 500), frame_player(2, 600)],
            }],
            events: vec![
                SlimEvent::ChampionKill {
                    timestamp: 1000,
                    killer_id: 1,
                    victim_id: 2,
                    assisting: vec![2],
                    x: 0,
                    y: 0,
                    bounty: 300,
                    shutdown_bounty: 0,
                    damage_received: vec![DamageSource {
                        participant_id: 1,
                        total: 100,
                        top_slot: 0,
                    }],
                },
                SlimEvent::WardPlaced {
                    timestamp: 2000,
                    creator_id: 2,
                    ward_type: "YELLOW_TRINKET".to_string(),
                },
            ],
            items: BTreeMap::new(),
        }
    }

    fn puuid_map(entries: &[(&str, i64)]) -> HashMap<String, i64> {
        entries.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    fn kill_ids(e: &SlimEvent) -> (i64, i64, Vec<i64>) {
        match e {
            SlimEvent::ChampionKill {
                killer_id,
                victim_id,
                assisting,
                ..
            } => (*killer_id, *victim_id, assisting.clone()),
            other => panic!("不是击杀事件: {other:?}"),
        }
    }

    /// HashMap 无序：按 participantId 排序后比较（TS 断言的是插入序，插入序即身份下标升序）
    fn sorted_entries(m: &HashMap<String, i64>) -> Vec<(String, i64)> {
        let mut v: Vec<(String, i64)> = m.iter().map(|(k, v)| (k.clone(), *v)).collect();
        v.sort_by_key(|(_, pid)| *pid);
        v
    }

    #[test]
    fn should_swap_participant_ids_by_puuid() {
        let out = remap_timeline(&remap_fixture(), &puuid_map(&[("a", 2), ("b", 1)]));
        let parts: Vec<(i64, &str)> = out
            .participants
            .iter()
            .map(|p| (p.participant_id, p.puuid.as_str()))
            .collect();
        assert_eq!(parts, vec![(2, "a"), (1, "b")]);
        let frame: Vec<(i64, i64)> = out.frames[0]
            .players
            .iter()
            .map(|p| (p.participant_id, p.total_gold))
            .collect();
        assert_eq!(frame, vec![(1, 600), (2, 500)]);
        assert_eq!(kill_ids(&out.events[0]), (2, 1, vec![1]));
        match &out.events[0] {
            SlimEvent::ChampionKill {
                damage_received, ..
            } => {
                assert_eq!(damage_received[0].participant_id, 2)
            }
            other => panic!("不是击杀事件: {other:?}"),
        }
        match &out.events[1] {
            SlimEvent::WardPlaced { creator_id, .. } => assert_eq!(*creator_id, 1),
            other => panic!("不是插眼事件: {other:?}"),
        }
    }

    #[test]
    fn should_map_unknown_puuid_to_zero_and_drop_frames() {
        let out = remap_timeline(&remap_fixture(), &puuid_map(&[("a", 1)]));
        let pids: Vec<i64> = out.frames[0]
            .players
            .iter()
            .map(|p| p.participant_id)
            .collect();
        assert_eq!(pids, vec![1]);
        assert_eq!(kill_ids(&out.events[0]).1, 0);
    }

    #[test]
    fn should_read_puuids_from_game_detail_identities_by_index() {
        let game: LcuGame = serde_json::from_value(json!({
            "participantIdentities": [{ "player": { "puuid": "me" } }],
            "gameDetail": {
                "participantIdentities": [{ "player": { "puuid": "x" } }, { "player": { "puuid": "me" } }]
            }
        }))
        .unwrap();
        assert_eq!(
            sorted_entries(&build_puuid_map(&game)),
            vec![("x".to_string(), 1), ("me".to_string(), 2)]
        );
    }

    #[test]
    fn should_ignore_empty_and_drop_duplicated_puuids() {
        let identities: Vec<serde_json::Value> = ["a", "", "dup", "dup", "e"]
            .iter()
            .map(|p| json!({ "player": { "puuid": p } }))
            .collect();
        let game: LcuGame =
            serde_json::from_value(json!({ "participantIdentities": identities })).unwrap();
        assert_eq!(
            sorted_entries(&build_puuid_map(&game)),
            vec![("a".to_string(), 1), ("e".to_string(), 5)]
        );
    }

    #[test]
    fn should_map_untrusted_details_participants_to_zero() {
        let t = SlimTimeline {
            participants: vec![
                slim_participant(1, ""),
                slim_participant(2, "b"),
                slim_participant(3, "x"),
                slim_participant(4, "x"),
            ],
            ..remap_fixture()
        };
        // 名册里 '' 与 'x' 都「能对上」——但空 / 重复 puuid 不可信，必须记 0
        let out = remap_timeline(&t, &puuid_map(&[("", 7), ("b", 2), ("x", 3)]));
        let pids: Vec<i64> = out.participants.iter().map(|p| p.participant_id).collect();
        assert_eq!(pids, vec![0, 2, 0, 0]);
        let (killer, victim, _) = kill_ids(&out.events[0]);
        assert_eq!((killer, victim), (0, 2));
    }

    // ═════ 新增：适配层 ═════
    #[test]
    fn should_use_game_detail_and_mark_current_player() {
        let (game, slim) = regression_fixture('a');
        let input = from_lcu(&game, Some(&slim), &NameTable::default(), None);
        assert_eq!(input.players.len(), 10);
        let me: Vec<i64> = input
            .players
            .iter()
            .filter(|p| p.is_me)
            .map(|p| p.participant_id)
            .collect();
        assert_eq!(me, vec![4]);
        let p1 = &input.players[0];
        assert_eq!(p1.name, "玩家1#0000");
        assert_eq!(p1.lane, "JUNGLE");
        assert_eq!(p1.role, "NONE");
        assert_eq!(p1.truth_position, Some(TeamPosition::Top));
        assert_eq!(p1.stats.vision_score, Some(34));
        assert_eq!(p1.champion_name, "英雄82");
        assert_eq!(p1.spell_names, vec!["闪现", "传送"]);
        let tl = input.timeline.expect("有时间线");
        assert_eq!(tl.participants.len(), 10);
    }

    #[test]
    fn should_fall_back_to_index_identity_and_placeholder_name() {
        let game: LcuGame = serde_json::from_value(json!({
            "participants": [
                { "participantId": 1, "teamId": 100, "championId": 64, "spell1Id": 4, "spell2Id": 11, "stats": {} },
                { "participantId": 2, "teamId": 100, "championId": 21, "spell1Id": 7, "spell2Id": 4, "stats": {} }
            ],
            "participantIdentities": [
                { "participantId": 1, "player": { "gameName": "Test", "tagLine": "1234", "puuid": "p1" } }
            ]
        }))
        .unwrap();
        let input = from_lcu(&game, None, &NameTable::default(), None);
        assert_eq!(input.players[0].name, "Test#1234");
        assert!(input.players[0].is_me);
        assert_eq!(input.players[0].puuid, "p1");
        assert_eq!(input.players[1].name, "玩家2");
        assert!(!input.players[1].is_me);
        assert_eq!(input.players[1].puuid, "");
        assert!(input.timeline.is_none());
    }

    /// 改名场景：顶层身份（战绩列表）还是旧名，gameDetail 身份已是新名，puuid 相同
    fn renamed_game() -> LcuGame {
        serde_json::from_value(json!({
            "participants": [
                { "participantId": 1, "teamId": 100, "stats": {} },
                { "participantId": 2, "teamId": 100, "stats": {} }
            ],
            "participantIdentities": [
                { "player": { "gameName": "旧名", "tagLine": "1", "puuid": "me" } }
            ],
            "gameDetail": {
                "participants": [
                    { "participantId": 1, "teamId": 100, "stats": {} },
                    { "participantId": 2, "teamId": 100, "stats": {} }
                ],
                "participantIdentities": [
                    { "player": { "gameName": "路人", "tagLine": "2", "puuid": "other" } },
                    { "player": { "gameName": "新名", "tagLine": "1", "puuid": "me" } }
                ]
            }
        }))
        .unwrap()
    }

    fn me_pids(input: &MatchInput) -> Vec<i64> {
        input
            .players
            .iter()
            .filter(|p| p.is_me)
            .map(|p| p.participant_id)
            .collect()
    }

    // P1-F2：TS 按显示名判本人，改名后谁都不是本人
    #[test]
    fn should_mark_me_by_puuid_when_renamed() {
        let game = renamed_game();
        let input = from_lcu(&game, None, &NameTable::default(), Some("me"));
        assert_eq!(input.me_puuid.as_deref(), Some("me"));
        assert_eq!(me_pids(&input), vec![2]);
        // 不给 me_puuid（或空串）时与 TS 一致：显示名对不上，无人是本人
        assert!(me_pids(&from_lcu(&game, None, &NameTable::default(), None)).is_empty());
        assert!(me_pids(&from_lcu(&game, None, &NameTable::default(), Some(""))).is_empty());
    }

    // P1-F2：玩家 puuid 缺失时退回 TS 的显示名比较
    #[test]
    fn should_fall_back_to_display_name_when_player_puuid_missing() {
        let game: LcuGame = serde_json::from_value(json!({
            "participants": [
                { "participantId": 1, "teamId": 100, "stats": {} },
                { "participantId": 2, "teamId": 100, "stats": {} }
            ],
            "participantIdentities": [
                { "player": { "gameName": "Test", "tagLine": "1234" } },
                { "player": { "gameName": "别人", "tagLine": "9" } }
            ]
        }))
        .unwrap();
        let input = from_lcu(&game, None, &NameTable::default(), Some("me"));
        assert_eq!(me_pids(&input), vec![1]);
    }

    fn names_of(players: serde_json::Value) -> Vec<String> {
        let identities: Vec<serde_json::Value> = players
            .as_array()
            .unwrap()
            .iter()
            .map(|p| json!({ "player": p }))
            .collect();
        let participants: Vec<serde_json::Value> = (1..=identities.len())
            .map(|i| json!({ "participantId": i, "teamId": 100, "stats": {} }))
            .collect();
        let game: LcuGame = serde_json::from_value(json!({
            "participants": participants, "participantIdentities": identities
        }))
        .unwrap();
        from_lcu(&game, None, &NameTable::default(), None)
            .players
            .into_iter()
            .map(|p| p.name)
            .collect()
    }

    // P1-F4：TS 缺 gameName / tagLine 时拼出 "undefined#undefined"
    #[test]
    fn should_build_display_name_with_fallbacks() {
        let names = names_of(json!([
            { "gameName": "甲", "tagLine": "123", "summonerName": "旧甲" },
            { "gameName": "乙", "summonerName": "旧乙" },
            { "gameName": "丙", "tagLine": "" },
            { "summonerName": "丁" },
            { "gameName": "", "tagLine": "9", "summonerName": "戊" },
            { "tagLine": "9" },
            { "gameName": "", "summonerName": "" },
        ]));
        assert_eq!(
            names,
            vec!["甲#123", "乙", "丙", "丁", "戊", "未知玩家", "未知玩家"]
        );
        assert!(names.iter().all(|n| !n.contains("undefined")));
    }

    // P1-F4：身份缺 player（TS 抛错）也给兜底名；缺整条身份仍是 TS 的「玩家<pid>」
    #[test]
    fn should_name_missing_player_and_missing_identity() {
        let game: LcuGame = serde_json::from_value(json!({
            "participants": [
                { "participantId": 1, "teamId": 100, "stats": {} },
                { "participantId": 2, "teamId": 100, "stats": {} }
            ],
            "participantIdentities": [{}]
        }))
        .unwrap();
        let names: Vec<String> = from_lcu(&game, None, &NameTable::default(), None)
            .players
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, vec!["未知玩家", "玩家2"]);
    }

    // P1-F4：本人键与显示名同一套规则，缺 tagLine 的本人仍判为本人
    #[test]
    fn should_mark_me_when_tag_line_missing() {
        let game: LcuGame = serde_json::from_value(json!({
            "participants": [
                { "participantId": 1, "teamId": 100, "stats": {} },
                { "participantId": 2, "teamId": 100, "stats": {} }
            ],
            "participantIdentities": [
                { "player": { "gameName": "甲" } },
                { "player": { "gameName": "乙" } }
            ]
        }))
        .unwrap();
        let input = from_lcu(&game, None, &NameTable::default(), None);
        assert_eq!(input.players[0].name, "甲");
        assert!(input.players[0].is_me);
        assert!(!input.players[1].is_me);
    }

    #[test]
    fn should_fill_names_from_table_with_ts_fallbacks() {
        let names = NameTable::new(HashMap::from([
            (64, "盲僧".to_string()),
            (1, String::new()),
        ]));
        assert_eq!(names.champion_name(64), "盲僧");
        assert_eq!(names.champion_name(999), "英雄999");
        // TS `championNameMap[id] || ...`：空名也走占位
        assert_eq!(names.champion_name(1), "英雄1");
        assert_eq!(names.spell_name(99), "未知技能");
    }

    #[test]
    fn should_attach_truth_and_sgp_metrics_by_remapped_pid() {
        let game: LcuGame = serde_json::from_value(make_scoring_game()).unwrap();
        let mut tl = crate::match_analysis::test_support::make_scoring_timeline();
        tl.participants = vec![
            SlimParticipant {
                team_position: "MIDDLE".to_string(),
                vision_score: Some(55),
                ..slim_participant(1, "puuid-3")
            },
            SlimParticipant {
                team_position: "TOP".to_string(),
                ..slim_participant(2, "puuid-1")
            },
        ];
        let input = from_lcu(&game, Some(&tl), &NameTable::default(), None);
        assert_eq!(input.players[2].truth_position, Some(TeamPosition::Middle));
        assert_eq!(input.players[2].sgp_vision_score, Some(55));
        assert_eq!(input.players[0].truth_position, Some(TeamPosition::Top));
        assert_eq!(input.players[0].sgp_vision_score, None);
        assert_eq!(input.players[1].truth_position, None);
        assert_eq!(input.players[2].lcu_team_position, "MIDDLE");
    }

    #[test]
    fn should_read_app_game_like_frontend_does() {
        let game = Game {
            game_id: 9,
            queue_id: 420,
            queue_name: "单双排".to_string(),
            game_detail: Arc::new(GameDetail::default()),
            participants: vec![Participant {
                participant_id: 1,
                team_id: 100,
                champion_id: 64,
                stats: Stats {
                    kills: 3,
                    damage_dealt_to_objectives: Some(100),
                    ..Default::default()
                },
                ..Default::default()
            }],
            participant_identities: vec![ParticipantIdentity {
                player: Player {
                    game_name: "A".to_string(),
                    tag_line: "1".to_string(),
                    puuid: "pa".to_string(),
                    ..Default::default()
                },
            }],
            ..Default::default()
        };
        let lcu = LcuGame::from_app_game(&game).expect("app Game 可转视图");
        let input = from_lcu(&lcu, None, &NameTable::default(), None);
        assert_eq!(input.queue_name.as_deref(), Some("单双排"));
        let p = &input.players[0];
        assert!(p.is_me);
        assert_eq!(p.stats.kills, 3);
        assert_eq!(p.stats.damage_dealt_to_objectives, Some(100));
        // app 的 Rust Stats 不带这些字段：前端 TS 读到 undefined
        assert_eq!(p.stats.vision_score, None);
        assert_eq!(p.lane, "");
        assert_eq!(p.lcu_team_position, "");
    }

    #[test]
    fn should_map_every_lcu_stats_field_to_its_own_slot() {
        let s = LcuStats {
            win: true,
            kills: 11,
            deaths: 12,
            assists: 13,
            gold_earned: 14,
            total_damage_dealt_to_champions: 15,
            total_damage_taken: 16,
            total_heal: 17,
            damage_dealt_to_turrets: 18,
            total_minions_killed: 19,
            neutral_minions_killed: 20,
            perk0: 21,
            perk_sub_style: 22,
            player_augment1: 31,
            player_augment2: 32,
            player_augment3: 33,
            player_augment4: 34,
            player_augment5: 35,
            player_augment6: 36,
            item0: 101,
            item1: 102,
            item2: 103,
            item3: 104,
            item4: 105,
            item5: 106,
            item6: 107,
            damage_dealt_to_objectives: Some(41),
            time_c_cing_others: Some(42),
            vision_score: Some(43),
            sight_wards_bought_in_game: Some(44),
            vision_wards_bought_in_game: Some(45),
            double_kills: Some(51),
            triple_kills: Some(52),
            quadra_kills: Some(53),
            penta_kills: Some(54),
        };
        let p = PlayerStats::from(&s);
        assert!(p.win);
        assert_eq!(
            [p.kills, p.deaths, p.assists, p.gold_earned],
            [11, 12, 13, 14]
        );
        assert_eq!(
            [
                p.total_damage_dealt_to_champions,
                p.total_damage_taken,
                p.total_heal,
                p.damage_dealt_to_turrets
            ],
            [15, 16, 17, 18]
        );
        assert_eq!(
            [
                p.total_minions_killed,
                p.neutral_minions_killed,
                p.perk0,
                p.perk_sub_style
            ],
            [19, 20, 21, 22]
        );
        assert_eq!(p.augments, [31, 32, 33, 34, 35, 36]);
        assert_eq!(p.items, [101, 102, 103, 104, 105, 106]);
        assert_eq!(p.trinket_id, 107);
        assert_eq!(p.damage_dealt_to_objectives, Some(41));
        assert_eq!(p.time_c_cing_others, Some(42));
        assert_eq!(p.vision_score, Some(43));
        assert_eq!(p.sight_wards_bought_in_game, Some(44));
        assert_eq!(p.vision_wards_bought_in_game, Some(45));
        assert_eq!(
            [
                p.double_kills,
                p.triple_kills,
                p.quadra_kills,
                p.penta_kills
            ],
            [51, 52, 53, 54]
        );
    }
}

#[cfg(test)]
mod sgp_tests {
    use super::*;
    use crate::lcu::api::timeline::SlimTimeline;
    use std::collections::BTreeMap;

    /// games.jsonl 风格的一行（两名玩家，字段名与 match-v5 一致）
    const SGP_LINE: &str = r#"{"gameId":42,"platformId":"TJ100","queueId":420,"gameDuration":1700,"gameVersion":"16.22.1","participants":[
        {"participantId":1,"teamId":100,"puuid":"pa","championId":164,"win":true,"kills":2,"deaths":4,"assists":14,
         "totalDamageDealtToChampions":22210,"goldEarned":11987,"totalMinionsKilled":183,"neutralMinionsKilled":0,
         "visionScore":17,"damageDealtToObjectives":15101,"totalHeal":5217,"totalDamageTaken":25662,"timeCCingOthers":28,
         "teamPosition":"TOP","summoner1Id":12,"summoner2Id":4},
        {"participantId":6,"teamId":200,"puuid":"pb","championId":950,"win":false,"kills":1,"deaths":3,"assists":2,
         "totalDamageDealtToChampions":9000,"goldEarned":8000,"totalMinionsKilled":20,"neutralMinionsKilled":180,
         "teamPosition":"","summoner1Id":4,"summoner2Id":11,"riotIdGameName":"甲","riotIdTagline":"123"}]}"#;

    fn summary(patch: &[(&str, serde_json::Value)]) -> SgpSummary {
        let mut v: serde_json::Value = serde_json::from_str(SGP_LINE).unwrap();
        for (k, val) in patch {
            v[*k] = val.clone();
        }
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn should_map_sgp_summary_fields() {
        let input = from_sgp(&summary(&[]), None, &NameTable::default());
        assert_eq!(input.game_id, 42);
        assert_eq!(input.queue_id, 420);
        assert_eq!(input.game_mode, "");
        assert_eq!(input.duration_seconds, 1700);
        assert_eq!(input.queue_name, None);
        let a = &input.players[0];
        assert_eq!(a.name, "玩家1");
        assert!(!a.is_me);
        assert_eq!(a.puuid, "pa");
        assert_eq!(a.spell_ids, [12, 4]);
        assert_eq!(a.spell_names, vec!["传送", "闪现"]);
        assert_eq!(a.truth_position, Some(TeamPosition::Top));
        assert_eq!(a.lcu_team_position, "");
        assert_eq!(a.sgp_vision_score, Some(17));
        assert_eq!(a.sgp_objective_damage, Some(15101));
        assert_eq!(a.sgp_cc_seconds, Some(28));
        assert_eq!(a.stats.total_damage_taken, 25662);
        assert_eq!(a.stats.total_heal, 5217);
        assert!(a.stats.win);
        let b = &input.players[1];
        assert_eq!(b.name, "甲#123");
        assert_eq!(b.truth_position, None);
        assert_eq!(b.sgp_vision_score, None);
        assert_eq!(b.stats.neutral_minions_killed, 180);
    }

    #[test]
    fn should_default_map_by_laned_queue() {
        let ranked = from_sgp(&summary(&[]), None, &NameTable::default());
        assert_eq!(ranked.map_id, 11);
        let aram = from_sgp(
            &summary(&[("queueId", 450.into())]),
            None,
            &NameTable::default(),
        );
        assert_eq!(aram.map_id, 12);
        let explicit = from_sgp(
            &summary(&[("queueId", 450.into()), ("mapId", 11.into())]),
            None,
            &NameTable::default(),
        );
        assert_eq!(explicit.map_id, 11);
    }

    #[test]
    fn should_keep_sgp_timeline_ids_as_is() {
        let tl = SlimTimeline {
            game_id: 42,
            frame_interval_ms: 60000,
            participants: vec![SlimParticipant {
                participant_id: 6,
                puuid: "pb".to_string(),
                team_position: String::new(),
                vision_score: None,
                damage_dealt_to_objectives: None,
                time_c_cing_others: None,
            }],
            frames: vec![],
            events: vec![],
            items: BTreeMap::new(),
        };
        let input = from_sgp(&summary(&[]), Some(&tl), &NameTable::default());
        assert_eq!(input.timeline, Some(tl));
    }

    #[test]
    fn should_use_champion_names_from_table() {
        let names = NameTable::new(HashMap::from([(164, "青钢影".to_string())]));
        let input = from_sgp(&summary(&[]), None, &names);
        assert_eq!(input.players[0].champion_name, "青钢影");
        assert_eq!(input.players[1].champion_name, "英雄950");
    }
}
