//! # LCU 模块
//!
//! 与英雄联盟客户端（League Client UX）的本地 HTTP API 交互。
//! - [`api`]：各 LCU 接口的请求与模型（会话、召唤师、段位、对局记录等）
//! - [`util`]：认证（token/端口）、HTTP 客户端封装

pub mod api;
pub mod listener;
pub mod util;