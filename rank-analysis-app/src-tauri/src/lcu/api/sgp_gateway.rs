//! SGP 数据通道接口（P1-4 DI）：把「主机解析 + 请求发送」抽象为 trait。
//!
//! - [`SgpGateway`]：业务层（`sgp.rs`）只依赖该接口，不直接碰静态表与 HTTP 层；
//! - [`DefaultSgpGateway`]：默认实现，委托 [`sgp_league_servers`]（动态映射）+
//!   [`sgp_get`]（3 次指数退避重试），行为与收编前完全一致；
//! - [`gateway()`]：进程级单例访问点，测试可替换为替身实现。
//!
//! 「LCU 数据源与 SGP 数据源按 feature 互换」已在 command 层实现：本区战绩/详情走
//! LCU（`command/match_history.rs`），跨区查询与 SGP 帧流走本网关（`command/sgp.rs`），
//! 前端按 feature 合并（`mergeGamesByGameId`）。本接口让 SGP 侧自身可替换、可测试。

use std::sync::LazyLock;

use crate::lcu::api::sgp_league_servers;
use crate::lcu::util::http::sgp_get_text;

/// SGP 数据通道契约。
///
/// 注意：`request` 返回响应**文本**而非泛型 `T`——泛型方法不满足 trait object
/// 的 dyn 兼容性（`SgpGateway` 以 `&dyn` 形式被业务层持有），类型化解析由调用方
/// 按目标结构完成（`serde_json::from_str`）。
pub trait SgpGateway: Send + Sync {
    /// 实现标识（日志/排障用）。
    fn name(&self) -> &'static str;

    /// 解析大区主机：`common=false` 取战绩（match-history）主机，`true` 取 common
    /// 主机。动态表 miss 时内部会触发一次远程拉取（见 [`sgp_league_servers`]）。
    async fn resolve_host(&self, platform_id: &str, common: bool) -> Option<String>;

    /// 发送带 Bearer 的 GET（默认实现含 3 次指数退避重试），成功返回响应 body 文本。
    async fn request(&self, host: &str, uri: &str, bearer: &str) -> Result<String, String>;
}

/// 默认实现：动态 league-servers 映射 + 标准 SGP HTTP。
pub struct DefaultSgpGateway;

impl SgpGateway for DefaultSgpGateway {
    fn name(&self) -> &'static str {
        "default"
    }

    async fn resolve_host(&self, platform_id: &str, common: bool) -> Option<String> {
        sgp_league_servers::resolve_sgp_host(platform_id, common).await
    }

    async fn request(&self, host: &str, uri: &str, bearer: &str) -> Result<String, String> {
        sgp_get_text(host, uri, bearer).await
    }
}

/// 进程级默认网关（业务层唯一访问点）。
static DEFAULT_GATEWAY: LazyLock<DefaultSgpGateway> = LazyLock::new(DefaultSgpGateway);

/// 获取当前网关（默认实现；测试/多后端场景可在此替换）。
pub fn gateway() -> &'static dyn SgpGateway {
    &*DEFAULT_GATEWAY
}
