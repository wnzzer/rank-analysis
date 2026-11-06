//! # 隐藏分估算
//!
//! 记录当前召唤师每局排位的 LP 加减分，再以当前段位为锚点估算隐藏分。
//!
//! - [`axis`]：段位 ↔ 分数轴换算
//! - [`store`]：每局记录的本地 JSON 存储
//! - [`estimate`]：由记录和当前段位算出估算结果
//! - [`collector`]：随客户端阶段变化采集每局 LP 变化
//!
//! 设计见 `docs/superpowers/specs/2026-11-06-hidden-mmr-design.md`。

pub mod axis;
pub mod collector;
pub mod estimate;
pub mod store;
