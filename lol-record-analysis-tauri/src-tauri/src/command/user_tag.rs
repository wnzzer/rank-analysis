use crate::command::user_tag_config;
use crate::constant::game::QUEUE_ID_TO_CN;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneGamePlayer {
    pub index: i32,
    pub game_id: i64,
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
    #[serde(rename = "Summoner")]
    pub summoner: Summoner,
    #[serde(rename = "OneGamePlayer")]
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

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentData {
    pub kda: f64,
    pub kills: f64,
    pub deaths: f64,
    pub assists: f64,
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

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserTag {
    pub recent_data: RecentData,
    pub tag: Vec<RankTag>,
}

#[tauri::command]
pub async fn get_user_tag_by_name(name: &str, mode: i32) -> Result<UserTag, String> {
    let summoner = Summoner::get_summoner_by_name(name).await?;
    get_user_tag_by_puuid(&summoner.puuid, mode).await
}

#[tauri::command]
pub async fn get_user_tag_by_puuid(puuid: &str, mode: i32) -> Result<UserTag, String> {
    log::info!("get_user_tag_by_puuid: {}, mode: {}", puuid, mode);
    let mut match_history = MatchHistory::get_match_history_by_puuid(puuid, 0, 19).await?;
    match_history.enrich_game_detail().await?;

    let mut tags = Vec::new();

    // Update: Use dynamic tag configuration
    let configs = user_tag_config::load_config().await;
    for config in configs {
        if let Some(tag) = config.evaluate(&match_history, mode) {
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

fn count_win_and_loss(match_history: &MatchHistory, mode: i32) -> (i32, i32) {
    let mut select_wins = 0;
    let mut select_losses = 0;

    for game in &match_history.games.games {
        if mode == 0 || game.queue_id == mode {
            if game.participants[0].stats.win {
                select_wins += 1;
            } else {
                select_losses += 1;
            }
        }
    }

    (select_wins, select_losses)
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
