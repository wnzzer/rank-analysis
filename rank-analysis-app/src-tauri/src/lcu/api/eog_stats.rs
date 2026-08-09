//! # 当前对局结算预统计 API
//!
//! 对应 `lol-end-of-game/v1/gameclient-eog-stats-block`：在 InProgress / PreEndOfGame
//! 阶段实时返回当前对局所有玩家的 PUUID、英雄、KDA 与 **`subteamId`（CHERRY 1~8）**。
//!
//! 主要用途：CHERRY 模式下用于把 lobby 阶段稀疏的 `teamParticipantId`
//! 修正为权威 1~8 小队号。

use serde::{Deserialize, Serialize};

/// 实时结算统计 block。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EogStatsBlock {
    pub game_id: i64,
    pub game_mode: String,
    pub queue_id: i32,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    pub stats_block: StatsBlock,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsBlock {
    pub game_length_seconds: i32,
    pub players: Vec<EogPlayer>,
}

/// 单个玩家的 EOG 数据。仅保留需要的字段；其它由 LCU 多余字段会被 serde 忽略。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EogPlayer {
    /// 注意 LCU 这里键名是大写 `PUUID`，不是 camelCase
    #[serde(rename = "PUUID", default)]
    pub puuid: String,
    #[serde(default)]
    pub champion_id: i32,
    /// CHERRY/斗魂模式：1~8，玩家所属小队 ID
    #[serde(default)]
    pub subteam_id: i32,
    /// CHERRY/斗魂模式：1~8，小队当前/最终名次
    #[serde(default)]
    pub subteam_standing: i32,
}

impl EogStatsBlock {
    /// 拉取 `lol-end-of-game/v1/gameclient-eog-stats-block`。
    ///
    /// 仅 InProgress / PreEndOfGame / EndOfGame 阶段返回有效数据；其它阶段返回错误。
    pub async fn get() -> Result<Self, String> {
        crate::lcu::util::http::lcu_get("lol-end-of-game/v1/gameclient-eog-stats-block").await
    }
}
