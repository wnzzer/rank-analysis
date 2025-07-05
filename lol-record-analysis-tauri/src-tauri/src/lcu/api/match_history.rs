use std::{sync::LazyLock, time::Duration};

use crate::lcu::api::model::{Participant, ParticipantIdentity};
use moka::future::Cache;
use serde::{Deserialize, Serialize};

use crate::lcu::{api::game_detail::GameDetail, util::http::lcu_get};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct MatchHistory {
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "beginIndex")]
    pub begin_index: i32,
    #[serde(rename = "endIndex")]
    pub end_index: i32,
    pub games: GamesWrapper,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct GamesWrapper {
    pub games: Vec<Game>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Game {
    // Note: 'mvp' is marked as "计算信息" (calculated information) in Go,
    // so it might be derived rather than directly from JSON.
    // If it's present in JSON, keep it. If not, consider omitting or making it an Option.
    pub mvp: String,
    #[serde(rename = "gameDetail")]
    pub game_detail: GameDetail, // Assuming GameDetail is another struct you'll define
    #[serde(rename = "gameId")]
    pub game_id: i32,
    #[serde(rename = "gameCreationDate")]
    pub game_creation_date: String, // You might consider using a more specific date/time type
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
    #[serde(rename = "queueName")]
    pub queue_name: String,
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
            "lol-match-history/v1/products/lol/{}/matches?beginIndex={}&endIndex={}",
            puuid, begin_index, end_index
        );
        let match_history = lcu_get::<Self>(&uri).await?;
        Ok(match_history)
    }

    pub async fn get_my_match_history(begin_index: i32, end_index: i32) -> Result<Self, String> {
        let uri = format!(
            "lol-match-history/v1/products/lol/me/matches?beginIndex={}&endIndex={}",
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

            let actual_end = std::cmp::min(end, total_games);

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
}
