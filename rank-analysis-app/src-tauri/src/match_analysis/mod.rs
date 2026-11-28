//! # 对局分析核心（子项目 1：TS `src/services/ai/shared/` 迁移到 Rust）
//!
//! 设计见 `docs/superpowers/specs/2026-11-28-rust-match-analysis-design.md`。P1 落地的子模块：
//!
//! - `js`：复刻 JS 取整行为（`Math.round` / `toFixed`）
//! - `mode`：模式判定（TS `modeContext.ts`）
//! - `position`：分路（TS `positionInfer.ts` / `positionAssign.ts` / `snapshot.ts` 分路部分）
//! - `lane_facts`：对位差值与位置基准（TS `laneFacts.ts`）
//! - `input`：中立输入 `MatchInput` 与 LCU / SGP 适配层（含时间线 puuid remap）
//! - `snapshot`：快照的玩家 / 队伍部分，P1 对外入口 `build_snapshot`
//! - `parity`：与 TS 黄金输出对拍、预期差异登记表
//!
//! 本模块暂无调用方（子项目 2 才接 command），线上行为不变。

pub mod js;
pub mod lane_facts;
pub mod mode;

pub mod position;
