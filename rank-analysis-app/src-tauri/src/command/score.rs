//! # 确定性评分层（Akari 式 17 分制）
//!
//! 参照 Akari `src/shared/data-adapter/analysis/player/scoring.ts` 与
//! `constants.ts` 的公式（满分 17 分，9 维）：
//!
//! | 维度 | 满分 | 公式 |
//! |------|------|------|
//! | KDA | 1 | `clamp(sqrt(max(kda-2,0))*3/7, 0, 1)`，kda≥9 满分 |
//! | 胜率（单局） | 1 | 赢 1 / 输 0 |
//! | 输出伤害 | 3 | `linear(ratio, 1.0, 2.0, 3)`，ratio = 该玩家伤害 `* 队伍人数 / 队总伤害`（理应贡献比） |
//! | 承伤 | 2 | `linear(ratio, 1.0, 2.0, 2)`，同上 |
//! | 治疗 | 2 | `linear(heal / (队总承伤/人数), 0.2, 1.4, 2)` |
//! | 补刀 | 2 | `linear(cs/分, 5, 10, 2)` |
//! | 经济 | 2 | `linear(gold ratio, 1.0, 1.5, 2)` |
//! | 参团率 | 2 | `linear(kp, 0.3, 1.0, 2)`，kp=(击杀+助攻)/队总击杀 |
//! | 视野 | 2 | `linear(vision ratio, 1.0, 2.0, 2)`，同上理应贡献比 |
//!
//! **纪律**：本模块是纯确定性计算（无 LLM、无随机），AI 复盘只能在其之上
//! 做「解释层」；与 lineupscore/wegame_score 一样禁止编造缺失数据——除零场景
//! 该维记 0 分。生成 src-tauri 侧 `MaintainedResult` 语义的 Vec 输出，前端渲染。
//!
//! 数据源：LCU `get_game_by_id`（本机账号对局，moka 缓存）或前端已有 10 人
//! 统计数据（SGP 详情页场景），走纯计算入口 [`compute_player_scores`]。

use std::sync::LazyLock;
use std::time::Duration;

use moka::future::Cache;
use serde::{Deserialize, Serialize};

use crate::command::match_history::get_game_by_id;
use crate::lcu::api::model::{Participant, ParticipantIdentity};

/// Akari 总分上限（9 维满分之和）。
pub const AKARI_MAX_SCORE: f64 = 17.0;

/// KDA 维基准与评分斜率（Akari constants）：baseline=2，满分 1 分。
const KDA_BASELINE: f64 = 2.0;
const KDA_SLOPE: f64 = 3.0 / 7.0;

const FULL_SCORE_KDA: f64 = 1.0;
const FULL_SCORE_WIN: f64 = 1.0;
const FULL_SCORE_DAMAGE: f64 = 3.0;
const FULL_SCORE_TAKEN: f64 = 2.0;
const FULL_SCORE_HEAL: f64 = 2.0;
const FULL_SCORE_CS: f64 = 2.0;
const FULL_SCORE_GOLD: f64 = 2.0;
const FULL_SCORE_PARTICIPATION: f64 = 2.0;
const FULL_SCORE_VISION: f64 = 2.0;

/// 线性维的「理应贡献比」区间：ratio ∈ [min, max] → [0, 满分]。
const RATIO_MIN_DAMAGE: f64 = 1.0;
const RATIO_MAX_DAMAGE: f64 = 2.0;
const RATIO_MIN_TAKEN: f64 = 1.0;
const RATIO_MAX_TAKEN: f64 = 2.0;
/// 治疗基准：达到队均承伤的 20% 起算，满 2 倍基准满分。
const HEAL_RATIO_MIN: f64 = 0.2;
const HEAL_RATIO_MAX: f64 = 1.4;
/// 补刀：5 补刀/分 起算，10 补刀/分 满分。
const CS_MIN_PER_MIN: f64 = 5.0;
const CS_MAX_PER_MIN: f64 = 10.0;
/// 经济：达到人均等分起算，1.5 倍人均满分。
const RATIO_MIN_GOLD: f64 = 1.0;
const RATIO_MAX_GOLD: f64 = 1.5;
/// 参团：30% 起算，100% 满分。
const KP_MIN: f64 = 0.3;
const KP_MAX: f64 = 1.0;
/// 视野：人均等分起算，2 倍人均满分。
const RATIO_MIN_VISION: f64 = 1.0;
const RATIO_MAX_VISION: f64 = 2.0;

// 队总承伤为 0 且治疗>0 时治疗维的兜底：仍按满价值记 0（无基准），
// 不编造任何分数（纪律）。`linear` 的 min==max 时输出 0。

/// 单名玩家的 9 维明细（输出给前端/AI，camelCase）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerScoreBreakdown {
    pub kda: f64,
    pub win: f64,
    pub damage: f64,
    pub damage_taken: f64,
    pub heal: f64,
    pub cs: f64,
    pub gold: f64,
    pub participation: f64,
    pub vision: f64,
}

/// 单名玩家的确定性评分（17 分制）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerScore {
    pub participant_id: i32,
    pub champion_id: i32,
    pub team_id: i32,
    pub puuid: String,
    pub summoner_name: String,
    pub win: bool,
    pub total: f64,
    pub breakdown: PlayerScoreBreakdown,
}

/// 评分输入：单名玩家的本局原始统计（前端 SGP 场景或 LCU 映射）。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerScoreInput {
    pub participant_id: i32,
    pub champion_id: i32,
    pub team_id: i32,
    #[serde(default)]
    pub puuid: String,
    #[serde(default)]
    pub summoner_name: String,
    #[serde(default)]
    pub win: bool,
    #[serde(default)]
    pub kills: i32,
    #[serde(default)]
    pub deaths: i32,
    #[serde(default)]
    pub assists: i32,
    #[serde(default)]
    pub gold_earned: i32,
    #[serde(default)]
    pub damage_dealt_to_champions: i32,
    #[serde(default)]
    pub damage_taken: i32,
    #[serde(default)]
    pub total_heal: i32,
    /// 总补刀 = 小兵 + 野怪。
    #[serde(default)]
    pub cs: i32,
    #[serde(default)]
    pub vision_score: i32,
    /// 对局时长（秒），全队共用（只取首个输入的值即可）。
    #[serde(default)]
    pub game_duration: i32,
}

/// 由 LCU `Participant` + 身份（同索引对应）换算评分输入。
fn input_from_lcu_participant(
    p: &Participant,
    identity: Option<&ParticipantIdentity>,
    game_duration: i32,
) -> PlayerScoreInput {
    PlayerScoreInput {
        participant_id: p.participant_id,
        champion_id: p.champion_id,
        team_id: p.team_id,
        puuid: identity.map(|i| i.player.puuid.clone()).unwrap_or_default(),
        summoner_name: identity
            .map(|i| i.player.summoner_name.clone())
            .unwrap_or_default(),
        win: p.stats.win,
        kills: p.stats.kills,
        deaths: p.stats.deaths,
        assists: p.stats.assists,
        gold_earned: p.stats.gold_earned,
        damage_dealt_to_champions: p.stats.total_damage_dealt_to_champions,
        damage_taken: p.stats.total_damage_taken,
        total_heal: p.stats.total_heal,
        cs: p.stats.total_minions_killed + p.stats.neutral_minions_killed,
        vision_score: p.stats.vision_score,
        game_duration,
    }
}

/// 线性归一：`(value-min)/(max-min)` clamp 0..1 后乘满分。
fn linear(value: f64, min: f64, max: f64, full: f64) -> f64 {
    if max <= min {
        return 0.0;
    }
    ((value - min) / (max - min)).clamp(0.0, 1.0) * full
}

/// 「理应贡献比」：玩家值 / 队总值 * 队伍人数（Akari
/// `getExpectedContributionRatio`；队总值为 0 时返回 0，不编造）。
fn contribution_ratio(value: f64, team_total: f64, team_size: usize) -> f64 {
    if team_total <= 0.0 || team_size == 0 {
        return 0.0;
    }
    value / team_total * team_size as f64
}

/// 9 维逐一评分（Akari 公式全集）。
fn score_dimensions(
    s: &PlayerScoreInput,
    team_damage: f64,
    team_taken: f64,
    team_gold: f64,
    team_vision: f64,
    team_kills: f64,
    team_size: usize,
) -> PlayerScoreBreakdown {
    let kda = (f64::from(s.kills) + f64::from(s.assists)) / f64::from(s.deaths.max(1));
    let damage_ratio = contribution_ratio(
        f64::from(s.damage_dealt_to_champions),
        team_damage,
        team_size,
    );
    let taken_ratio = contribution_ratio(f64::from(s.damage_taken), team_taken, team_size);
    // 治疗基准：队均承伤（Akari multi-squad 用 1.4 / 单排 1.0；此处 ≥3 人队伍按
    // 组排基准，规模不足按单排基准）。
    let heal_ratio = if team_taken > 0.0 && team_size > 0 {
        f64::from(s.total_heal) / (team_taken / team_size as f64)
    } else {
        0.0
    };
    let heal_full = if team_size >= 3 { HEAL_RATIO_MAX } else { 1.0 };
    let cs_per_min = if s.game_duration > 0 {
        f64::from(s.cs) / (f64::from(s.game_duration) / 60.0)
    } else {
        0.0
    };
    let gold_ratio = contribution_ratio(f64::from(s.gold_earned), team_gold, team_size);
    let kp = if team_kills > 0.0 {
        (f64::from(s.kills) + f64::from(s.assists)) / team_kills
    } else {
        0.0
    };
    let vision_ratio = contribution_ratio(f64::from(s.vision_score), team_vision, team_size);

    PlayerScoreBreakdown {
        kda: linear(
            (kda - KDA_BASELINE).max(0.0).sqrt() * KDA_SLOPE,
            0.0,
            1.0,
            FULL_SCORE_KDA,
        ),
        win: if s.win { FULL_SCORE_WIN } else { 0.0 },
        damage: linear(
            damage_ratio,
            RATIO_MIN_DAMAGE,
            RATIO_MAX_DAMAGE,
            FULL_SCORE_DAMAGE,
        ),
        damage_taken: linear(
            taken_ratio,
            RATIO_MIN_TAKEN,
            RATIO_MAX_TAKEN,
            FULL_SCORE_TAKEN,
        ),
        heal: linear(heal_ratio, HEAL_RATIO_MIN, heal_full, FULL_SCORE_HEAL),
        cs: linear(cs_per_min, CS_MIN_PER_MIN, CS_MAX_PER_MIN, FULL_SCORE_CS),
        gold: linear(gold_ratio, RATIO_MIN_GOLD, RATIO_MAX_GOLD, FULL_SCORE_GOLD),
        participation: linear(kp, KP_MIN, KP_MAX, FULL_SCORE_PARTICIPATION),
        vision: linear(
            vision_ratio,
            RATIO_MIN_VISION,
            RATIO_MAX_VISION,
            FULL_SCORE_VISION,
        ),
    }
}

/// 对整局 10 人（或任意人数）计算确定性评分。
///
/// 队级聚合在函数内完成（伤害/承伤/经济/视野/击杀按 teamId 分组求和），
/// 输入缺字段按 0 降级（纪律：不编造，缺什么维度记 0）。
pub fn score_participants(inputs: &[PlayerScoreInput]) -> Vec<PlayerScore> {
    let team_damage: std::collections::HashMap<i32, f64> = inputs
        .iter()
        .map(|s| (s.team_id, f64::from(s.damage_dealt_to_champions)))
        .fold(std::collections::HashMap::new(), |mut m, (k, v)| {
            *m.entry(k).or_default() += v;
            m
        });
    let team_taken: std::collections::HashMap<i32, f64> = inputs
        .iter()
        .map(|s| (s.team_id, f64::from(s.damage_taken)))
        .fold(std::collections::HashMap::new(), |mut m, (k, v)| {
            *m.entry(k).or_default() += v;
            m
        });
    let team_gold: std::collections::HashMap<i32, f64> = inputs
        .iter()
        .map(|s| (s.team_id, f64::from(s.gold_earned)))
        .fold(std::collections::HashMap::new(), |mut m, (k, v)| {
            *m.entry(k).or_default() += v;
            m
        });
    let team_vision: std::collections::HashMap<i32, f64> = inputs
        .iter()
        .map(|s| (s.team_id, f64::from(s.vision_score)))
        .fold(std::collections::HashMap::new(), |mut m, (k, v)| {
            *m.entry(k).or_default() += v;
            m
        });
    let team_kills: std::collections::HashMap<i32, f64> = inputs
        .iter()
        .map(|s| (s.team_id, f64::from(s.kills + s.assists)))
        .fold(std::collections::HashMap::new(), |mut m, (k, v)| {
            *m.entry(k).or_default() += v;
            m
        });
    let team_sizes: std::collections::HashMap<i32, usize> = {
        let mut m: std::collections::HashMap<i32, usize> = std::collections::HashMap::new();
        for s in inputs {
            *m.entry(s.team_id).or_default() += 1;
        }
        m
    };

    inputs
        .iter()
        .map(|s| {
            let damage = team_damage.get(&s.team_id).copied().unwrap_or(0.0);
            let taken = team_taken.get(&s.team_id).copied().unwrap_or(0.0);
            let gold = team_gold.get(&s.team_id).copied().unwrap_or(0.0);
            let vision = team_vision.get(&s.team_id).copied().unwrap_or(0.0);
            let kills_a = team_kills.get(&s.team_id).copied().unwrap_or(0.0);
            let size = team_sizes.get(&s.team_id).copied().unwrap_or(0);
            let breakdown = score_dimensions(s, damage, taken, gold, vision, kills_a, size);
            let total = (breakdown.kda
                + breakdown.win
                + breakdown.damage
                + breakdown.damage_taken
                + breakdown.heal
                + breakdown.cs
                + breakdown.gold
                + breakdown.participation
                + breakdown.vision)
                .min(AKARI_MAX_SCORE);
            PlayerScore {
                participant_id: s.participant_id,
                champion_id: s.champion_id,
                team_id: s.team_id,
                puuid: s.puuid.clone(),
                summoner_name: s.summoner_name.clone(),
                win: s.win,
                total,
                breakdown,
            }
        })
        .collect()
}

/// 缓存：按 gameId 的 LCU 整局评分（局数据不可变，无 TTL，max 500）。
pub static GAME_SCORE_CACHE: LazyLock<Cache<String, Vec<PlayerScore>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(500)
        .time_to_live(Duration::from_secs(3600))
        .build()
});

/// 按 LCU 对局 ID 出 10 人评分（moka 缓存，秒出）。
#[tauri::command]
pub async fn get_player_scores(game_id: i64) -> Result<Vec<PlayerScore>, String> {
    let key = game_id.to_string();
    if let Some(cached) = GAME_SCORE_CACHE.get(&key).await {
        return Ok(cached);
    }
    let game = get_game_by_id(game_id)
        .await
        .map_err(|e| format!("对局详情拉取失败: {e}"))?;
    let inputs: Vec<PlayerScoreInput> = game
        .participants
        .iter()
        .enumerate()
        .map(|(i, p)| {
            input_from_lcu_participant(p, game.participant_identities.get(i), game.game_duration)
        })
        .collect();
    let scores = score_participants(&inputs);
    GAME_SCORE_CACHE.insert(key, scores.clone()).await;
    Ok(scores)
}

/// 纯计算入口：前端把整局统计（SGP 详情页等已有 10 人数据场景）传进来出分，
/// 无 IO、无缓存（数据已在手，秒出）。
#[tauri::command]
pub fn compute_player_scores(inputs: Vec<PlayerScoreInput>) -> Vec<PlayerScore> {
    score_participants(&inputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试数据构造器：12 个位置参数直通 `PlayerScoreInput` 字段，
    /// 单行可读性优先（clippy::too_many_arguments 对测试 helper 让步）。
    #[allow(clippy::too_many_arguments)]
    fn input(
        team: i32,
        wins: bool,
        kills: i32,
        deaths: i32,
        assists: i32,
        gold: i32,
        dmg: i32,
        taken: i32,
        heal: i32,
        cs: i32,
        vision: i32,
        duration: i32,
    ) -> PlayerScoreInput {
        PlayerScoreInput {
            participant_id: team * 10 + 1,
            champion_id: 1,
            team_id: team,
            puuid: format!("p-{team}"),
            summoner_name: format!("p{team}"),
            win: wins,
            kills,
            deaths,
            assists,
            gold_earned: gold,
            damage_dealt_to_champions: dmg,
            damage_taken: taken,
            total_heal: heal,
            cs,
            vision_score: vision,
            game_duration: duration,
        }
    }

    /// 全员满分输入 → 总分恰为 17（Akari single/akari.test.ts 同款断言）。
    #[test]
    fn all_max_inputs_score_exactly_seventeen() {
        // 5 人队：A 独吞击杀（kp=1）、伤害/承伤/视野各占 40%（ratio=2）、
        // 经济占 30%（ratio=1.5）、治疗达队均承伤 1.4 倍、补刀 10/min、kda≥9、
        // 赢局 → 9 维全满 → 总分 17。
        let inputs = vec![
            PlayerScoreInput {
                participant_id: 1,
                champion_id: 1,
                team_id: 100,
                puuid: "a".into(),
                summoner_name: "A".into(),
                win: true,
                kills: 50,
                deaths: 1,
                assists: 50,
                gold_earned: 30000,
                damage_dealt_to_champions: 40000,
                damage_taken: 40000,
                total_heal: 28000,
                cs: 400,
                vision_score: 600,
                game_duration: 2400,
            },
            // 其余 4 人：只保证队伍聚合值（伤害/承伤 100000、经济 100000、视野 1500）
            PlayerScoreInput {
                participant_id: 2,
                champion_id: 2,
                team_id: 100,
                puuid: "b".into(),
                summoner_name: "B".into(),
                win: false,
                kills: 0,
                deaths: 1,
                assists: 0,
                gold_earned: 17500,
                damage_dealt_to_champions: 15000,
                damage_taken: 15000,
                total_heal: 0,
                cs: 200,
                vision_score: 225,
                game_duration: 2400,
            },
            PlayerScoreInput {
                participant_id: 3,
                champion_id: 3,
                team_id: 100,
                puuid: "c".into(),
                summoner_name: "C".into(),
                win: false,
                kills: 0,
                deaths: 1,
                assists: 0,
                gold_earned: 17500,
                damage_dealt_to_champions: 15000,
                damage_taken: 15000,
                total_heal: 0,
                cs: 200,
                vision_score: 225,
                game_duration: 2400,
            },
            PlayerScoreInput {
                participant_id: 4,
                champion_id: 4,
                team_id: 100,
                puuid: "d".into(),
                summoner_name: "D".into(),
                win: false,
                kills: 0,
                deaths: 1,
                assists: 0,
                gold_earned: 17500,
                damage_dealt_to_champions: 15000,
                damage_taken: 15000,
                total_heal: 0,
                cs: 200,
                vision_score: 225,
                game_duration: 2400,
            },
            PlayerScoreInput {
                participant_id: 5,
                champion_id: 5,
                team_id: 100,
                puuid: "e".into(),
                summoner_name: "E".into(),
                win: false,
                kills: 0,
                deaths: 1,
                assists: 0,
                gold_earned: 17500,
                damage_dealt_to_champions: 15000,
                damage_taken: 15000,
                total_heal: 0,
                cs: 200,
                vision_score: 225,
                game_duration: 2400,
            },
        ];
        let scores = score_participants(&inputs);
        assert_eq!(scores.len(), 5);
        let a = &scores[0];
        assert!(
            (a.total - AKARI_MAX_SCORE).abs() < 1e-6,
            "总分应恰为 17，实际 {}",
            a.total
        );
    }

    /// KDA 维：kda=9 以上满分；kda≤2 记 0。
    #[test]
    fn kda_dimension_saturates_at_nine() {
        let team = |kills: i32, deaths: i32, assists: i32| {
            input(
                100, true, kills, deaths, assists, 1000, 100, 100, 10, 10, 10, 1800,
            )
        };
        let scores = score_participants(&[team(9, 1, 0)]);
        assert!((scores[0].breakdown.kda - 1.0).abs() < 1e-9);
        let scores = score_participants(&[team(2, 1, 0)]);
        assert!((scores[0].breakdown.kda - 0.0).abs() < 1e-9);
        // kda=4 → sqrt(2)*3/7 ≈ 0.606
        let scores = score_participants(&[team(4, 1, 0)]);
        let expected = (2.0f64.sqrt() * (3.0 / 7.0)).min(1.0);
        assert!((scores[0].breakdown.kda - expected).abs() < 1e-9);
    }

    /// 团队聚合：ratio 按队伍分组算（不应跨队稀释）。
    #[test]
    fn contribution_ratio_grouped_by_team() {
        // 队 A 5 人：A1 占 40%（ratio=2 满分），其余 4 人各 15%；队 B 1 人（ratio=1 → 0 分）
        let mut inputs: Vec<PlayerScoreInput> = vec![
            input(100, true, 3, 1, 2, 1000, 40000, 100, 10, 10, 10, 1800),
            input(100, false, 3, 1, 2, 1000, 15000, 100, 10, 10, 10, 1800),
            input(100, false, 3, 1, 2, 1000, 15000, 100, 10, 10, 10, 1800),
            input(100, false, 3, 1, 2, 1000, 15000, 100, 10, 10, 10, 1800),
            input(100, false, 3, 1, 2, 1000, 15000, 100, 10, 10, 10, 1800),
        ];
        inputs.push(input(
            200, true, 3, 1, 2, 1000, 10000, 100, 10, 10, 10, 1800,
        ));
        let scores = score_participants(&inputs);
        let a: Vec<_> = scores.iter().filter(|s| s.team_id == 100).collect();
        assert!((a[0].breakdown.damage - 3.0).abs() < 1e-9);
        let b: Vec<_> = scores.iter().filter(|s| s.team_id == 200).collect();
        assert!((b[0].breakdown.damage - 0.0).abs() < 1e-9);
    }

    /// 除零纪律：时长 0 / 队 0 击杀 → 对应维 0 分，不 NaN 不 panic。
    #[test]
    fn zero_guardrails_never_produce_nan() {
        let inputs = vec![
            input(100, true, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
            input(100, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        ];
        let scores = score_participants(&inputs);
        for s in &scores {
            assert!(s.total.is_finite(), "分数不能是 NaN/Inf");
            assert!(s.total >= 0.0);
        }
    }

    /// 参团：kp 0.3→0 分、1.0→2 分。
    #[test]
    fn participation_dimension() {
        // 队 5 人，队总击杀 100：每人 k+a=20 → kp=0.2 → 0 分
        let mut inputs: Vec<PlayerScoreInput> = (0..4)
            .map(|_| input(100, true, 20, 1, 0, 1000, 100, 100, 10, 10, 10, 1800))
            .collect();
        inputs.push(input(100, true, 20, 1, 0, 1000, 100, 100, 10, 10, 10, 1800));
        let scores = score_participants(&inputs);
        assert!((scores[0].breakdown.participation - 0.0).abs() < 1e-9);

        // A 独吞队内全部击杀：kp=1 → 满分 2
        let mut inputs: Vec<PlayerScoreInput> = (0..4)
            .map(|_| input(100, true, 0, 1, 0, 1000, 100, 100, 10, 10, 10, 1800))
            .collect();
        inputs.push(input(
            100, true, 90, 1, 10, 1000, 100, 100, 10, 10, 10, 1800,
        ));
        let scores = score_participants(&inputs);
        let last = scores.last().unwrap();
        assert!((last.breakdown.participation - 2.0).abs() < 1e-9);
    }

    /// 补刀维：cs/min 5→0 分，10→2 分。
    #[test]
    fn cs_per_minute_dimension() {
        let low = input(100, true, 3, 1, 2, 1000, 100, 100, 10, 150, 10, 1800);
        let high = input(100, true, 3, 1, 2, 1000, 100, 100, 10, 300, 10, 1800);
        let scores = score_participants(&[low, high]);
        assert!((scores[0].breakdown.cs - 0.0).abs() < 1e-9); // 5/min → 0
        assert!((scores[1].breakdown.cs - 2.0).abs() < 1e-9); // 10/min → 2
    }

    /// LCU participant → 输入映射：cs 含野怪、名称与 puuid 透传（身份按索引对应）。
    #[test]
    fn lcu_participant_mapping_includes_neutral_cs() {
        let stats = crate::lcu::api::model::Stats {
            kills: 5,
            deaths: 2,
            assists: 8,
            total_minions_killed: 160,
            neutral_minions_killed: 40,
            win: true,
            ..Default::default()
        };
        let p = Participant {
            participant_id: 3,
            champion_id: 103,
            team_id: 100,
            stats,
            ..Default::default()
        };
        let mut identity = ParticipantIdentity::default();
        identity.player.puuid = "PUUID-1".to_string();
        identity.player.summoner_name = "测试玩家".to_string();
        let input = input_from_lcu_participant(&p, Some(&identity), 1800);
        assert_eq!(input.cs, 200);
        assert_eq!(input.summoner_name, "测试玩家");
        assert_eq!(input.puuid, "PUUID-1");
        assert_eq!(input.participant_id, 3);
        assert!(input.win);
    }
}
