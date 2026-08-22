//! # Riot 开发者 API 接入（riot，M1 支线）
//!
//! 预留的官方 match-v5 通道（L3 归因四级降级链之外的独立校验源，路线图
//! v1.3 §4b / §5.5）。当前**只有限流基础设施**（[`rate_limit`]，ADR-6，
//! 有独立测试锁定）；此前骨架版的 `get_match_detail` 因全仓无调用方、且
//! match-v5 应按区域路由却拼了 platform 路由（接线必踩坑），已整体移除。
//! 后续真正接入时须注意：
//!
//! - 路由：match-v5 用**区域路由**（`americas/europe/asia/sea` 或国服对应区域），
//!   不是 platform（如 `hn1`）；
//! - 限流：除本地令牌桶外还应感知响应侧 429 与 `Retry-After`；
//! - key 存放约定不变：`settings.riot.apiKey`（config 点分路径）。

pub mod rate_limit;
