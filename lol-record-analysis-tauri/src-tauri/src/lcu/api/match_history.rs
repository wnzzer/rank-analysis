//! # LCU 对局记录 API
//!
//! 对应 `lol-match-history`：按 PUUID/「me」分页获取对局列表；支持详情增强与中文信息。

use std::collections::HashMap;
use std::{sync::LazyLock, time::Duration};

use crate::{
    constant,
    lcu::api::model::{Participant, ParticipantIdentity, Stats},
};
use moka::future::Cache;
use serde::{Deserialize, Serialize};

use crate::lcu::{api::game_detail::GameDetail, util::http::lcu_get};

/// 解析队列中文名：先查 `QUEUE_ID_TO_CN`，未命中时按 `gameMode` 兜底。
///
/// 斗魂竞技场（CHERRY）历经多个 queueId 变种（1700/1710/1810/1820 ...），
/// 与其逐个枚举追新，不如以 LCU 给的 `gameMode == "CHERRY"` 作为权威兜底。
pub(crate) fn resolve_queue_name_cn(queue_id: i32, game_mode: &str) -> String {
    if let Some(s) = constant::game::get_queue_id_to_cn(queue_id as u32) {
        return s.to_string();
    }
    // queueId 未收录时按 gameMode 兜底——新变种层出不穷，宁可给个模式级名字
    // 也不要在卡片上顶着刺眼的"未知"。
    match game_mode {
        "CHERRY" => "斗魂竞技场".to_string(),
        "ARAM" => "极地大乱斗".to_string(),
        "URF" => "无限火力".to_string(),
        "NEXUSBLITZ" => "极限闪击".to_string(),
        "PRACTICETOOL" => "训练模式".to_string(),
        "TUTORIAL" => "新手教程".to_string(),
        "CLASSIC" => "召唤师峡谷".to_string(),
        _ => "未知".to_string(),
    }
}

/// WeGame 式综合评分（0~10）：KDA、输出、参团率、承伤、经济、补刀、推塔 七维加权。
///
/// 各维归一到 0..1（KDA 用饱和函数 `kda/(kda+3)`，其余除以全场最大值），加权和乘 10。
/// 权重：KDA 26% / 输出 22% / 参团 18% / 承伤 10% / 经济 10% / 补刀 8% / 推塔 6%。
///
/// ⚠️ 与前端 `useMatchDetailPlayers.ts::computeMatchScore` 同式——两端必须同步修改。
pub(crate) fn wegame_score(
    stats: &Stats,
    team_kills: i32,
    (max_damage, max_taken, max_gold, max_cs, max_turret): (i32, i32, i32, i32, i32),
) -> f64 {
    let kda = (stats.kills as f64 + stats.assists as f64) / f64::from(stats.deaths.max(1));
    let n_kda = kda / (kda + 3.0);
    let kp = if team_kills > 0 {
        (f64::from(stats.kills + stats.assists) / f64::from(team_kills)).min(1.0)
    } else {
        0.0
    };
    let norm = |v: i32, m: i32| {
        if m > 0 {
            f64::from(v) / f64::from(m)
        } else {
            0.0
        }
    };
    10.0 * (0.26 * n_kda
        + 0.22 * norm(stats.total_damage_dealt_to_champions, max_damage)
        + 0.18 * kp
        + 0.10 * norm(stats.total_damage_taken, max_taken)
        + 0.10 * norm(stats.gold_earned, max_gold)
        + 0.08
            * norm(
                stats.total_minions_killed + stats.neutral_minions_killed,
                max_cs,
            )
        + 0.06 * norm(stats.damage_dealt_to_turrets, max_turret))
}

/// 对局记录响应：平台 ID、索引范围、对局列表。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct MatchHistory {
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "begIndex", default)] // 手动添加的字段，便于后续筛序
    pub beg_index: i32,
    #[serde(rename = "endIndex", default)] // 手动添加的字段，便于后续筛序
    pub end_index: i32,
    pub games: GamesWrapper,
}

/// 对局列表包装（LCU 返回格式）。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct GamesWrapper {
    pub games: Vec<Game>,
}

/// 单场对局摘要：ID、时间、时长、模式、队列、参与者等；可附带 game_detail 与中文名。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Game {
    #[serde(rename = "mvp", default)] // 计算出的是否是本局的MVp
    pub mvp: String,
    #[serde(rename = "queueName", default)]
    pub queue_name: String, // 中文名，对queueId的中文翻译

    #[serde(rename = "gameDetail", default)]
    pub game_detail: GameDetail,
    #[serde(rename = "gameId")]
    pub game_id: i64,
    #[serde(rename = "gameCreationDate")]
    pub game_creation_date: String,
    #[serde(rename = "gameDuration")]
    pub game_duration: i32,
    #[serde(rename = "gameMode")]
    pub game_mode: String,
    #[serde(rename = "gameType")]
    pub game_type: String,
    #[serde(rename = "mapId")]
    pub map_id: i32,
    #[serde(rename = "queueId")]
    pub queue_id: i32,

    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "participantIdentities")]
    pub participant_identities: Vec<ParticipantIdentity>,
    pub participants: Vec<Participant>,
}
static MATCH_HISTORY_CACHE: LazyLock<Cache<String, MatchHistory>> = LazyLock::new(|| {
    Cache::builder()
        .time_to_live(Duration::from_secs(60))
        .max_capacity(50)
        .build()
});

/// LCU 整包缓存窗口上限（0..=49 共 50 场）。
///
/// 冷 puuid 的首个请求必须覆盖到此索引（见 [`MatchHistory::get_by_puuid`]），
/// 且这也是 LCU 能可靠提供的历史深度上限——首拉 50 场后区间参数即被忽略。
const MAX_CACHE_END: i32 = 49;

impl MatchHistory {
    /// 内部：按 PUUID 与索引范围请求 LCU 对局列表。
    ///
    /// ⚠️ LCU 按 puuid 整包缓存该端点结果：冷 puuid 的**首个请求区间决定它缓存
    /// 几场**，之后 begIndex/endIndex 被忽略、永远整包返回缓存内容（真机实测）。
    /// 因此对可能未被 LCU 缓存过的 puuid，首个请求必须是 0..=[`MAX_CACHE_END`]
    /// 全量——保持本函数私有，外部一律走 [`Self::get_match_history_by_puuid`]。
    async fn get_by_puuid(puuid: &str, begin_index: i32, end_index: i32) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/{}/matches?begIndex={}&endIndex={}",
            puuid, begin_index, end_index
        );
        log::info!("build url {}", uri);

        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }

    /// 按 PUUID 与索引范围获取对局记录。
    ///
    /// 无论调用方要哪一页，实际打 LCU 的永远是 0..=[`MAX_CACHE_END`] 整包
    /// （Moka 缓存 60s），再本地切片出请求页；超出窗口的区间被 clamp，
    /// 起始越界得到空页让前端翻页自然终止。
    pub async fn get_match_history_by_puuid(
        puuid: &str,
        beg_index: i32,
        end_index: i32,
    ) -> Result<MatchHistory, String> {
        log::info!(
            "Fetching match history for PUUID: {}, Begin Index: {}, End Index: {}",
            puuid,
            beg_index,
            end_index
        );

        if beg_index < 0 || end_index < 0 {
            return Err("索引不能为负数".to_string());
        }
        if beg_index > end_index {
            return Err("开始索引不能大于结束索引".to_string());
        }

        // ⚠️ 这里绝不按调用方区间直连 LCU：冷 puuid 会被小区间/深分页请求把
        // LCU 缓存钉死在错误大小，warm puuid 则无视区间整包返回（真机实测，
        // 见 get_by_puuid 注释）。此前 end_index > 49 时直接透传，曾导致战绩页
        // 深翻页（50-59）拿回整包 0-49 重复数据。窗口外的历史 LCU 无法可靠
        // 提供，一律 clamp 进 0..=MAX_CACHE_END，深翻页切出空页终止。
        let end_in_window = end_index.min(MAX_CACHE_END);

        let history = MATCH_HISTORY_CACHE
            .try_get_with(puuid.to_string(), async {
                MatchHistory::get_by_puuid(puuid, 0, MAX_CACHE_END).await
            })
            .await
            .map_err(|e| e.to_string())?;

        Ok(Self::slice_page(
            history,
            beg_index as usize,
            end_in_window as usize,
        ))
    }

    /// 从整包缓存切出请求页 `[beg_index, end_index]`（闭区间），越界自动截断。
    ///
    /// 缓存的 0..=[`MAX_CACHE_END`] 包在玩家总场次不足 50 时已是其全部历史，
    /// 此时重拉 LCU 只会拿回整包（warm puuid 的区间参数被忽略，见
    /// [`Self::get_by_puuid`]），曾导致翻页内容整包重复——一律本地切片。
    /// 起始索引越界时返回空页而非报错，让前端翻页自然终止。
    fn slice_page(history: MatchHistory, beg_index: usize, end_index: usize) -> MatchHistory {
        let total = history.games.games.len();
        let end = std::cmp::min(end_index + 1, total);
        let beg = std::cmp::min(beg_index, end);
        MatchHistory {
            games: GamesWrapper {
                games: history.games.games[beg..end].to_vec(),
            },
            ..history
        }
    }

    /// 为每条对局拉取详情（game_detail）并写入。
    pub async fn enrich_game_detail(&mut self) -> Result<(), String> {
        if self.games.games.is_empty() {
            return Ok(());
        }

        let futures = self.games.games.iter_mut().map(|game| async move {
            match GameDetail::get_game_detail_by_id(&game.game_id).await {
                Ok(detail) => {
                    game.game_detail = detail;
                }
                Err(e) => {
                    log::warn!("Failed to get game detail for {}: {}", game.game_id, e);
                }
            }
        });

        futures::future::join_all(futures).await;

        Ok(())
    }

    /// 为每条对局填充队列中文名（queue_name）。
    pub fn enrich_info_cn(&mut self) -> Result<(), String> {
        if self.games.games.is_empty() {
            return Ok(());
        }
        for game in &mut self.games.games {
            game.queue_name = resolve_queue_name_cn(game.queue_id, &game.game_mode);
        }

        Ok(())
    }

    /// Calculate contribution rates (gold, damage dealt to champions, damage taken, heal) for the first participant (assumed "me") in each game.
    /// Mirrors the provided Go logic `calculateRate`.
    pub fn calculate(&mut self) -> Result<(), String> {
        if self.games.games.is_empty() {
            return Ok(());
        }
        for game in &mut self.games.games {
            // Need participants to proceed
            if game.participants.is_empty() || game.game_detail.participants.is_empty() {
                continue;
            }

            let team_id = game.participants[0].team_id;
            // CHERRY/斗魂的 teamId 是 9 人大组(100/200)，每个大组实际包含 3 个 subteam。
            // 占比必须按 stats.playerSubteamId(1~8)分 2~3 人小队累加，否则分母被放大 3 倍。
            let is_cherry = game.game_mode == "CHERRY";
            let my_subteam = game.participants[0].stats.player_subteam_id;

            // Use i64 for intermediate sums to avoid potential overflow (though unlikely with typical values)
            let mut total_gold_earned: i64 = 0;
            let mut total_damage_dealt_to_champions: i64 = 0;
            let mut total_damage_taken: i64 = 0;
            let mut total_heal: i64 = 0;

            for p in &game.game_detail.participants {
                let same_team = if is_cherry && my_subteam > 0 {
                    p.stats.player_subteam_id == my_subteam
                } else {
                    p.team_id == team_id
                };
                if same_team {
                    total_gold_earned += p.stats.gold_earned as i64;
                    total_damage_dealt_to_champions +=
                        p.stats.total_damage_dealt_to_champions as i64;
                    total_damage_taken += p.stats.total_damage_taken as i64;
                    total_heal += p.stats.total_heal as i64;
                }
            }

            // Avoid division by zero; if any total is zero set to 1 (same as Go code initializing with 1) so rate becomes 0 or 100 appropriately.
            if total_gold_earned == 0 {
                total_gold_earned = 1;
            }
            if total_damage_dealt_to_champions == 0 {
                total_damage_dealt_to_champions = 1;
            }
            if total_damage_taken == 0 {
                total_damage_taken = 1;
            }
            if total_heal == 0 {
                total_heal = 1;
            }

            let my_stats = &mut game.participants[0].stats;
            let my_gold = my_stats.gold_earned as f64;
            let my_damage_dealt = my_stats.total_damage_dealt_to_champions as f64;
            let my_damage_taken = my_stats.total_damage_taken as f64;
            let my_heal = my_stats.total_heal as f64;

            my_stats.gold_earned_rate = ((my_gold / total_gold_earned as f64) * 100.0) as i32;
            my_stats.damage_dealt_to_champions_rate =
                ((my_damage_dealt / total_damage_dealt_to_champions as f64) * 100.0) as i32;
            my_stats.damage_taken_rate =
                ((my_damage_taken / total_damage_taken as f64) * 100.0) as i32;
            my_stats.heal_rate = ((my_heal / total_heal as f64) * 100.0) as i32;

            // MVP/SVP：WeGame 式综合评分——胜方最高分 MVP、败方最高分 SVP（此前为纯 KDA）。
            // 评分函数 wegame_score 与前端 useMatchDetailPlayers.ts 同式，两端需同步修改。
            let detail = &game.game_detail.participants;

            // 参团率分母：所属队伍总击杀（CHERRY 按 subteam 分组）；同时收集全场各维最大值
            let mut group_kills: HashMap<i32, i32> = HashMap::new();
            let mut max_v = (0i32, 0i32, 0i32, 0i32, 0i32); // damage/taken/gold/cs/turret
            for p in detail {
                let key = if is_cherry && p.stats.player_subteam_id > 0 {
                    p.stats.player_subteam_id
                } else {
                    p.team_id
                };
                *group_kills.entry(key).or_insert(0) += p.stats.kills;
                max_v.0 = max_v.0.max(p.stats.total_damage_dealt_to_champions);
                max_v.1 = max_v.1.max(p.stats.total_damage_taken);
                max_v.2 = max_v.2.max(p.stats.gold_earned);
                max_v.3 = max_v
                    .3
                    .max(p.stats.total_minions_killed + p.stats.neutral_minions_killed);
                max_v.4 = max_v.4.max(p.stats.damage_dealt_to_turrets);
            }
            let score_of = |p: &Participant| {
                let key = if is_cherry && p.stats.player_subteam_id > 0 {
                    p.stats.player_subteam_id
                } else {
                    p.team_id
                };
                wegame_score(&p.stats, *group_kills.get(&key).unwrap_or(&0), max_v)
            };

            let my_participant_id = game.participants[0].participant_id;
            if let Some(me) = detail
                .iter()
                .find(|p| p.participant_id == my_participant_id)
            {
                let my_score = score_of(me);
                // 与我同胜负侧的最高分（并列时我也算最高，与旧逻辑"平分我胜出"一致）
                let best = detail
                    .iter()
                    .filter(|p| p.stats.win == me.stats.win)
                    .map(&score_of)
                    .fold(f64::MIN, f64::max);
                if my_score >= best - 1e-9 {
                    game.mvp = if me.stats.win {
                        "MVP".to_string()
                    } else {
                        "SVP".to_string()
                    };
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod mvp_score_tests {
    use super::*;

    /// 测试造数：kda=(击杀,死亡,助攻)，econ=(输出,承伤,金币,补刀,推塔)
    fn stats(kda: (i32, i32, i32), econ: (i32, i32, i32, i32, i32), win: bool) -> Stats {
        Stats {
            kills: kda.0,
            deaths: kda.1,
            assists: kda.2,
            total_damage_dealt_to_champions: econ.0,
            total_damage_taken: econ.1,
            gold_earned: econ.2,
            total_minions_killed: econ.3,
            damage_dealt_to_turrets: econ.4,
            win,
            ..Default::default()
        }
    }

    fn part(id: i32, team: i32, s: Stats) -> Participant {
        Participant {
            participant_id: id,
            team_id: team,
            champion_id: 1,
            spell1_id: 0,
            spell2_id: 0,
            stats: s,
        }
    }

    /// 场景：无死亡低伤"蹭分型"(10/0/8, KDA 18) vs 真核 carry(9/2/15, 全场最高
    /// 输出/承伤/经济/补刀/推塔)。旧的纯 KDA 公式会选前者——新综合评分应选 carry。
    fn farmer() -> Participant {
        part(
            1,
            100,
            stats((10, 0, 8), (8_000, 5_000, 9_000, 100, 0), true),
        )
    }
    fn carry() -> Participant {
        part(
            2,
            100,
            stats((9, 2, 15), (40_000, 30_000, 15_000, 200, 5_000), true),
        )
    }
    fn loser() -> Participant {
        part(
            6,
            200,
            stats((3, 8, 4), (12_000, 20_000, 8_000, 120, 500), false),
        )
    }

    fn game_with_me(me: Participant) -> MatchHistory {
        let mut game = Game {
            game_mode: "CLASSIC".to_string(),
            participants: vec![me],
            ..Default::default()
        };
        game.game_detail.participants = vec![farmer(), carry(), loser()];
        MatchHistory {
            games: GamesWrapper { games: vec![game] },
            ..Default::default()
        }
    }

    #[test]
    fn composite_score_prefers_carry_over_no_death_farmer() {
        let team_kills = 10 + 9;
        let max_v = (40_000, 30_000, 15_000, 200, 5_000);
        let s_farmer = wegame_score(&farmer().stats, team_kills, max_v);
        let s_carry = wegame_score(&carry().stats, team_kills, max_v);
        assert!(
            s_carry > s_farmer,
            "carry {s_carry:.2} 应高于蹭分型 {s_farmer:.2}"
        );
    }

    #[test]
    fn calculate_marks_composite_best_as_mvp() {
        let mut mh = game_with_me(carry());
        mh.calculate().unwrap();
        assert_eq!(
            mh.games.games[0].mvp, "MVP",
            "综合评分最高的 carry 应为 MVP"
        );
    }

    #[test]
    fn calculate_denies_mvp_to_kda_farmer() {
        let mut mh = game_with_me(farmer());
        mh.calculate().unwrap();
        // 旧纯 KDA 公式下 farmer(KDA 18)会拿 MVP；新公式下它不是综合最高分
        assert_eq!(mh.games.games[0].mvp, "", "纯蹭 KDA 不应再拿 MVP");
    }

    #[test]
    fn calculate_marks_loser_best_as_svp() {
        let mut mh = game_with_me(loser());
        mh.calculate().unwrap();
        assert_eq!(
            mh.games.games[0].mvp, "SVP",
            "败方唯一玩家即败方最高分，应为 SVP"
        );
    }
}

#[cfg(test)]
mod slice_page_tests {
    use super::*;

    /// 造一个含 n 场对局的整包缓存，game_id 依次为 0..n。
    fn history_of(n: i64) -> MatchHistory {
        MatchHistory {
            platform_id: "TJ100".to_string(),
            games: GamesWrapper {
                games: (0..n)
                    .map(|id| Game {
                        game_id: id,
                        ..Default::default()
                    })
                    .collect(),
            },
            ..Default::default()
        }
    }

    fn ids(mh: &MatchHistory) -> Vec<i64> {
        mh.games.games.iter().map(|g| g.game_id).collect()
    }

    #[test]
    fn slices_requested_page_within_range() {
        let page = MatchHistory::slice_page(history_of(15), 0, 9);
        assert_eq!(ids(&page), (0..10).collect::<Vec<_>>());
    }

    /// Bug 场景：15 场玩家翻第 2 页（10..19）——应返回尾部 5 场，
    /// 而不是重拉 LCU 拿回整包 15 场导致翻页内容重复。
    #[test]
    fn clamps_tail_page_past_total() {
        let page = MatchHistory::slice_page(history_of(15), 10, 19);
        assert_eq!(ids(&page), (10..15).collect::<Vec<_>>());
    }

    /// 恰好 10 场的玩家翻第 2 页：起始索引已越界，应返回空页
    /// （前端 noMoreMatches 依赖 games.length < 10 终止翻页），而非报错。
    #[test]
    fn returns_empty_page_when_beg_past_total() {
        let page = MatchHistory::slice_page(history_of(10), 10, 19);
        assert!(ids(&page).is_empty());
    }

    /// 深翻页（第 6 页 50..59 会被 clamp 成 50..49）超出 LCU 可靠窗口：
    /// 应得空页终止翻页，而非旧行为直连 LCU 拿回整包重复数据。
    #[test]
    fn returns_empty_page_beyond_cache_window() {
        let page = MatchHistory::slice_page(history_of(50), 50, 49);
        assert!(ids(&page).is_empty());
    }

    /// 零场次新号请求 0..49：应返回空页而非报错（rank 页等调用方 beg 恒为 0）。
    #[test]
    fn returns_empty_for_zero_game_account() {
        let page = MatchHistory::slice_page(history_of(0), 0, 49);
        assert!(ids(&page).is_empty());
    }

    /// 整包顶层字段（platform_id 等）应随切片保留。
    #[test]
    fn keeps_top_level_fields() {
        let page = MatchHistory::slice_page(history_of(15), 10, 19);
        assert_eq!(page.platform_id, "TJ100");
    }
}

#[cfg(test)]
mod queue_name_tests {
    use super::resolve_queue_name_cn;

    #[test]
    fn known_queue_id_resolves_directly() {
        assert_eq!(resolve_queue_name_cn(420, "CLASSIC"), "单双排");
        assert_eq!(resolve_queue_name_cn(1700, "CHERRY"), "斗魂竞技场");
    }

    #[test]
    fn unknown_cherry_variant_falls_back_to_arena_name() {
        // 1710 / 1810 / 1820 等新斗魂变种没收录进 QUEUE_ID_TO_CN，
        // 但 LCU 仍把 gameMode 标成 CHERRY —— 应当兜底成"斗魂竞技场"而非"未知"。
        assert_eq!(resolve_queue_name_cn(1710, "CHERRY"), "斗魂竞技场");
        assert_eq!(resolve_queue_name_cn(1810, "CHERRY"), "斗魂竞技场");
        assert_eq!(resolve_queue_name_cn(9999, "CHERRY"), "斗魂竞技场");
    }

    #[test]
    fn unknown_queue_falls_back_to_game_mode_name() {
        // 未收录 queueId 按 gameMode 给模式级名字，不再顶着"未知"
        assert_eq!(resolve_queue_name_cn(99999, "CLASSIC"), "召唤师峡谷");
        assert_eq!(resolve_queue_name_cn(99999, "ARAM"), "极地大乱斗");
        assert_eq!(resolve_queue_name_cn(99999, "URF"), "无限火力");
        // gameMode 也未知时才落到"未知"
        assert_eq!(resolve_queue_name_cn(99999, ""), "未知");
        assert_eq!(resolve_queue_name_cn(99999, "SOMETHING_NEW"), "未知");
    }

    #[test]
    fn newly_mapped_queue_ids_resolve() {
        assert_eq!(resolve_queue_name_cn(480, "CLASSIC"), "快速匹配");
        assert_eq!(resolve_queue_name_cn(870, "CLASSIC"), "人机(入门)");
        // 真机实测：训练模式 queueId=3140 / gameMode=PRACTICETOOL（此前显示"未知"）
        assert_eq!(resolve_queue_name_cn(3140, "PRACTICETOOL"), "训练模式");
        assert_eq!(resolve_queue_name_cn(99999, "PRACTICETOOL"), "训练模式");
    }
}
