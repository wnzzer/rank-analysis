//! # 海克斯大乱斗（Mayhem）数据模块
//!
//! 负责从 aramgg 公开客户端 API（`data.dtodo.cn`，queueId 2400 大乱斗数据源）
//! 同步版本化的榜单数据到本地磁盘，并提供读取能力。
//!
//! ## 模块划分
//!
//! - [`client`]：HTTP 层——拉取远端 config/manifest、按 sha256 校验下载文件
//! - [`store`]：磁盘层——版本目录布局、指针原子切换、旧版本清理、本地 JSON 读取
//!
//! ## 设计要点（对应 docs/feature-expansion-plan.md A0.1）
//!
//! - **版本不可变**：`versions/{dataVersion}/` 目录一经校验通过不再修改，CDN 友好
//! - **原子激活**：先下载到 `.staging` 目录并全量校验 hash，成功后才重命名正式目录、
//!   最后原子写入指针——任何一步失败都不会破坏当前可用版本
//! - **本地优先**：前端永远读指针指向的版本；断网时上一版本数据完整可用
//! - **缓存语义**：整体放在系统临时目录（见 [`crate::paths`]），可随时删掉重建

pub mod client;
pub mod store;
