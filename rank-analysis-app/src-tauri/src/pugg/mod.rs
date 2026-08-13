//! # PUGG 自有战绩聚合模块
//!
//! 基于**自有战绩**的英雄出装/符文统计（Player's Own Game-Generated，PUGG）。
//! 与 OP.GG 外部数据相对：PUGG 只读本地 LCU 战绩，无外部网络耦合，国服数据
//! 天然对齐（OP.GG 是外服）。
//!
//! 数据来源：对局摘要（`lol-match-history` 缓存窗口 0..=49 共 50 场，LCU 本地）。
//! 摘要级字段已含 `item0..6` / `perkPrimaryStyle` / `perkSubStyle` / `perk0` /
//! `spell1Id` / `spell2Id` / `win`，聚合**无需拉单局详情**，单次窗口取数与计算
//! 全程本地，满足验收「50 场 < 200ms」。
//!
//! 聚合规则（见 [`aggregate`]）：
//! - 按 `champion_id` + `queue_id`(可选) 分组；
//! - 「我」的定位：先按 `puuid` 匹配身份数组，匹配不上回退 `participants[0]`
//!   （与 `MatchHistory::calculate` 的既有约定一致）；
//! - 胜场权重 2x：同一出装/符文出现在胜局里权重翻倍，排序优先；
//! - 样本 < 5 场不输出（防小样本噪声）；
//! - 跳过空槽与饰品（守卫类物品不计入出装）。
//!
//! 分路(位置)维度暂不支持：LCU 摘要无 lane 字段（国服 lane 不可信，见
//! `command/bp_suggest.rs` 的既有结论），`BuildStats.position` 恒为空串，
//! 留给 OP.GG 合并层（方向 C 的 C3）补齐。
//!
//! 消费方：对局中 `ChampionIntelCard` 的推荐出装/符文页签（C-2-UI）。
//!
//! `stat_mods` / `skill_order` 字段 LCU 摘要不提供（仅 SGP DETAILS 有），
//! 逐局拉详情代价高，按最短路径原则不在本模块输出，后续方向 C 增强再补。

pub mod aggregate;