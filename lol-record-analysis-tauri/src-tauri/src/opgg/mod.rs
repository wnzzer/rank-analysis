//! # OP.GG 数据模块
//!
//! 拉取 OP.GG 内部 API 的英雄统计数据（T级/胜率/Ban率/对线克制），
//! 为对局页展示与 AI prompt 的【版本情报】【对线克制】块提供数据源。
//!
//! 架构与 [`crate::fandom`] 同构：`api` 负责拉取解析，`data` 定义结构，
//! `cache` 负责磁盘持久化（按模式一个 JSON 文件），命令层见
//! [`crate::command::opgg`]。

pub mod api;
pub mod cache;
pub mod data;
