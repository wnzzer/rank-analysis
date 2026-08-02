//! 选人期 BP 决策：类型、纯求值、进程内快照存储。
//!
//! 设计要点：
//! - 求值全程零 AI、零网络——规则是纯函数，OP.GG 数据由调用方注入
//! - 与 `rule_engine` 平行而非嵌套：本模块不修改 `rule_engine.rs`
//! - 快照是会话级单例、一次算完、纯展示

pub mod evaluate;
pub mod store;
pub mod types;
