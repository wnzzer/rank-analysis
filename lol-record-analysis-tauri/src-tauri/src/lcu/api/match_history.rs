use std::{sync::LazyLock, time::Duration};

use crate::{
    constant,
    lcu::api::model::{Participant, ParticipantIdentity},
};
use moka::future::Cache;
use serde::{Deserialize, Serialize};

use crate::lcu::{api::game_detail::GameDetail, util::http::lcu_get};

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

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct GamesWrapper {
    pub games: Vec<Game>,
}

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

impl MatchHistory {
    async fn get_by_puuid(puuid: &str, begin_index: i32, end_index: i32) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/{}/matches?begIndex={}&endIndex={}",
            puuid, begin_index, end_index
        );
        log::info!("build url {}", uri);

        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }

    pub async fn get_my_match_history(begin_index: i32, end_index: i32) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/me/matches?beginIndex={}%26endIndex={}",
            begin_index, end_index
        );
        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }

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
        let max_cache_end_index = 49;

        // 参数验证
        if beg_index < 0 || end_index < 0 {
            return Err("索引不能为负数".to_string());
        }

        if beg_index >= end_index {
            return Err("开始索引必须小于结束索引".to_string());
        }

        // 如果没有用户缓存，且在缓存范围内，则获取缓存
        if !MATCH_HISTORY_CACHE.contains_key(puuid) && end_index <= max_cache_end_index {
            let cache = MatchHistory::get_by_puuid(puuid, 0, max_cache_end_index).await?;
            MATCH_HISTORY_CACHE.insert(puuid.to_string(), cache).await;
        }

        let res = if end_index <= max_cache_end_index {
            let history = MATCH_HISTORY_CACHE
                .get(puuid)
                .await
                .ok_or_else(|| format!("未找到缓存的比赛历史: {}", puuid))?
                .clone();

            let beg = beg_index as usize;
            let end = end_index as usize;
            let total_games = history.games.games.len();

            if beg >= total_games {
                return Err(format!(
                    "开始索引 {} 超出范围，总游戏数 {}",
                    beg, total_games
                ));
            }

            let actual_end = std::cmp::min(end + 1, total_games);

            if beg >= actual_end {
                return Err(format!("有效范围为空：{} >= {}", beg, actual_end));
            }

            MatchHistory {
                games: GamesWrapper {
                    games: history.games.games[beg..actual_end].to_vec(),
                },
                ..history
            }
        } else {
            MatchHistory::get_by_puuid(puuid, beg_index, end_index).await?
        };

        Ok(res)
    }

    pub async fn enrich_game_detail(&mut self) -> Result<(), String> {
        if self.games.games.is_empty() {
            return Ok(());
        }
        for game in &mut self.games.games {
            game.game_detail = GameDetail::get_game_detail_by_id(&game.game_id).await?;
        }

        Ok(())
    }
    pub fn enrich_info_cn(&mut self) -> Result<(), String> {
        if self.games.games.is_empty() {
            return Ok(());
        }
        for game in &mut self.games.games {
            game.queue_name = match constant::game::get_queue_id_to_cn(game.queue_id as u32) {
                Some(s) => s.into(), // works for &str or String
                None => "未知".to_string(),
            };
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

            // Use i64 for intermediate sums to avoid potential overflow (though unlikely with typical values)
            let mut total_gold_earned: i64 = 0;
            let mut total_damage_dealt_to_champions: i64 = 0;
            let mut total_damage_taken: i64 = 0;
            let mut total_heal: i64 = 0;

            for p in &game.game_detail.participants {
                if p.team_id == team_id {
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
        }

        Ok(())
    }
}
