//! OP.GG 数据结构定义：英雄元数据、对线克制、模式快照。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 单英雄在某一分路的统计元数据。
///
/// 数据来自 OP.GG（外服，emerald+ 分段），`tier` 为 1~5（1 最强），
/// aram 等无分路模式下 `position` 为空字符串。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampionMeta {
    /// 英雄 ID
    pub champion_id: i32,
    /// 分路（LCU 命名：TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY；无分路模式为 ""）
    pub position: String,
    /// T 级（1~5，1 最强；无数据为 0）
    pub tier: i32,
    /// 同分路排名（无数据为 0）
    pub rank: i32,
    /// 上一 patch 的同分路排名（无数据为 0；serde 默认兼容旧磁盘缓存）
    #[serde(default)]
    pub rank_prev_patch: i32,
    /// 胜率（0~1）
    pub win_rate: f64,
    /// 登场率（0~1）
    pub pick_rate: f64,
    /// Ban 率（0~1，源数据缺失时为 0）
    pub ban_rate: f64,
    /// 该英雄玩此分路的占比（0~1，无分路模式为 1.0）
    pub role_rate: f64,
    /// 是否该英雄的主分路（role_rate 最高者）
    pub is_main_position: bool,
}

/// 对线克制关系：本英雄面对 `opponent_id` 时的对线胜率。
///
/// OP.GG 每分路仅给出最难打的 top3 对手，`subject_win_rate` 通常 <0.5。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaneCounter {
    /// 对手英雄 ID
    pub opponent_id: i32,
    /// 分路（LCU 命名）
    pub position: String,
    /// 本英雄对该对手的对线胜率（0~1）
    pub subject_win_rate: f64,
    /// 样本对局数
    pub play: i64,
}

/// 某一模式的完整数据快照，内存与磁盘缓存的最小单元。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpggSnapshot {
    /// 模式："ranked" | "aram"
    pub mode: String,
    /// patch 版本号（OP.GG meta.version，如 "16.13"）
    pub patch: String,
    /// 拉取时间（unix 秒）
    pub fetched_at: i64,
    /// 英雄 ID → 各分路元数据
    pub champions: HashMap<i32, Vec<ChampionMeta>>,
    /// 英雄 ID → 被克制列表（仅有分路的模式）
    pub counters: HashMap<i32, Vec<LaneCounter>>,
}

/// 把 OP.GG 分路命名转成 LCU 命名，未知值原样返回。
///
/// 对齐 `session.rs` 排序用的 TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY 词汇，
/// 让前端与信号引擎只面对一套分路词汇。
pub fn normalize_position(opgg_name: &str) -> String {
    match opgg_name {
        "MID" => "MIDDLE".to_string(),
        "ADC" => "BOTTOM".to_string(),
        "SUPPORT" => "UTILITY".to_string(),
        other => other.to_string(),
    }
}
