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

/// 结算页的精简对局信息，仅含识别本局所需的两个字段。
///
/// 对应 `lol-end-of-game/v1/eog-stats-block`。2026-11-06 实测：EndOfGame 阶段过一会儿后
/// `gameclient-eog-stats-block` 会 404（`No gameclient EOG stats available`），
/// 而本端点仍然可用，因此作为 [`EogStatsBlock`] 的后备。
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EogSummary {
    pub game_id: i64,
    pub queue_type: String,
}

impl EogSummary {
    /// 拉取 `lol-end-of-game/v1/eog-stats-block`；响应缺少字段时返回错误。
    pub async fn get() -> Result<Self, String> {
        crate::lcu::util::http::lcu_get("lol-end-of-game/v1/eog-stats-block").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eog_summary_parses_trimmed_body() {
        let s: EogSummary = serde_json::from_str(
            r#"{"gameId":301056769722,"queueType":"RANKED_SOLO_5x5","ranked":true,"basePoints":0}"#,
        )
        .unwrap();
        assert_eq!(s.game_id, 301056769722);
        assert_eq!(s.queue_type, "RANKED_SOLO_5x5");
    }

    #[test]
    fn eog_summary_rejects_missing_game_id() {
        let r = serde_json::from_str::<EogSummary>(r#"{"queueType":"RANKED_SOLO_5x5"}"#);
        assert!(r.is_err());
    }
}
