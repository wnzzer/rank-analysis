//! # UserTag 命令模块
//!
//! 用户标签与近期数据：基于对局记录计算 KDA、胜率、好友/纠纷率等，生成标签与「遇到过的人」等。
//!
//! ## 主要功能
//!
//! - **标签生成**: 根据配置规则生成用户标签（连胜、连败、娱乐玩家等）
//! - **近期数据**: 计算 KDA、胜率、经济、伤害等统计数据
//! - **好友/纠纷检测**: 分析历史对局找出经常同队或对战的人
//! - **同场玩家**: 记录近期同场的所有玩家信息
//!
//! ## 数据结构
//!
//! ```text
//! UserTag
//!     ├── recent_data: RecentData
//!     │       ├── kda, kills, deaths, assists
//!     │       ├── select_wins, select_losses
//!     │       ├── group_rate, gold_rate, damage_rate
//!     │       ├── friend_and_dispute: FriendAndDispute
//!     │       └── one_game_players_map
//!     └── tag: Vec<RankTag>
//! ```
//!
//! ## 标签配置系统
//!
//! 标签不再硬编码，而是通过 `user_tag_config` 模块动态配置。
//! 配置支持复杂的条件树（AND/OR/NOT）和历史数据筛选。
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 获取用户标签
//! let user_tag = get_user_tag_by_puuid(&puuid, 420, None).await?; // 420 = 单双排，当前英雄未知传 None
//!
//! // 访问数据
//! println!("KDA: {}", user_tag.recent_data.kda);
//! println!("标签: {:?}", user_tag.tag);
//! ```

use crate::command::user_tag_config;
use crate::constant::game::QUEUE_ID_TO_CN;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 单场对局中的一名玩家摘要（用于「遇到过的人」等展示）。
///
/// # 字段说明
///
/// - `index`: 在战绩列表中的索引
/// - `game_id`: 对局 ID
/// - `puuid`: 玩家 PUUID
/// - `game_created_at`: 对局创建时间
/// - `is_my_team`: 是否与我同队
/// - `game_name`: 游戏名称
/// - `tag_line`: 标签线（#后面的数字）
/// - `champion_id`: 英雄 ID
/// - `champion_key`: 英雄键名
/// - `kills`, `deaths`, `assists`: KDA 数据
/// - `win`: 是否胜利
/// - `queue_id_cn`: 队列模式中文名
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneGamePlayer {
    /// 在战绩列表中的索引
    pub index: i32,
    /// 对局 ID
    pub game_id: i64,
    /// 玩家 PUUID
    pub puuid: String,
    /// 对局创建时间
    pub game_created_at: String,
    /// 是否与我同队
    pub is_my_team: bool,
    /// 游戏名称
    pub game_name: String,
    /// 标签线
    pub tag_line: String,
    /// 英雄 ID
    pub champion_id: i32,
    /// 英雄键名
    pub champion_key: String,
    /// 击杀数
    pub kills: i32,
    /// 死亡数
    pub deaths: i32,
    /// 助攻数
    pub assists: i32,
    /// 是否胜利
    pub win: bool,
    /// 队列模式中文名
    pub queue_id_cn: String,
}

/// 单个玩家的汇总信息（用于好友/纠纷列表）。
///
/// # 字段说明
///
/// - `win_rate`: 与该玩家的胜率
/// - `wins`: 胜利场次
/// - `losses`: 失败场次
/// - `summoner`: 召唤师信息
/// - `one_game_player`: 详细对局记录
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneGamePlayerSummoner {
    /// 与该玩家的胜率
    pub win_rate: i32,
    /// 胜利场次
    pub wins: i32,
    /// 失败场次
    pub losses: i32,
    /// 召唤师信息
    #[serde(rename = "Summoner")]
    pub summoner: Summoner,
    /// 详细对局记录
    #[serde(rename = "OneGamePlayer")]
    pub one_game_player: Vec<OneGamePlayer>,
}

/// 用户标签。
///
/// # 字段说明
///
/// - `good`: 是否为正面标签
/// - `tag_name`: 标签名称
/// - `tag_desc`: 标签描述
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RankTag {
    /// 是否为正面标签
    pub good: bool,
    /// 标签名称
    pub tag_name: String,
    /// 标签描述
    pub tag_desc: String,
}

/// 好友与纠纷统计。
///
/// # 字段说明
///
/// - `friends_rate`: 与好友组队的胜率
/// - `dispute_rate`: 与"冤家"对战的胜率
/// - `friends_summoner`: 好友列表
/// - `dispute_summoner`: "冤家"列表
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendAndDispute {
    /// 与好友组队的胜率
    pub friends_rate: i32,
    /// 与"冤家"对战的胜率
    pub dispute_rate: i32,
    /// 好友列表
    pub friends_summoner: Vec<OneGamePlayerSummoner>,
    /// "冤家"列表
    pub dispute_summoner: Vec<OneGamePlayerSummoner>,
}

/// 近期数据统计。
///
/// 基于最近对局计算的各种统计数据。
///
/// # 字段说明
///
/// - `kda`, `kills`, `deaths`, `assists`: KDA 相关数据
/// - `select_mode`: 筛选的队列模式
/// - `select_mode_cn`: 队列模式中文名
/// - `select_wins`, `select_losses`: 胜负场次
/// - `group_rate`: 参团率
/// - `average_gold`, `gold_rate`: 平均经济和金币占比
/// - `average_damage_dealt_to_champions`, `damage_dealt_to_champions_rate`: 平均伤害和伤害占比
/// - `friend_and_dispute`: 好友/纠纷统计
/// - `one_game_players_map`: 同场玩家映射（用于预组队检测）
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentData {
    /// KDA 值
    pub kda: f64,
    /// 平均击杀
    pub kills: f64,
    /// 平均死亡
    pub deaths: f64,
    /// 平均助攻
    pub assists: f64,
    /// 筛选的队列模式
    pub select_mode: i32,
    /// 队列模式中文名
    pub select_mode_cn: String,
    /// 胜利场次
    pub select_wins: i32,
    /// 失败场次
    pub select_losses: i32,
    /// 参团率
    pub group_rate: i32,
    /// 平均经济
    pub average_gold: i32,
    /// 金币占比
    pub gold_rate: i32,
    /// 平均对英雄伤害
    pub average_damage_dealt_to_champions: i32,
    /// 伤害占比
    pub damage_dealt_to_champions_rate: i32,
    /// 好友/纠纷统计
    pub friend_and_dispute: FriendAndDispute,
    /// 同场玩家映射
    pub one_game_players_map: Option<HashMap<String, Vec<OneGamePlayer>>>,
}

/// 用户标签完整数据结构。
///
/// # 字段说明
///
/// - `recent_data`: 近期统计数据
/// - `tag`: 标签列表
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserTag {
    /// 近期统计数据
    pub recent_data: RecentData,
    /// 标签列表
    pub tag: Vec<RankTag>,
}

/// 根据召唤师名称获取用户标签。
///
/// # 参数
///
/// - `name`: 召唤师名称
/// - `mode`: 队列模式 ID（用于筛选统计范围）
///
/// # 返回值
///
/// - `Ok(UserTag)`: 用户标签数据
/// - `Err(String)`: 查询失败时的错误信息
#[tauri::command]
pub async fn get_user_tag_by_name(name: &str, mode: i32) -> Result<UserTag, String> {
    let summoner = Summoner::get_summoner_by_name(name).await?;
    // 按名称查询没有选人上下文，当前英雄未知，传 None
    get_user_tag_by_puuid(&summoner.puuid, mode, None).await
}

/// 根据 PUUID 获取用户标签（核心函数）。
///
/// # 参数
///
/// - `puuid`: 召唤师 PUUID
/// - `mode`: 队列模式 ID（0 表示所有模式）
/// - `champion_id`: 当前选用的英雄 ID（选人/对局会话中已知时传入，用于 `CurrentChampion` 条件；未知传 `None`）
///
/// # 返回值
///
/// - `Ok(UserTag)`: 用户标签数据
/// - `Err(String)`: 查询失败时的错误信息
///
/// # 处理流程
///
/// 1. 获取最近 20 场对局记录
/// 2. 补充对局详情
/// 3. 根据配置生成标签
/// 4. 提取同场玩家信息
/// 5. 计算 KDA、胜率等统计数据
/// 6. 计算好友/纠纷统计
#[tauri::command]
pub async fn get_user_tag_by_puuid(
    puuid: &str,
    mode: i32,
    champion_id: Option<i32>,
) -> Result<UserTag, String> {
    log::info!("get_user_tag_by_puuid: {}, mode: {}", puuid, mode);
    let mut match_history = MatchHistory::get_match_history_by_puuid(puuid, 0, 19).await?;
    match_history.enrich_game_detail().await?;
    match_history.calculate()?; // damageShare 依赖预计算的伤害占比

    let mut tags = Vec::new();

    // Update: Use dynamic tag configuration
    let configs = user_tag_config::load_config().await;
    for config in configs {
        if let Some(tag) = config.evaluate(&match_history, mode, champion_id) {
            tags.push(tag);
        }
    }

    // The following old hardcoded tag logic is replaced by the config system above.
    // Keeping this comment for reference.
    /*
    // 判断是否是连胜
    let streak_tag = is_streak_tag(&match_history);
    if !streak_tag.tag_name.is_empty() {
        tags.push(streak_tag);
    }

    // 判断是否连败
    let losing_tag = is_losing_tag(&match_history);
    if !losing_tag.tag_name.is_empty() {
        tags.push(losing_tag);
    }

    // 判断是否是娱乐玩家
    let casual_tag = is_casual_tag(&match_history);
    if !casual_tag.tag_name.is_empty() {
        tags.push(casual_tag);
    }

    // 判断是否是特殊玩家
    let special_player_tags = is_special_player_tag(&match_history);
    tags.extend(special_player_tags);
    */

    // 获取该玩家局内的所有玩家
    let one_game_player_map = get_one_game_players(&match_history);

    // 计算 kda,胜率,参团率,伤害转换率
    let (kills, deaths, assists) = count_kda(&match_history, mode);
    let kda = if deaths > 0.0 {
        (kills + assists) / deaths
    } else {
        kills + assists
    };
    let kda = (kda * 10.0).trunc() / 10.0;
    let kills = (kills * 10.0).trunc() / 10.0;
    let deaths = (deaths * 10.0).trunc() / 10.0;
    let assists = (assists * 10.0).trunc() / 10.0;

    let (select_wins, select_losses) = count_win_and_loss(&match_history, mode);
    let (
        group_rate,
        average_gold,
        gold_rate,
        average_damage_dealt_to_champions,
        damage_dealt_to_champions_rate,
    ) = count_gold_and_group_and_damage_dealt_to_champions(&match_history, mode);

    let select_mode_cn = QUEUE_ID_TO_CN
        .get(&(mode as u32))
        .unwrap_or(&"未知模式")
        .to_string();

    let mut user_tag = UserTag {
        recent_data: RecentData {
            kda,
            kills,
            deaths,
            assists,
            select_mode: mode,
            select_mode_cn,
            select_wins,
            select_losses,
            group_rate,
            average_gold,
            gold_rate,
            average_damage_dealt_to_champions,
            damage_dealt_to_champions_rate,
            friend_and_dispute: FriendAndDispute::default(),
            one_game_players_map: Some(one_game_player_map.clone()),
        },
        tag: tags,
    };

    // 计算朋友组队胜率和冤家组队胜率
    count_friend_and_dispute(&one_game_player_map, &mut user_tag.recent_data, puuid).await;

    Ok(user_tag)
}

/// 从战绩中提取同场玩家信息。
///
/// 遍历所有对局，收集每个同场玩家的信息。
///
/// # 参数
///
/// - `match_history`: 对局记录
///
/// # 返回值
///
/// PUUID 到对局记录列表的映射
fn get_one_game_players(match_history: &MatchHistory) -> HashMap<String, Vec<OneGamePlayer>> {
    let mut one_game_player_map = HashMap::new();

    for (index, game) in match_history.games.games.iter().enumerate() {
        let my_team_id = game.participants[0].team_id;

        for (i, participant_identity) in game.game_detail.participant_identities.iter().enumerate()
        {
            // 跳过机器人和没有puuid的玩家
            if participant_identity.player.puuid.is_empty() {
                continue;
            }

            let puuid = participant_identity.player.puuid.clone();

            if let Some(participant) = game.game_detail.participants.get(i) {
                let queue_id_cn = QUEUE_ID_TO_CN
                    .get(&(game.queue_id as u32))
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        if game.game_mode == "CHERRY" {
                            "斗魂竞技场".to_string()
                        } else {
                            "未知模式".to_string()
                        }
                    });

                let one_game_player = OneGamePlayer {
                    index: index as i32,
                    game_id: game.game_id,
                    puuid: puuid.clone(),
                    game_created_at: game.game_creation_date.clone(),
                    is_my_team: my_team_id == participant.team_id,
                    game_name: participant_identity.player.game_name.clone(),
                    tag_line: participant_identity.player.tag_line.clone(),
                    champion_id: participant.champion_id,
                    champion_key: format!("champion_{}", participant.champion_id),
                    kills: participant.stats.kills,
                    deaths: participant.stats.deaths,
                    assists: participant.stats.assists,
                    win: participant.stats.win,
                    queue_id_cn,
                };

                one_game_player_map
                    .entry(puuid)
                    .or_insert_with(Vec::new)
                    .push(one_game_player);
            }
        }
    }

    one_game_player_map
}

/// 计算好友和纠纷统计。
///
/// 分析同场玩家数据，找出经常同队（好友）或经常对战（冤家）的玩家。
///
/// # 参数
///
/// - `one_game_players_map`: 同场玩家映射
/// - `recent_data`: 输出数据结构
/// - `my_puuid`: 当前用户的 PUUID（用于排除自己）
///
/// # 判定逻辑
///
/// - 好友：同场次数 >= 3 且所有场次都是同队
/// - 冤家：同场次数 >= 3 且所有场次都是对战
async fn count_friend_and_dispute(
    one_game_players_map: &HashMap<String, Vec<OneGamePlayer>>,
    recent_data: &mut RecentData,
    my_puuid: &str,
) {
    let mut friends_arr = Vec::new();
    let mut dispute_arr = Vec::new();
    let friend_or_dispute_limit = 3;

    for (puuid, games) in one_game_players_map {
        if games.len() < friend_or_dispute_limit || puuid == my_puuid {
            continue;
        }

        let is_my_friend = games.iter().all(|game| game.is_my_team);

        if is_my_friend {
            friends_arr.push(games);
        } else {
            dispute_arr.push(games);
        }
    }

    // 计算朋友组队胜率
    let mut friends_summoner = Vec::new();
    let mut friends_wins = 0;
    let mut friends_loss = 0;

    for games in friends_arr {
        if let Ok(summoner) = Summoner::get_summoner_by_puuid(&games[0].puuid).await {
            let mut wins = 0;
            let mut losses = 0;

            for game in games {
                if game.win {
                    wins += 1;
                    friends_wins += 1;
                } else {
                    losses += 1;
                    friends_loss += 1;
                }
            }

            let win_rate = if wins + losses > 0 {
                (wins as f64 / (wins + losses) as f64 * 100.0) as i32
            } else {
                0
            };

            friends_summoner.push(OneGamePlayerSummoner {
                win_rate,
                wins,
                losses,
                summoner,
                one_game_player: games.clone(),
            });
        }
    }

    let friends_rate = if friends_wins + friends_loss > 0 {
        (friends_wins as f64 / (friends_wins + friends_loss) as f64 * 100.0) as i32
    } else {
        0
    };

    // 计算冤家组队胜率
    let mut dispute_summoner = Vec::new();
    let mut dispute_wins = 0;
    let mut dispute_loss = 0;

    for games in dispute_arr {
        if let Ok(summoner) = Summoner::get_summoner_by_puuid(&games[0].puuid).await {
            let mut wins = 0;
            let mut losses = 0;

            for game in games {
                if game.is_my_team {
                    continue; // 跳过是队友的对局
                }

                if game.win {
                    wins += 1;
                    dispute_wins += 1;
                } else {
                    losses += 1;
                    dispute_loss += 1;
                }
            }

            let win_rate = if wins + losses > 0 {
                (wins as f64 / (wins + losses) as f64 * 100.0) as i32
            } else {
                0
            };

            dispute_summoner.push(OneGamePlayerSummoner {
                win_rate,
                wins,
                losses,
                summoner,
                one_game_player: games.clone(),
            });
        }
    }

    let dispute_rate = if dispute_wins + dispute_loss > 0 {
        (dispute_wins as f64 / (dispute_wins + dispute_loss) as f64 * 100.0) as i32
    } else {
        0
    };

    recent_data.friend_and_dispute.friends_rate = friends_rate;
    recent_data.friend_and_dispute.dispute_rate = dispute_rate;

    // 只取前5个，前端无法展示太多
    recent_data.friend_and_dispute.friends_summoner =
        friends_summoner.into_iter().take(5).collect();
    recent_data.friend_and_dispute.dispute_summoner =
        dispute_summoner.into_iter().take(5).collect();
}

/// 计算经济、参团率和伤害数据。
///
/// # 参数
///
/// - `match_history`: 对局记录
/// - `mode`: 队列模式筛选（0 表示所有模式）
///
/// # 返回值
///
/// (参团率, 平均经济, 金币占比, 平均伤害, 伤害占比)
fn count_gold_and_group_and_damage_dealt_to_champions(
    match_history: &MatchHistory,
    mode: i32,
) -> (i32, i32, i32, i32, i32) {
    let mut count = 1;
    let mut my_gold = 0;
    let mut all_gold = 1;
    let mut my_ka = 0;
    let mut all_k = 1;
    let mut my_damage_dealt_to_champions = 0;
    let mut all_damage_dealt_to_champions = 1;

    for game in &match_history.games.games {
        // 模式筛选按中文名分组匹配（如「人机(入门)」对应新旧 830/870 两个队列 ID）
        if mode != 0
            && !crate::constant::game::queue_ids_same_group(game.queue_id as u32, mode as u32)
        {
            continue;
        }

        // CHERRY/斗魂的 teamId 是大组(100/200 各 9 人 = 3 小队),
        // 占比/参团率必须按 stats.playerSubteamId 算 2~3 人小队，而不是 9 人大组
        let is_cherry = game.game_mode == "CHERRY";
        for participant0 in &game.participants {
            my_gold += participant0.stats.gold_earned;
            my_ka += participant0.stats.kills + participant0.stats.assists;
            my_damage_dealt_to_champions += participant0.stats.total_damage_dealt_to_champions;

            let my_subteam = participant0.stats.player_subteam_id;
            for participant in &game.game_detail.participants {
                let same_team = if is_cherry && my_subteam > 0 {
                    participant.stats.player_subteam_id == my_subteam
                } else {
                    participant0.team_id == participant.team_id
                };
                if same_team {
                    all_gold += participant.stats.gold_earned;
                    all_k += participant.stats.kills;
                    all_damage_dealt_to_champions +=
                        participant.stats.total_damage_dealt_to_champions;
                }
            }
        }
        count += 1;
    }

    let group_rate = ((my_ka as f64 / all_k as f64) * 100.0).trunc() as i32;
    let average_gold = (my_gold as f64 / count as f64).trunc() as i32;
    let gold_rate = ((my_gold as f64 / all_gold as f64) * 100.0).trunc() as i32;
    let average_damage_dealt_to_champions =
        (my_damage_dealt_to_champions as f64 / count as f64).trunc() as i32;
    let damage_dealt_to_champions_rate =
        ((my_damage_dealt_to_champions as f64 / all_damage_dealt_to_champions as f64) * 100.0)
            .trunc() as i32;

    (
        group_rate,
        average_gold,
        gold_rate,
        average_damage_dealt_to_champions,
        damage_dealt_to_champions_rate,
    )
}

/// 计算胜负场次。
///
/// # 参数
///
/// - `match_history`: 对局记录
/// - `mode`: 队列模式筛选（0 表示所有模式）
///
/// # 返回值
///
/// (胜场, 负场)
fn count_win_and_loss(match_history: &MatchHistory, mode: i32) -> (i32, i32) {
    let mut select_wins = 0;
    let mut select_losses = 0;

    for game in &match_history.games.games {
        // 模式筛选按中文名分组匹配（如「人机(入门)」对应新旧 830/870 两个队列 ID）
        if mode == 0
            || crate::constant::game::queue_ids_same_group(game.queue_id as u32, mode as u32)
        {
            if game.participants[0].stats.win {
                select_wins += 1;
            } else {
                select_losses += 1;
            }
        }
    }

    (select_wins, select_losses)
}

/// 计算 KDA 数据。
///
/// # 参数
///
/// - `match_history`: 对局记录
/// - `mode`: 队列模式筛选（0 表示所有模式）
///
/// # 返回值
///
/// (平均击杀, 平均死亡, 平均助攻)
fn count_kda(match_history: &MatchHistory, mode: i32) -> (f64, f64, f64) {
    let mut count = 1;
    let mut kills = 0;
    let mut deaths = 1;
    let mut assists = 0;

    for game in &match_history.games.games {
        // 模式筛选按中文名分组匹配（如「人机(入门)」对应新旧 830/870 两个队列 ID）
        if mode != 0
            && !crate::constant::game::queue_ids_same_group(game.queue_id as u32, mode as u32)
        {
            continue;
        }

        count += 1;
        kills += game.participants[0].stats.kills;
        deaths += game.participants[0].stats.deaths;
        assists += game.participants[0].stats.assists;
    }

    (
        kills as f64 / count as f64,
        deaths as f64 / count as f64,
        assists as f64 / count as f64,
    )
}
