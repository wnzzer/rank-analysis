//! # LCU API 子模块
//!
//! 按功能划分的 LCU 接口：资源（英雄等）、选人、对局详情、大厅、对局记录、
//! 通用模型、阶段、段位、会话、召唤师等。

pub mod asset;
pub mod champion_select;
pub mod game_detail;
pub mod lobby;
pub mod match_history;
pub mod model;
pub mod phase;
pub mod rank;
pub mod session;
pub mod summoner;
