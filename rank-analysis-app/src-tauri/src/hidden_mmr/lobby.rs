//! # 上一局全员平均段位
//!
//! 加减分记录不足时的隐藏分初步估算：匹配系统按隐藏分凑人，一局十名玩家的平均段位
//! 就是「系统认为这一局该是什么水平」，可以当作本人隐藏分的近似。
//!
//! 局限（所以只在记录不足时兜底，记录够了就改用加减分估算）：
//! - 取的是十个人**现在**的段位，不是开局那一刻的；
//! - 一局的样本只有十个人，组排、补位都会把平均值带偏；
//! - 未定级 / 定级赛中的玩家没有段位，不计入。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use super::{axis, collector};
use crate::lcu::api::game_detail::GameDetail;
use crate::lcu::api::match_history::{Game, MatchHistory};
use crate::lcu::api::rank::Rank;

/// 至少要有这么多名玩家有段位才给出平均值。
///
/// 一局里未定级的人太多时，剩下两三个人的平均没有代表性。
pub const MIN_RANKED_PLAYERS: usize = 5;

/// 战绩列表的取数范围：LCU 能可靠提供的最近 50 场。
const HISTORY_END_INDEX: i32 = 49;

/// 一局的全员平均段位。
///
/// - `game_id`: 取自哪一局
/// - `score`: 平均段位在分数轴上的值
/// - `players`: 参与平均的玩家数（有段位的）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LobbyAverage {
    pub game_id: i64,
    pub score: i32,
    pub players: usize,
}

/// 按 (puuid, 队列) 缓存最近一次算出的结果。
///
/// 同一局反复查询（切页、刷新）不必每次重取十个人的段位；打完新的一局后
/// `game_id` 变了，缓存自然作废。
static CACHE: LazyLock<Mutex<HashMap<(String, String), LobbyAverage>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 排位队列类型 → queueId。
pub fn queue_id_of(queue_type: &str) -> Option<i32> {
    match queue_type {
        "RANKED_SOLO_5x5" => Some(420),
        "RANKED_FLEX_SR" => Some(440),
        _ => None,
    }
}

/// 战绩列表里该队列最近的一局。
///
/// 按 gameId 取最大的而不是取列表第一个：gameId 随时间递增，不依赖列表的排序方向。
pub fn latest_game_of_queue(games: &[Game], queue_id: i32) -> Option<i64> {
    games
        .iter()
        .filter(|g| g.queue_id == queue_id)
        .map(|g| g.game_id)
        .max()
}

/// 对一组段位分数求平均，忽略没有段位的玩家。
///
/// # 参数
/// - `scores`: 每名玩家的段位分数；未定级为 `None`
///
/// # 返回值
/// `(平均分, 参与平均的人数)`；有段位的玩家少于 [`MIN_RANKED_PLAYERS`] 时返回 `None`。
pub fn average_score(scores: &[Option<i32>]) -> Option<(i32, usize)> {
    let ranked: Vec<i32> = scores.iter().flatten().copied().collect();
    if ranked.len() < MIN_RANKED_PLAYERS {
        return None;
    }
    let sum: i64 = ranked.iter().map(|s| *s as i64).sum();
    let mean = (sum as f64 / ranked.len() as f64).round() as i32;
    Some((mean, ranked.len()))
}

/// 一名玩家在指定队列的段位分数；未定级 / 定级赛中 / 取不到为 `None`。
async fn score_of(puuid: &str, queue_type: &str) -> Option<i32> {
    let rank = Rank::get_rank_by_puuid(puuid).await.ok()?;
    let info = collector::queue_info(&rank, queue_type)?;
    if info.is_provisional {
        return None;
    }
    axis::to_score(&info.tier, &info.division, info.league_points)
}

/// 取该召唤师在指定队列上一局的全员平均段位。
///
/// # 参数
/// - `puuid`: 召唤师 PUUID
/// - `queue_type`: `RANKED_SOLO_5x5` 或 `RANKED_FLEX_SR`
///
/// # 返回值
/// 最近 50 场里没有该队列的对局、对局详情取不到，或有段位的玩家不足时返回 `None`。
pub async fn last_game_lobby(puuid: &str, queue_type: &str) -> Option<LobbyAverage> {
    let queue_id = queue_id_of(queue_type)?;
    let history = MatchHistory::get_match_history_by_puuid(puuid, 0, HISTORY_END_INDEX)
        .await
        .ok()?;
    let game_id = latest_game_of_queue(&history.games.games, queue_id)?;

    let key = (puuid.to_string(), queue_type.to_string());
    if let Some(cached) = CACHE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&key)
        .filter(|c| c.game_id == game_id)
    {
        return Some(*cached);
    }

    let detail = GameDetail::get_game_detail_by_id(&game_id).await.ok()?;
    let mut scores = Vec::with_capacity(detail.participant_identities.len());
    for identity in &detail.participant_identities {
        // 人机 / 匿名玩家没有 puuid，按没有段位处理
        let player_puuid = &identity.player.puuid;
        scores.push(if player_puuid.is_empty() {
            None
        } else {
            score_of(player_puuid, queue_type).await
        });
    }
    let (score, players) = average_score(&scores)?;
    let lobby = LobbyAverage {
        game_id,
        score,
        players,
    };
    CACHE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(key, lobby);
    Some(lobby)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(game_id: i64, queue_id: i32) -> Game {
        Game {
            game_id,
            queue_id,
            ..Game::default()
        }
    }

    #[test]
    fn should_average_ranked_players_and_skip_unranked() {
        // 5 人 2400（钻石 IV）、3 人 2000（翡翠 IV）、2 人未定级
        let mut scores = vec![Some(2400); 5];
        scores.extend([Some(2000); 3]);
        scores.extend([None, None]);

        assert_eq!(average_score(&scores), Some((2250, 8)));
    }

    #[test]
    fn should_round_the_average() {
        let scores = [Some(100), Some(100), Some(100), Some(100), Some(101)];

        // 100.2 → 100
        assert_eq!(average_score(&scores), Some((100, 5)));
    }

    #[test]
    fn should_give_up_when_too_few_players_are_ranked() {
        let mut scores = vec![Some(2400); MIN_RANKED_PLAYERS - 1];
        scores.extend(vec![None; 6]);

        assert_eq!(average_score(&scores), None);
        assert_eq!(average_score(&[]), None);
    }

    #[test]
    fn should_pick_the_newest_game_of_the_queue_regardless_of_order() {
        let games = [game(30, 420), game(50, 440), game(40, 420), game(10, 420)];

        assert_eq!(latest_game_of_queue(&games, 420), Some(40));
        assert_eq!(latest_game_of_queue(&games, 440), Some(50));
        assert_eq!(latest_game_of_queue(&games, 450), None);
    }

    #[test]
    fn should_map_ranked_queue_types_to_queue_ids() {
        assert_eq!(queue_id_of("RANKED_SOLO_5x5"), Some(420));
        assert_eq!(queue_id_of("RANKED_FLEX_SR"), Some(440));
        assert_eq!(queue_id_of("NORMAL_DRAFT"), None);
    }
}
