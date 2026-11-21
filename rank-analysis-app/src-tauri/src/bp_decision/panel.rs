//! BP 操作台快照：候选打分与面板状态，纯函数。
//!
//! 与 [`super::evaluate`] 的分工：`evaluate` 决定「自动化到点会执行谁」（规则 + 兜底池，
//! 行为不变），本模块只回答「此刻有哪些值得考虑的候选、各自为什么」，供操作台展示。
//! 自动执行目标**直接取自决策快照**，不在这里另选——否则面板上标着「将自动选择」
//! 的英雄和真正被锁定的英雄可能不是同一个。
//!
//! 打分全部在对数几率上相加，最后过 sigmoid 得到「评估胜率」。系数是未校准的先验值，
//! 与前端演示页 `src/demo/bp/score.ts` 同一套。
//!
//! 数据来源与局限：
//! - 版本强度 / 克制：OP.GG 快照。克制数据只有「每分路最难打的 top3」，是稀疏的负向样本，
//!   没有记录的对位一律当作无信息（不加不减）。
//! - 熟练度：本人近 50 场里召唤师峡谷的场次与胜场。
//! - 伤害类型：客户端英雄详情的 `tacticalInfo.damageType`，见 [`super::damage`]。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::bp_decision::evaluate::{
    find_my_pending_action, is_actionable_phase, phase_secs_left, unavailable_map,
};
use crate::bp_decision::types::{BpActionType, BpDecision, BpMode};
use crate::command::rule_config::Position;
use crate::lcu::api::champion_select::{display_champion_id, SelectSession};
use crate::opgg::data::{ChampionMeta, OpggSnapshot};
use crate::rule_engine::detect_my_position;

/// 熟练度收缩强度：等效于先验的虚拟场次。
const SHRINK_K: f64 = 20.0;
/// 熟练度项封顶（对数几率），约 ±6 个百分点。
const MASTERY_CAP: f64 = 0.25;
/// 池外且近期零场次的陌生惩罚（对数几率），约 3 个百分点。
const UNFAMILIAR_PENALTY: f64 = 0.12;
/// 总场次少于此值时，个人平均胜率不可信，按 50% 计。
const MIN_GAMES_FOR_AVG: u32 = 10;
/// 阵容健康区间：全队魔法占比的下限与上限。
const MIX_LOW: f64 = 0.3;
const MIX_HIGH: f64 = 0.7;
/// 阵容项系数：魔法占比每超出区间 1.0 扣的对数几率。
const COMP_BETA: f64 = 0.4;
/// 超出健康区间多少才给卡片级警告。
const COMP_WARN_MARGIN: f64 = 0.05;
/// 已知伤害类型的人数（含候选）少于此值时不评价阵容——样本太少，结论会来回跳。
const COMP_MIN_KNOWN: usize = 3;
/// 对数几率换算成百分点的近似系数（sigmoid 在 0.5 处的斜率）。
const PP_PER_LOGIT: f64 = 25.0;
/// 展示的候选数量。
const SHOWN: usize = 5;
/// 从版本强势榜里补进候选的数量上限。
const META_EXTRA: usize = 12;
/// 登场率低于此值的英雄不进版本强势榜（样本小，胜率虚高）。
const META_MIN_PICK_RATE: f64 = 0.01;
/// 理由的贡献小于此值（百分点）时不展示。
const REASON_MIN_PP: f64 = 0.3;
/// 每张卡片最多展示的理由数。
const REASONS_SHOWN: usize = 3;
/// 威胁度的满分刻度：第一名归一化到此值。
const THREAT_TOP: f64 = 95.0;

/// 面板所处的状态，与前端 `BpPanelStage` 同构。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BpPanelStage {
    /// 选人期已开始但还没轮到我
    Waiting,
    /// 轮到我，且现在提交有效
    Acting,
    /// 我的 BP 动作已全部完成
    Done,
}

/// 理由类型。前端据此决定图标、配色与文案。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BpReasonKind {
    /// 版本强度
    Meta,
    /// 个人熟练度
    Mastery,
    /// 候选克制 `champion_id`
    Counters,
    /// 候选被 `champion_id` 克制
    CounteredBy,
    /// 对位未亮出时的先手风险
    Risk,
    /// 选它会让全队伤害类型偏科
    CompSkew,
    /// 选它能补上全队缺的伤害类型
    CompFill,
    /// （ban）它克制我打算选的 `champion_id`
    ThreatToPick,
}

/// 一条推荐理由。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BpPanelReason {
    pub kind: BpReasonKind,
    /// 理由涉及的另一个英雄（克制对象 / 我打算选的英雄）；与英雄无关的理由为 0
    pub champion_id: i32,
    /// 对评估胜率的贡献（百分点）；无法量化的理由为 None
    pub delta: Option<f64>,
    /// OP.GG T 级（仅 `Meta`；无数据为 0）
    pub tier: i32,
    /// Ban 率 0~1（仅 ban 阶段的 `Meta`）
    pub ban_rate: Option<f64>,
}

impl BpPanelReason {
    fn new(kind: BpReasonKind, champion_id: i32, delta: Option<f64>) -> Self {
        Self {
            kind,
            champion_id,
            delta,
            tier: 0,
            ban_rate: None,
        }
    }
}

/// 卡片级警告。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BpCompWarning {
    LackMagic,
    LackPhysical,
}

/// 一张候选卡片。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BpPanelCandidate {
    pub champion_id: i32,
    /// pick：评估胜率 0~1；ban：威胁度 0~95
    pub score: f64,
    /// 是否在用户英雄池内（ban 阶段恒为 true，ban 没有池的概念）
    pub in_pool: bool,
    /// 物理伤害占比 0~1；伤害类型未知时为 None
    pub physical_share: Option<f64>,
    /// 近期场次与胜场（ban 阶段不统计，恒为 0）
    pub games: u32,
    pub wins: u32,
    /// 熟练度是否应以警示色展示
    pub unfamiliar: bool,
    pub reasons: Vec<BpPanelReason>,
    pub warning: Option<BpCompWarning>,
}

/// 一方的伤害构成（只算已亮出且伤害类型已知的英雄）。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct BpDamageMix {
    pub physical: f64,
    pub magic: f64,
    pub known: u32,
}

/// 操作台快照。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BpPanel {
    pub action_type: BpActionType,
    pub stage: BpPanelStage,
    /// 已按分数排序、截断到展示数量
    pub candidates: Vec<BpPanelCandidate>,
    /// 到点会被自动执行的英雄；None = 不会自动执行
    pub auto_target_id: Option<i32>,
    /// 客户端里当前实际预选的英雄，0 = 未预选
    pub hovered_id: i32,
    /// 用户是否已接管（接管后本阶段不再自动执行）
    pub overridden: bool,
    /// 快照生成时本回合的剩余秒数
    pub time_left_secs: f64,
    /// 本回合总秒数
    pub total_secs: f64,
    /// 自动执行发生在剩余多少秒时
    pub execute_at_secs_left: f64,
    /// 我方伤害构成（不含我自己，前端把当前预选叠加上去）
    pub ally_mix: BpDamageMix,
    pub enemy_mix: BpDamageMix,
    /// `Done` 状态下我最终选定的英雄，其余状态为 0
    pub result_champion_id: i32,
}

/// 求值所需的全部输入。所有数据由调用方取好注入，本模块不做 I/O。
pub struct PanelInput<'a> {
    pub session: &'a SelectSession,
    pub my_puuid: &'a str,
    /// None = OP.GG 数据缺失，此时只按熟练度与阵容排序
    pub snapshot: Option<&'a OpggSnapshot>,
    pub pick_pool: &'a [i32],
    pub ban_pool: &'a [i32],
    /// 自动化对我的 pick / ban 动作算出的决策（提供自动执行目标与接管状态）
    pub pick_decision: Option<&'a BpDecision>,
    pub ban_decision: Option<&'a BpDecision>,
    /// 英雄 ID → (近期场次, 胜场)
    pub my_stats: &'a HashMap<i32, (u32, u32)>,
    /// 英雄 ID → 物理伤害占比 0~1
    pub damage: &'a HashMap<i32, f64>,
}

fn logit(p: f64) -> f64 {
    let p = p.clamp(0.01, 0.99);
    (p / (1.0 - p)).ln()
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

fn position_to_lcu(p: Position) -> &'static str {
    match p {
        Position::Top => "TOP",
        Position::Jungle => "JUNGLE",
        Position::Middle => "MIDDLE",
        Position::Bottom => "BOTTOM",
        Position::Utility => "UTILITY",
    }
}

/// 英雄在指定分路的元数据；该分路没有记录时退回主分路，再退回任意一条。
fn meta_for<'a>(
    snapshot: Option<&'a OpggSnapshot>,
    champion_id: i32,
    position: Option<&str>,
) -> Option<&'a ChampionMeta> {
    let entries = snapshot?.champions.get(&champion_id)?;
    position
        .and_then(|p| entries.iter().find(|m| m.position == p))
        .or_else(|| entries.iter().find(|m| m.is_main_position))
        .or_else(|| entries.first())
}

/// 英雄打指定分路的占比，用作「他是我对位」的概率；没有该分路记录视为 0。
fn role_rate_at(snapshot: Option<&OpggSnapshot>, champion_id: i32, position: Option<&str>) -> f64 {
    let (Some(snapshot), Some(position)) = (snapshot, position) else {
        return 0.0;
    };
    snapshot
        .champions
        .get(&champion_id)
        .and_then(|entries| entries.iter().find(|m| m.position == position))
        .map(|m| m.role_rate)
        .unwrap_or(0.0)
}

/// `subject` 面对 `opponent` 的对线胜率。
///
/// OP.GG 只给每个英雄最难打的 top3，所以要查两个方向：`subject` 的苦手名单里有
/// `opponent`（直接取），或 `opponent` 的苦手名单里有 `subject`（取反）。两边都没有
/// 就是没有信息，返回 None。同分路的记录优先。
fn matchup_win_rate(
    snapshot: Option<&OpggSnapshot>,
    subject: i32,
    opponent: i32,
    position: Option<&str>,
) -> Option<f64> {
    let snapshot = snapshot?;
    let lookup = |a: i32, b: i32| -> Option<f64> {
        let list = snapshot.counters.get(&a)?;
        position
            .and_then(|p| list.iter().find(|c| c.opponent_id == b && c.position == p))
            .or_else(|| list.iter().find(|c| c.opponent_id == b))
            .map(|c| c.subject_win_rate)
    };
    lookup(subject, opponent).or_else(|| lookup(opponent, subject).map(|wr| 1.0 - wr))
}

/// 一组英雄的伤害构成（只算伤害类型已知的）。
fn mix_of(ids: impl Iterator<Item = i32>, damage: &HashMap<i32, f64>) -> BpDamageMix {
    let mut mix = BpDamageMix::default();
    for id in ids {
        if let Some(&physical) = damage.get(&id) {
            mix.physical += physical;
            mix.magic += 1.0 - physical;
            mix.known += 1;
        }
    }
    mix
}

/// 队友已亮出的英雄（锁定或预选意向），不含我自己。
fn ally_champion_ids(session: &SelectSession) -> Vec<i32> {
    session
        .my_team
        .iter()
        .filter(|p| p.cell_id != session.local_player_cell_id)
        .map(display_champion_id)
        .filter(|&id| id != 0)
        .collect()
}

/// 敌方已亮出的英雄。
fn enemy_champion_ids(session: &SelectSession) -> Vec<i32> {
    session
        .their_team
        .iter()
        .map(|p| p.champion_id)
        .filter(|&id| id != 0)
        .collect()
}

/// 我已完成的 pick 动作选定的英雄，没有则为 0。
fn my_completed_pick(session: &SelectSession) -> i32 {
    session
        .actions
        .iter()
        .flatten()
        .filter(|a| {
            a.actor_cell_id == session.local_player_cell_id
                && a.completed
                && a.action_type == "pick"
        })
        .map(|a| a.champion_id)
        .next_back()
        .unwrap_or(0)
}

/// 一个候选的打分明细。
struct Scored {
    id: i32,
    /// pick：对数几率；ban：威胁点数
    total: f64,
    reasons: Vec<BpPanelReason>,
    warning: Option<BpCompWarning>,
}

/// 只留贡献明显的理由，按影响从大到小取前几条。
fn top_reasons(mut reasons: Vec<BpPanelReason>) -> Vec<BpPanelReason> {
    reasons.retain(|r| r.delta.is_none_or(|d| d.abs() >= REASON_MIN_PP));
    // 无法量化的理由按 0.5 个百分点排位：排在明显的量化理由之后、微弱的之前
    let weight = |r: &BpPanelReason| r.delta.map_or(0.5, f64::abs);
    reasons.sort_by(|a, b| weight(b).total_cmp(&weight(a)));
    reasons.truncate(REASONS_SHOWN);
    reasons
}

/// 打分上下文：一次面板求值里对所有候选都相同的部分。
struct ScoreCtx<'a> {
    input: &'a PanelInput<'a>,
    position: Option<&'static str>,
    allies: Vec<i32>,
    enemies: Vec<i32>,
    /// 已被 ban / 被选走的英雄
    unavailable: HashSet<i32>,
    /// 我的总体胜率（场次不足时为 0.5）
    my_avg: f64,
}

impl ScoreCtx<'_> {
    fn in_pick_pool(&self, id: i32) -> bool {
        self.input.pick_pool.contains(&id)
            || self
                .input
                .pick_decision
                .and_then(|d| d.target.as_ref())
                .is_some_and(|t| t.champion_id == id)
    }

    /// 给单个 pick 候选打分。
    fn score_pick(&self, id: i32) -> Scored {
        let snapshot = self.input.snapshot;
        let meta = meta_for(snapshot, id, self.position);
        let base = meta.map_or(0.5, |m| m.win_rate);
        let base_logit = logit(base);
        let mut total = base_logit;
        let mut reasons = Vec::new();

        if let Some(m) = meta {
            reasons.push(BpPanelReason {
                tier: m.tier,
                ..BpPanelReason::new(BpReasonKind::Meta, 0, Some((base - 0.5) * 100.0))
            });
        }

        // 熟练度：往我的总体胜率收缩，场次少时几乎不动
        let (games, wins) = self.input.my_stats.get(&id).copied().unwrap_or((0, 0));
        let shrunk = (wins as f64 + SHRINK_K * self.my_avg) / (games as f64 + SHRINK_K);
        let mut mastery = (logit(shrunk) - logit(self.my_avg)).clamp(-MASTERY_CAP, MASTERY_CAP);
        if !self.in_pick_pool(id) && games == 0 {
            mastery -= UNFAMILIAR_PENALTY;
        }
        total += mastery;
        reasons.push(BpPanelReason::new(
            BpReasonKind::Mastery,
            0,
            Some(mastery * PP_PER_LOGIT),
        ));

        // 克制：每个已亮敌人按「他是我对位」的概率加权
        let weights: Vec<f64> = self
            .enemies
            .iter()
            .map(|&e| role_rate_at(snapshot, e, self.position))
            .collect();
        let weight_sum: f64 = weights.iter().sum();
        let norm = if weight_sum > 1.0 {
            1.0 / weight_sum
        } else {
            1.0
        };
        for (&enemy, &w) in self.enemies.iter().zip(&weights) {
            let Some(wr) = matchup_win_rate(snapshot, id, enemy, self.position) else {
                continue;
            };
            let term = w * norm * (logit(wr) - base_logit);
            total += term;
            let kind = if term >= 0.0 {
                BpReasonKind::Counters
            } else {
                BpReasonKind::CounteredBy
            };
            reasons.push(BpPanelReason::new(kind, enemy, Some(term * PP_PER_LOGIT)));
        }

        // 先手风险：对位没亮时，对面随手拿到克制英雄的期望损失
        let unrevealed = (1.0 - weight_sum).clamp(0.0, 1.0);
        if unrevealed > 0.0 {
            let mut threats: Vec<(f64, f64)> = snapshot
                .and_then(|s| s.counters.get(&id))
                .into_iter()
                .flatten()
                .filter(|c| self.position.is_none_or(|p| c.position == p))
                .filter(|c| c.subject_win_rate < base)
                .filter(|c| {
                    !self.enemies.contains(&c.opponent_id)
                        && !self.unavailable.contains(&c.opponent_id)
                })
                .map(|c| {
                    let pick_rate = meta_for(snapshot, c.opponent_id, self.position)
                        .map_or(0.0, |m| m.pick_rate);
                    (c.subject_win_rate, pick_rate)
                })
                .collect();
            threats.sort_by(|a, b| a.0.total_cmp(&b.0));
            let risk = -unrevealed
                * threats
                    .iter()
                    .take(3)
                    .map(|(wr, pick_rate)| pick_rate * (base_logit - logit(*wr)))
                    .sum::<f64>();
            total += risk;
            reasons.push(BpPanelReason::new(
                BpReasonKind::Risk,
                0,
                Some(risk * PP_PER_LOGIT),
            ));
        }

        // 阵容：魔法占比落在健康区间外才扣分
        let mut warning = None;
        if let Some(&physical) = self.input.damage.get(&id) {
            let before = mix_of(self.allies.iter().copied(), self.input.damage);
            let known = before.known as usize + 1;
            if known >= COMP_MIN_KNOWN {
                let outside_of = |magic: f64, all: f64| -> f64 {
                    let share = magic / all;
                    if share < MIX_LOW {
                        share - MIX_LOW
                    } else if share > MIX_HIGH {
                        share - MIX_HIGH
                    } else {
                        0.0
                    }
                };
                // 带符号：负 = 缺魔法，正 = 缺物理
                let after = outside_of(before.magic + 1.0 - physical, known as f64);
                let prior = outside_of(before.magic, before.known as f64);
                let comp = -COMP_BETA * after.abs();
                total += comp;
                if after.abs() > COMP_WARN_MARGIN {
                    warning = Some(if after < 0.0 {
                        BpCompWarning::LackMagic
                    } else {
                        BpCompWarning::LackPhysical
                    });
                    reasons.push(BpPanelReason::new(
                        BpReasonKind::CompSkew,
                        0,
                        Some(comp * PP_PER_LOGIT),
                    ));
                } else if prior.abs() > COMP_WARN_MARGIN {
                    // 选它之前队伍偏科、选它之后回到健康区间：这是它的加分理由
                    reasons.push(BpPanelReason::new(BpReasonKind::CompFill, 0, None));
                }
            }
        }

        Scored {
            id,
            total,
            reasons,
            warning,
        }
    }

    /// pick 候选集：英雄池 + 自动目标 + 本分路版本强势榜，去掉不可用的。
    fn pick_candidate_ids(&self) -> Vec<i32> {
        let mut ids: Vec<i32> = self.input.pick_pool.to_vec();
        if let Some(t) = self.input.pick_decision.and_then(|d| d.target.as_ref()) {
            ids.push(t.champion_id);
        }
        if let (Some(snapshot), Some(position)) = (self.input.snapshot, self.position) {
            let mut strong: Vec<&ChampionMeta> = snapshot
                .champions
                .values()
                .flatten()
                .filter(|m| m.position == position && m.pick_rate >= META_MIN_PICK_RATE)
                .collect();
            strong.sort_by(|a, b| b.win_rate.total_cmp(&a.win_rate));
            ids.extend(strong.iter().take(META_EXTRA).map(|m| m.champion_id));
        }
        self.dedup_available(ids, &[])
    }

    /// 去重并去掉不可用 / 被显式排除的英雄，保持首次出现的顺序。
    fn dedup_available(&self, ids: Vec<i32>, exclude: &[i32]) -> Vec<i32> {
        let mut seen = HashSet::new();
        ids.into_iter()
            .filter(|id| *id != 0 && !self.unavailable.contains(id) && !exclude.contains(id))
            .filter(|id| seen.insert(*id))
            .collect()
    }

    /// 我打算选的英雄：自动化的 pick 目标，否则英雄池第一个可用的；都没有为 0。
    fn intended_pick(&self) -> i32 {
        self.input
            .pick_decision
            .and_then(|d| d.target.as_ref())
            .map(|t| t.champion_id)
            .or_else(|| {
                self.input
                    .pick_pool
                    .iter()
                    .copied()
                    .find(|id| !self.unavailable.contains(id))
            })
            .unwrap_or(0)
    }

    /// 给单个 ban 候选打分：威胁 = 版本强度 + 对我打算选的英雄的克制。
    fn score_ban(&self, id: i32, my_pick: i32) -> Scored {
        let snapshot = self.input.snapshot;
        let mut reasons = Vec::new();
        let mut points = 0.0;

        // ban 看的是「这个英雄本身有多强」，取它的主分路，不取我的分路
        if let Some(m) = meta_for(snapshot, id, None) {
            points += (m.win_rate - 0.5) * 100.0 + m.ban_rate * 10.0;
            reasons.push(BpPanelReason {
                tier: m.tier,
                ban_rate: Some(m.ban_rate),
                ..BpPanelReason::new(BpReasonKind::Meta, 0, None)
            });
        }

        if my_pick != 0 {
            let mine_base = meta_for(snapshot, my_pick, self.position).map_or(0.5, |m| m.win_rate);
            let lane = role_rate_at(snapshot, id, self.position);
            if let Some(wr) = matchup_win_rate(snapshot, my_pick, id, self.position) {
                if wr < mine_base && lane > 0.0 {
                    let loss = lane * (logit(mine_base) - logit(wr)) * PP_PER_LOGIT;
                    points += loss * 2.0;
                    reasons.push(BpPanelReason::new(
                        BpReasonKind::ThreatToPick,
                        my_pick,
                        Some(-loss),
                    ));
                }
            }
        }

        Scored {
            id,
            total: points,
            reasons,
            warning: None,
        }
    }

    /// ban 候选集：ban 池 + 自动目标 + 克制我的英雄 + 版本强势榜。
    fn ban_candidate_ids(&self, my_pick: i32) -> Vec<i32> {
        let mut ids: Vec<i32> = self.input.ban_pool.to_vec();
        if let Some(t) = self.input.ban_decision.and_then(|d| d.target.as_ref()) {
            ids.push(t.champion_id);
        }
        if let Some(snapshot) = self.input.snapshot {
            if let Some(list) = snapshot.counters.get(&my_pick) {
                ids.extend(
                    list.iter()
                        .filter(|c| self.position.is_none_or(|p| c.position == p))
                        .map(|c| c.opponent_id),
                );
            }
            let mut strong: Vec<&ChampionMeta> = snapshot
                .champions
                .values()
                .flatten()
                .filter(|m| m.is_main_position && m.pick_rate >= META_MIN_PICK_RATE)
                .collect();
            let threat = |m: &ChampionMeta| (m.win_rate - 0.5) * 100.0 + m.ban_rate * 10.0;
            strong.sort_by(|a, b| threat(b).total_cmp(&threat(a)));
            ids.extend(strong.iter().take(META_EXTRA).map(|m| m.champion_id));
        }
        // 不 ban 队友想玩的，也不 ban 我自己要选的
        let mut exclude = self.allies.clone();
        exclude.push(my_pick);
        self.dedup_available(ids, &exclude)
    }
}

/// 排序、截断到展示数量，并保证自动目标一定出现在列表里。
fn shortlist(mut scored: Vec<Scored>, auto_target_id: Option<i32>) -> Vec<Scored> {
    scored.sort_by(|a, b| b.total.total_cmp(&a.total));
    let pinned = auto_target_id
        .and_then(|id| scored.iter().position(|s| s.id == id))
        .filter(|&i| i >= SHOWN)
        .map(|i| scored.remove(i));
    scored.truncate(SHOWN);
    if let Some(p) = pinned {
        scored.pop();
        scored.push(p);
    }
    scored
}

/// 决策里到点会真的被执行的目标。
///
/// 只有「自动化开着、有目标、且目标会被锁定」才算——规则可以配成只预选不锁定，
/// 那种情况下面板不能承诺「将自动选择」。
fn auto_target(decision: Option<&BpDecision>) -> Option<i32> {
    let d = decision?;
    let t = d.target.as_ref()?;
    (d.mode == BpMode::Auto && t.lock).then_some(t.champion_id)
}

/// 求值一次操作台快照。
///
/// 返回 None 表示会话里没有任何属于我的 BP 动作（观战、无 BP 的模式等）。
pub fn build_panel(input: &PanelInput) -> Option<BpPanel> {
    let session = input.session;
    let timer = &session.timer;
    let ally_ids = ally_champion_ids(session);
    let enemy_ids = enemy_champion_ids(session);
    let ally_mix = mix_of(ally_ids.iter().copied(), input.damage);
    let enemy_mix = mix_of(enemy_ids.iter().copied(), input.damage);
    let time_left_secs = phase_secs_left(timer).max(0.0);
    let total_secs = timer.total_time_in_phase / 1000.0;

    let Some(pending) = find_my_pending_action(session) else {
        // 没有待办动作：选完了才展示「已完成」，否则（没有我的动作的模式）不出面板
        let result = my_completed_pick(session);
        return (result != 0).then_some(BpPanel {
            action_type: BpActionType::Pick,
            stage: BpPanelStage::Done,
            candidates: Vec::new(),
            auto_target_id: None,
            hovered_id: result,
            overridden: false,
            time_left_secs,
            total_secs,
            execute_at_secs_left: 0.0,
            ally_mix,
            enemy_mix,
            result_champion_id: result,
        });
    };

    let decision = match pending.action_type {
        BpActionType::Pick => input.pick_decision,
        BpActionType::Ban => input.ban_decision,
    };
    let auto_target_id = auto_target(decision);

    let (total_games, total_wins) = input
        .my_stats
        .values()
        .fold((0u32, 0u32), |(g, w), (games, wins)| (g + games, w + wins));
    let ctx = ScoreCtx {
        input,
        position: detect_my_position(session, input.my_puuid).map(position_to_lcu),
        allies: ally_ids,
        enemies: enemy_ids,
        // 动作列表之外再并上双方已亮出的英雄：部分队列（盲选等）不把别人的选择
        // 放进 actions，只体现在队伍列表里
        unavailable: unavailable_map(session)
            .into_keys()
            .chain(enemy_champion_ids(session))
            .chain(ally_champion_ids(session))
            .collect(),
        my_avg: if total_games >= MIN_GAMES_FOR_AVG {
            total_wins as f64 / total_games as f64
        } else {
            0.5
        },
    };

    let candidates = match pending.action_type {
        BpActionType::Pick => {
            let scored = ctx
                .pick_candidate_ids()
                .into_iter()
                .map(|id| ctx.score_pick(id))
                .collect();
            shortlist(scored, auto_target_id)
                .into_iter()
                .map(|s| {
                    let (games, wins) = input.my_stats.get(&s.id).copied().unwrap_or((0, 0));
                    let in_pool = ctx.in_pick_pool(s.id);
                    BpPanelCandidate {
                        champion_id: s.id,
                        score: sigmoid(s.total),
                        in_pool,
                        physical_share: input.damage.get(&s.id).copied(),
                        games,
                        wins,
                        unfamiliar: games == 0 || (games < 5 && !in_pool),
                        reasons: top_reasons(s.reasons),
                        warning: s.warning,
                    }
                })
                .collect()
        }
        BpActionType::Ban => {
            let my_pick = ctx.intended_pick();
            let scored: Vec<Scored> = ctx
                .ban_candidate_ids(my_pick)
                .into_iter()
                .map(|id| ctx.score_ban(id, my_pick))
                .collect();
            let shown = shortlist(scored, auto_target_id);
            // 威胁度按第一名归一化，避免绝对刻度在强势版本里全部顶满
            let top = shown.iter().map(|s| s.total).fold(1.0_f64, f64::max);
            shown
                .into_iter()
                .map(|s| BpPanelCandidate {
                    champion_id: s.id,
                    score: (s.total / top * THREAT_TOP).clamp(0.0, THREAT_TOP),
                    in_pool: true,
                    physical_share: input.damage.get(&s.id).copied(),
                    games: 0,
                    wins: 0,
                    unfamiliar: false,
                    reasons: s.reasons,
                    warning: None,
                })
                .collect()
        }
    };

    Some(BpPanel {
        action_type: pending.action_type,
        stage: if pending.is_in_progress && is_actionable_phase(&timer.phase) {
            BpPanelStage::Acting
        } else {
            BpPanelStage::Waiting
        },
        candidates,
        auto_target_id,
        hovered_id: pending.champion_id,
        overridden: decision.is_some_and(|d| d.user_overridden),
        time_left_secs,
        total_secs,
        execute_at_secs_left: decision.map_or(0.0, |d| d.execute_at_secs_left),
        ally_mix,
        enemy_mix,
        result_champion_id: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bp_decision::types::{BpOrigin, BpTarget};
    use crate::lcu::api::champion_select::{Action, OnePlayer, Timer};
    use crate::opgg::data::LaneCounter;

    const ME: &str = "me";

    fn player(cell_id: i32, puuid: &str, champion_id: i32, position: &str) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: puuid.to_string(),
            obfuscated_puuid: String::new(),
            assigned_position: position.to_string(),
            cell_id,
            champion_pick_intent: 0,
        }
    }

    fn action(id: i32, cell: i32, ty: &str, champion_id: i32, done: bool, live: bool) -> Action {
        Action {
            actor_cell_id: cell,
            id,
            champion_id,
            completed: done,
            is_ally_action: cell < 5,
            is_in_progress: live,
            action_type: ty.to_string(),
        }
    }

    /// 我在 0 号格打中路；`actions` 由各用例自己给。
    fn session(actions: Vec<Action>, allies: &[i32], enemies: &[i32]) -> SelectSession {
        let mut my_team = vec![player(0, ME, 0, "middle")];
        for (i, &id) in allies.iter().enumerate() {
            my_team.push(player(i as i32 + 1, "ally", id, ""));
        }
        SelectSession {
            my_team,
            their_team: enemies
                .iter()
                .enumerate()
                .map(|(i, &id)| player(i as i32 + 5, "enemy", id, ""))
                .collect(),
            actions: vec![actions],
            timer: Timer {
                adjusted_time_left_in_phase: 20_000.0,
                total_time_in_phase: 27_000.0,
                phase: "BAN_PICK".to_string(),
                ..Timer::default()
            },
            local_player_cell_id: 0,
        }
    }

    fn meta(id: i32, win_rate: f64, role_rate: f64) -> (i32, Vec<ChampionMeta>) {
        (
            id,
            vec![ChampionMeta {
                champion_id: id,
                position: "MIDDLE".to_string(),
                tier: 2,
                rank: 1,
                rank_prev_patch: 1,
                win_rate,
                pick_rate: 0.05,
                ban_rate: 0.1,
                role_rate,
                is_main_position: true,
            }],
        )
    }

    fn snapshot(
        champions: Vec<(i32, Vec<ChampionMeta>)>,
        counters: Vec<(i32, i32, f64)>,
    ) -> OpggSnapshot {
        let mut map: HashMap<i32, Vec<LaneCounter>> = HashMap::new();
        for (subject, opponent, wr) in counters {
            map.entry(subject).or_default().push(LaneCounter {
                opponent_id: opponent,
                position: "MIDDLE".to_string(),
                subject_win_rate: wr,
                play: 1000,
            });
        }
        OpggSnapshot {
            mode: "ranked".to_string(),
            tier: "emerald_plus".to_string(),
            patch: "16.23".to_string(),
            fetched_at: 0,
            champions: champions.into_iter().collect(),
            counters: map,
        }
    }

    fn decision(
        action_type: BpActionType,
        champion_id: i32,
        mode: BpMode,
        lock: bool,
    ) -> BpDecision {
        BpDecision {
            action_type,
            target: Some(BpTarget {
                champion_id,
                lock,
                origin: BpOrigin::Fallback { pool_size: 1 },
                evidence: None,
            }),
            rejected: Vec::new(),
            mode,
            time_left_secs: 20.0,
            execute_at_secs_left: 5.0,
            user_overridden: false,
            is_in_progress: true,
        }
    }

    struct Fixture {
        session: SelectSession,
        snapshot: Option<OpggSnapshot>,
        pick_pool: Vec<i32>,
        ban_pool: Vec<i32>,
        pick_decision: Option<BpDecision>,
        ban_decision: Option<BpDecision>,
        my_stats: HashMap<i32, (u32, u32)>,
        damage: HashMap<i32, f64>,
    }

    impl Fixture {
        fn new(session: SelectSession) -> Self {
            Self {
                session,
                snapshot: None,
                pick_pool: Vec::new(),
                ban_pool: Vec::new(),
                pick_decision: None,
                ban_decision: None,
                my_stats: HashMap::new(),
                damage: HashMap::new(),
            }
        }

        fn build(&self) -> Option<BpPanel> {
            build_panel(&PanelInput {
                session: &self.session,
                my_puuid: ME,
                snapshot: self.snapshot.as_ref(),
                pick_pool: &self.pick_pool,
                ban_pool: &self.ban_pool,
                pick_decision: self.pick_decision.as_ref(),
                ban_decision: self.ban_decision.as_ref(),
                my_stats: &self.my_stats,
                damage: &self.damage,
            })
        }
    }

    fn ids(panel: &BpPanel) -> Vec<i32> {
        panel.candidates.iter().map(|c| c.champion_id).collect()
    }

    #[test]
    fn should_return_none_without_any_action_of_mine() {
        let f = Fixture::new(session(
            vec![action(1, 5, "pick", 0, false, true)],
            &[],
            &[],
        ));

        assert_eq!(f.build(), None);
    }

    #[test]
    fn should_be_waiting_until_my_turn_and_acting_when_in_progress() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, false)],
            &[],
            &[],
        ));
        f.pick_pool = vec![103];
        assert_eq!(f.build().unwrap().stage, BpPanelStage::Waiting);

        f.session.actions[0][0].is_in_progress = true;
        assert_eq!(f.build().unwrap().stage, BpPanelStage::Acting);
    }

    #[test]
    fn should_stay_waiting_in_planning_phase_even_if_marked_in_progress() {
        // LCU 在 PLANNING 期间就把 ban action 标成 in-progress，但那时提交无效
        let mut f = Fixture::new(session(vec![action(1, 0, "ban", 0, false, true)], &[], &[]));
        f.session.timer.phase = "PLANNING".to_string();
        f.ban_pool = vec![238];

        assert_eq!(f.build().unwrap().stage, BpPanelStage::Waiting);
    }

    #[test]
    fn should_report_done_with_my_locked_champion() {
        let f = Fixture::new(session(
            vec![action(1, 0, "pick", 103, true, false)],
            &[],
            &[],
        ));

        let panel = f.build().unwrap();

        assert_eq!(panel.stage, BpPanelStage::Done);
        assert_eq!(panel.result_champion_id, 103);
        assert!(panel.candidates.is_empty());
    }

    #[test]
    fn should_rank_pick_countering_revealed_enemy_first() {
        // 两个池内英雄版本强度相同；敌方亮出的 238 被 90 克制（238 打 90 胜率 45%）
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[238],
        ));
        f.pick_pool = vec![103, 90];
        f.snapshot = Some(snapshot(
            vec![
                meta(103, 0.51, 1.0),
                meta(90, 0.51, 1.0),
                meta(238, 0.5, 1.0),
            ],
            vec![(238, 90, 0.45)],
        ));

        let panel = f.build().unwrap();

        assert_eq!(ids(&panel), vec![90, 103]);
        let top = &panel.candidates[0];
        assert!(top.score > panel.candidates[1].score);
        assert!(top
            .reasons
            .iter()
            .any(|r| r.kind == BpReasonKind::Counters && r.champion_id == 238));
    }

    #[test]
    fn should_penalize_pick_countered_by_revealed_enemy() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[238],
        ));
        f.pick_pool = vec![103, 90];
        f.snapshot = Some(snapshot(
            vec![
                meta(103, 0.51, 1.0),
                meta(90, 0.51, 1.0),
                meta(238, 0.5, 1.0),
            ],
            vec![(103, 238, 0.44)],
        ));

        let panel = f.build().unwrap();

        assert_eq!(ids(&panel), vec![90, 103]);
        assert!(panel.candidates[1]
            .reasons
            .iter()
            .any(|r| r.kind == BpReasonKind::CounteredBy && r.champion_id == 238));
    }

    #[test]
    fn should_ignore_enemy_who_does_not_play_my_lane() {
        // 238 完全不打中路（role_rate 0）：即使有克制记录也不该影响中路候选
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[238],
        ));
        f.pick_pool = vec![103];
        f.snapshot = Some(snapshot(
            vec![meta(103, 0.51, 1.0), meta(238, 0.5, 0.0)],
            vec![(103, 238, 0.4)],
        ));

        let panel = f.build().unwrap();

        assert!(!panel.candidates[0]
            .reasons
            .iter()
            .any(|r| r.kind == BpReasonKind::CounteredBy));
    }

    #[test]
    fn should_prefer_champion_i_win_with() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[],
        ));
        f.pick_pool = vec![103, 90];
        f.my_stats = HashMap::from([(103, (20, 6)), (90, (20, 15))]);

        let panel = f.build().unwrap();

        assert_eq!(ids(&panel), vec![90, 103]);
        assert_eq!(
            (panel.candidates[0].games, panel.candidates[0].wins),
            (20, 15)
        );
    }

    #[test]
    fn should_mark_out_of_pool_meta_pick_and_penalize_unfamiliarity() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[],
        ));
        f.pick_pool = vec![103];
        f.snapshot = Some(snapshot(
            vec![meta(103, 0.51, 1.0), meta(711, 0.51, 1.0)],
            vec![],
        ));

        let panel = f.build().unwrap();

        // 版本强度相同，池外且没玩过的排在后面
        assert_eq!(ids(&panel), vec![103, 711]);
        assert!(panel.candidates[0].in_pool);
        assert!(!panel.candidates[1].in_pool);
        assert!(panel.candidates[1].unfamiliar);
    }

    #[test]
    fn should_exclude_banned_and_taken_champions() {
        let mut f = Fixture::new(session(
            vec![
                action(1, 5, "ban", 103, true, false),
                action(2, 6, "pick", 90, true, false),
                action(3, 0, "pick", 0, false, true),
            ],
            &[],
            &[90],
        ));
        f.pick_pool = vec![103, 90, 134];

        assert_eq!(ids(&f.build().unwrap()), vec![134]);
    }

    #[test]
    fn should_warn_when_pick_leaves_team_without_magic_damage() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[64, 92],
            &[],
        ));
        f.pick_pool = vec![238, 103];
        f.damage = HashMap::from([(64, 0.9), (92, 0.9), (238, 0.9), (103, 0.1)]);

        let panel = f.build().unwrap();

        assert_eq!(ids(&panel), vec![103, 238]);
        assert_eq!(panel.candidates[0].warning, None);
        assert!(panel.candidates[0]
            .reasons
            .iter()
            .any(|r| r.kind == BpReasonKind::CompFill));
        assert_eq!(panel.candidates[1].warning, Some(BpCompWarning::LackMagic));
        assert_eq!(panel.ally_mix.known, 2);
    }

    #[test]
    fn should_not_judge_comp_with_too_few_known_champions() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[64],
            &[],
        ));
        f.pick_pool = vec![238];
        f.damage = HashMap::from([(64, 0.9), (238, 0.9)]);

        assert_eq!(f.build().unwrap().candidates[0].warning, None);
    }

    #[test]
    fn should_take_auto_target_from_decision_only_when_it_will_lock() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[],
        ));
        f.pick_pool = vec![103];

        f.pick_decision = Some(decision(BpActionType::Pick, 103, BpMode::Auto, true));
        assert_eq!(f.build().unwrap().auto_target_id, Some(103));

        // 自动化没开：只是建议
        f.pick_decision = Some(decision(BpActionType::Pick, 103, BpMode::Advisory, true));
        assert_eq!(f.build().unwrap().auto_target_id, None);

        // 规则配成只预选不锁定：不能承诺「将自动选择」
        f.pick_decision = Some(decision(BpActionType::Pick, 103, BpMode::Auto, false));
        assert_eq!(f.build().unwrap().auto_target_id, None);
    }

    #[test]
    fn should_keep_auto_target_in_list_even_if_it_scores_low() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 0, false, true)],
            &[],
            &[],
        ));
        f.pick_pool = vec![1, 2, 3, 4, 5, 6];
        // 6 号胜率最低，按分数排不进前五
        f.my_stats = (1..=6)
            .map(|id| (id, (20, if id == 6 { 2 } else { 12 })))
            .collect();
        f.pick_decision = Some(decision(BpActionType::Pick, 6, BpMode::Auto, true));

        let panel = f.build().unwrap();

        assert_eq!(panel.candidates.len(), SHOWN);
        assert_eq!(panel.candidates.last().unwrap().champion_id, 6);
    }

    #[test]
    fn should_carry_hover_and_override_state() {
        let mut f = Fixture::new(session(
            vec![action(1, 0, "pick", 90, false, true)],
            &[],
            &[],
        ));
        f.pick_pool = vec![103, 90];
        let mut d = decision(BpActionType::Pick, 103, BpMode::Auto, true);
        d.user_overridden = true;
        f.pick_decision = Some(d);

        let panel = f.build().unwrap();

        assert_eq!(panel.hovered_id, 90);
        assert!(panel.overridden);
        assert_eq!(panel.execute_at_secs_left, 5.0);
        assert_eq!(panel.total_secs, 27.0);
    }

    #[test]
    fn should_rank_ban_threatening_my_pick_first() {
        // 我要选 103；238 克制 103（103 打 238 胜率 44%），7 只是版本强
        let mut f = Fixture::new(session(vec![action(1, 0, "ban", 0, false, true)], &[], &[]));
        f.pick_pool = vec![103];
        f.snapshot = Some(snapshot(
            vec![
                meta(103, 0.51, 1.0),
                meta(238, 0.5, 1.0),
                meta(7, 0.52, 1.0),
            ],
            vec![(103, 238, 0.44)],
        ));

        let panel = f.build().unwrap();

        assert_eq!(panel.action_type, BpActionType::Ban);
        assert_eq!(ids(&panel), vec![238, 7]);
        assert_eq!(panel.candidates[0].score, THREAT_TOP);
        assert!(panel.candidates[0]
            .reasons
            .iter()
            .any(|r| r.kind == BpReasonKind::ThreatToPick && r.champion_id == 103));
    }

    #[test]
    fn should_not_suggest_banning_my_pick_or_ally_intent() {
        let mut f = Fixture::new(session(vec![action(1, 0, "ban", 0, false, true)], &[], &[]));
        f.session.my_team.push(OnePlayer {
            champion_pick_intent: 7,
            ..player(1, "ally", 0, "")
        });
        f.pick_pool = vec![103];
        f.ban_pool = vec![103, 7, 238];

        assert_eq!(ids(&f.build().unwrap()), vec![238]);
    }

    #[test]
    fn should_read_matchup_from_either_side() {
        let s = snapshot(vec![], vec![(238, 90, 0.45)]);

        assert_eq!(
            matchup_win_rate(Some(&s), 238, 90, Some("MIDDLE")),
            Some(0.45)
        );
        assert_eq!(
            matchup_win_rate(Some(&s), 90, 238, Some("MIDDLE")),
            Some(0.55)
        );
        assert_eq!(matchup_win_rate(Some(&s), 90, 103, Some("MIDDLE")), None);
    }
}
