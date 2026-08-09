//! # LCU 工具子模块
//!
//! - [`http`]：基于认证的 LCU GET/POST/PATCH 及图片请求
//! - [`token`]：从客户端进程命令行解析 remoting-auth-token 与 app-port
//! - [`uuid`]：UUID 解析、格式化与混淆还原

pub mod http;
pub mod token;
pub mod uuid;
