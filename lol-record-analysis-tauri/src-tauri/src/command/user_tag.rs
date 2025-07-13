use crate::constant::{QUEUE_FLEX, QUEUE_ID_TO_CN, QUEUE_SOLO_5X5};
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneGamePlayer {
    pub index: i32,
    pub game_id: i32,
    pub puuid: String,
    pub game_created_at: String,
    pub is_my_team: bool,
    pub game_name: String,
    pub tag_line: String,
    pub champion_id: i32,
    pub champion_key: String,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    pub win: bool,
    pub queue_id_cn: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneGamePlayerSummoner {
    pub win_rate: i32,
    pub wins: i32,
    pub losses: i32,
    pub summoner: Summoner,
    pub one_game_player: Vec<OneGamePlayer>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RankTag {
    pub good: bool,
    pub tag_name: String,
    pub tag_desc: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendAndDispute {
    pub friends_rate: i32,
    pub dispute_rate: i32,
    pub friends_summoner: Vec<OneGamePlayerSummoner>,
    pub dispute_summoner: Vec<OneGamePlayerSummoner>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentData {
    pub kda: f64,
    pub kills: f64,
    pub deaths: f64,
    pub assists: f64,
    pub wins: i32,
    pub losses: i32,
    pub flex_wins: i32,
    pub flex_losses: i32,
    pub select_mode: i32,
    pub select_mode_cn: String,
    pub select_wins: i32,
    pub select_losses: i32,
    pub group_rate: i32,
    pub average_gold: i32,
    pub gold_rate: i32,
    pub average_damage_dealt_to_champions: i32,
    pub damage_dealt_to_champions_rate: i32,
    pub friend_and_dispute: FriendAndDispute,
    pub one_game_players_map: Option<HashMap<String, Vec<OneGamePlayer>>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserTag {
    pub recent_data: RecentData,
    pub tag: Vec<RankTag>,
}

pub async fn get_user_tag_by_puuid(puuid: &str, mode: i32) -> Result<UserTag, String> {
    let mut match_history = MatchHistory::get_match_history_by_puuid(&puuid, 0, 19).await?;
    match_history.enrich_game_detail().await?;

    let mut tags = Vec::new();

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

    let (wins, losses, flex_wins, flex_losses, select_wins, select_losses) =
        count_win_and_loss(&match_history, mode);
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
            wins,
            losses,
            flex_wins,
            flex_losses,
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
    count_friend_and_dispute(&one_game_player_map, &mut user_tag.recent_data, &puuid).await;

    Ok(user_tag)
}

fn get_one_game_players(match_history: &MatchHistory) -> HashMap<String, Vec<OneGamePlayer>> {
    let mut one_game_player_map = HashMap::new();

    for (index, game) in match_history.games.games.iter().enumerate() {
        let my_team_id = game.participants[0].team_id;

        for (i, participant_identity) in game.game_detail.participant_identities.iter().enumerate()
        {
            // 跳过机器人和没有puuid的玩家
            if participant_identity.player.summoner_name.is_empty() {
                continue;
            }

            let puuid = format!(
                "{}#{}",
                participant_identity.player.game_name, participant_identity.player.tag_line
            );

            if let Some(participant) = game.game_detail.participants.get(i) {
                let queue_id_cn = QUEUE_ID_TO_CN
                    .get(&(game.queue_id as u32))
                    .unwrap_or(&"未知模式")
                    .to_string();

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
        if let Ok(summoner) = Summoner::get_summoner_by_name(&games[0].game_name).await {
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
        if let Ok(summoner) = Summoner::get_summoner_by_name(&games[0].game_name).await {
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
        if mode != 0 && game.queue_id != mode {
            continue;
        }

        for participant0 in &game.participants {
            my_gold += participant0.stats.gold_earned;
            my_ka += participant0.stats.kills + participant0.stats.assists;
            my_damage_dealt_to_champions += participant0.stats.total_damage_dealt_to_champions;

            for participant in &game.game_detail.participants {
                if participant0.team_id == participant.team_id {
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

fn count_win_and_loss(match_history: &MatchHistory, mode: i32) -> (i32, i32, i32, i32, i32, i32) {
    let mut wins = 0;
    let mut losses = 0;
    let mut flex_wins = 0;
    let mut flex_losses = 0;
    let mut select_wins = 0;
    let mut select_losses = 0;

    for game in &match_history.games.games {
        if game.queue_id == QUEUE_SOLO_5X5 {
            if game.participants[0].stats.win {
                wins += 1;
            } else {
                losses += 1;
            }
        }

        if game.queue_id == QUEUE_FLEX {
            if game.participants[0].stats.win {
                flex_wins += 1;
            } else {
                flex_losses += 1;
            }
        }

        if mode != 0 {
            if game.queue_id == mode {
                if game.participants[0].stats.win {
                    select_wins += 1;
                } else {
                    select_losses += 1;
                }
            }
        } else {
            if game.participants[0].stats.win {
                select_wins += 1;
            } else {
                select_losses += 1;
            }
        }
    }

    (
        wins,
        losses,
        flex_wins,
        flex_losses,
        select_wins,
        select_losses,
    )
}

fn count_kda(match_history: &MatchHistory, mode: i32) -> (f64, f64, f64) {
    let mut count = 1;
    let mut kills = 0;
    let mut deaths = 1;
    let mut assists = 0;

    for game in &match_history.games.games {
        if mode != 0 && game.queue_id != mode {
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

fn is_streak_tag(match_history: &MatchHistory) -> RankTag {
    let desc = "最近胜率较高的大腿玩家哦";
    let mut i = 0;

    for game in &match_history.games.games {
        // 不是排位不算
        if game.queue_id != QUEUE_SOLO_5X5 && game.queue_id != QUEUE_FLEX {
            continue;
        }

        if !game.participants[0].stats.win {
            break;
        }

        i += 1;
    }

    if i >= 3 {
        RankTag {
            good: true,
            tag_name: format!("{}连胜", number_to_chinese(i)),
            tag_desc: desc.to_string(),
        }
    } else {
        RankTag {
            good: false,
            tag_name: String::new(),
            tag_desc: String::new(),
        }
    }
}

fn is_losing_tag(match_history: &MatchHistory) -> RankTag {
    let desc = "最近连败的玩家哦";
    let mut i = 0;

    for game in &match_history.games.games {
        if game.queue_id != QUEUE_SOLO_5X5 && game.queue_id != QUEUE_FLEX {
            continue;
        }

        if game.participants[0].stats.win {
            break;
        }

        i += 1;
    }

    if i >= 3 {
        RankTag {
            good: false,
            tag_name: format!("{}连败", number_to_chinese(i)),
            tag_desc: desc.to_string(),
        }
    } else {
        RankTag {
            good: false,
            tag_name: String::new(),
            tag_desc: String::new(),
        }
    }
}

fn is_casual_tag(match_history: &MatchHistory) -> RankTag {
    let desc = "排位比例较少的玩家哦,请宽容一点";
    let mut i = 0;

    for game in &match_history.games.games {
        if game.queue_id != QUEUE_SOLO_5X5 && game.queue_id != QUEUE_FLEX {
            i += 1;
        }
    }

    if i > 10 {
        RankTag {
            good: false,
            tag_name: "娱乐".to_string(),
            tag_desc: desc.to_string(),
        }
    } else {
        RankTag {
            good: false,
            tag_name: String::new(),
            tag_desc: String::new(),
        }
    }
}

fn is_special_player_tag(match_history: &MatchHistory) -> Vec<RankTag> {
    let mut tags = Vec::new();
    let bad_special_champion: HashMap<i32, &str> = [(901, "小火龙"), (141, "凯隐"), (10, "天使")]
        .iter()
        .cloned()
        .collect();

    let desc = "该玩家使用上述英雄比例较高(由于英雄特殊定位,风评相对糟糕的英雄玩家)";

    let mut bad_special_champion_select_map = HashMap::new();

    for game in &match_history.games.games {
        if game.queue_id != QUEUE_SOLO_5X5 && game.queue_id != QUEUE_FLEX {
            continue;
        }

        if let Some(&champion_name) = bad_special_champion.get(&game.participants[0].champion_id) {
            *bad_special_champion_select_map
                .entry(champion_name.to_string())
                .or_insert(0) += 1;
        }
    }

    for (tag_name, use_count) in bad_special_champion_select_map {
        if use_count >= 5 {
            tags.push(RankTag {
                good: false,
                tag_name,
                tag_desc: desc.to_string(),
            });
        }
    }

    tags
}

fn number_to_chinese(num: i32) -> String {
    let chinese_digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    let chinese_units = ["", "十", "百", "千", "万", "亿"];

    if num == 0 {
        return chinese_digits[0].to_string();
    }

    let mut result = Vec::new();
    let mut num = num;
    let mut unit_pos = 0;
    let mut zero_flag = false;

    while num > 0 {
        let digit = (num % 10) as usize;
        if digit == 0 {
            if !zero_flag && !result.is_empty() {
                result.push(chinese_digits[0].to_string());
            }
            zero_flag = true;
        } else {
            result.push(format!(
                "{}{}",
                chinese_digits[digit], chinese_units[unit_pos]
            ));
            zero_flag = false;
        }
        num /= 10;
        unit_pos += 1;
    }

    // 处理"一十" -> "十"
    if result.len() > 1 && result[result.len() - 1] == chinese_units[1] {
        result.pop();
    }

    result.reverse();
    result.join("")
}
