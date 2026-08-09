//! # 对局回放命令
//!
//! 战绩详情页「观看回放」的后端。`.rofl` 只有游戏客户端能播放，所以整条链路走
//! LCU：预判可用性（无副作用）→ 请求下载 → 轮询状态 → 拉起客户端观看。
//!
//! 端点行为为国服真机实测结论，见
//! `docs/superpowers/specs/2026-07-27-match-replay-design.md`。

use serde::Serialize;

use crate::lcu::api::game_detail::GameDetail;
use crate::lcu::api::replay::{self, STATE_READY};

/// 回放可用性预判结果。
///
/// `reason` 仅在不可用时有值，直接作为按钮 tooltip 文案展示给用户。
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ReplayAvailability {
    pub playable: bool,
    pub reason: Option<String>,
}

impl ReplayAvailability {
    fn playable() -> Self {
        Self {
            playable: true,
            reason: None,
        }
    }

    fn blocked(reason: impl Into<String>) -> Self {
        Self {
            playable: false,
            reason: Some(reason.into()),
        }
    }
}

/// 取版本号的 `major.minor` 段用于兼容性比较。
///
/// 回放只能在**同一补丁**的客户端上播放，而补丁号只由前两段决定
/// （`16.14.794.9266` 与 `16.14.800.1234` 同属 16.14）。后两段是构建号，
/// 每次热更都会变，纳入比较会把同补丁的对局误判为不兼容。
fn patch_of(version: &str) -> Option<String> {
    let mut parts = version.split('.');
    let major = parts.next().filter(|s| !s.is_empty())?;
    let minor = parts.next().filter(|s| !s.is_empty())?;
    Some(format!("{}.{}", major, minor))
}

/// 依据客户端配置与对局版本判定回放是否可看。
///
/// 纯函数，便于覆盖各分支；顺序即优先级，第一个命中的原因即为结论。
fn judge_availability(
    config: &replay::ReplayConfiguration,
    game_version: &str,
) -> ReplayAvailability {
    if !config.is_replays_enabled {
        return ReplayAvailability::blocked("当前客户端未开启回放功能");
    }
    if config.is_playing_replay {
        return ReplayAvailability::blocked("正在播放其他回放，请先退出");
    }
    if config.is_playing_game {
        return ReplayAvailability::blocked("正在游戏中，无法观看回放");
    }

    // 版本号缺失时不阻拦：宁可让用户点一下拿到 LCU 的真实结果，
    // 也好过因为解析不出版本就武断禁用。
    let (Some(game_patch), Some(client_patch)) =
        (patch_of(game_version), patch_of(&config.game_version))
    else {
        return ReplayAvailability::playable();
    };

    if game_patch != client_patch {
        return ReplayAvailability::blocked(format!(
            "该对局为 {} 版本，当前客户端为 {}，无法观看回放",
            game_patch, client_patch
        ));
    }
    ReplayAvailability::playable()
}

/// 预判某局是否可以观看回放。**无副作用**，可在详情页打开时直接调用。
///
/// 刻意不查 `lol-replays/v1/metadata`：该端点在任何下载请求之前必然 404，
/// 想拿到状态就得先发起下载——那会让"打开详情页"变成"开始下载回放"。
///
/// # 参数
/// - `game_id`: 对局 ID
///
/// # 返回值
/// [`ReplayAvailability`]；客户端未运行等连接错误也归一成不可用 + 原因文案，
/// 不返回 `Err`，避免前端为"客户端没开"这种常态写额外的错误分支。
#[tauri::command]
pub async fn get_replay_availability(game_id: i64) -> ReplayAvailability {
    let config = match replay::get_replay_configuration().await {
        Ok(config) => config,
        Err(_) => return ReplayAvailability::blocked("未检测到游戏客户端，请先启动游戏"),
    };
    let game_version = match GameDetail::get_game_detail_by_id(&game_id).await {
        Ok(detail) => detail.game_version,
        // 拿不到对局详情不阻拦，交给点击后的真实流程给出结论
        Err(_) => String::new(),
    };
    judge_availability(&config, &game_version)
}

/// 请求下载该局回放。对已下载完成的回放重复调用是安全的。
#[tauri::command]
pub async fn start_replay_download(game_id: i64) -> Result<(), String> {
    replay::start_replay_download(game_id).await
}

/// 查询该局回放是否已就绪。
///
/// # 返回值
/// `true` 表示可以调用 [`watch_replay`] 了。尚未发起下载（LCU 404）或仍在
/// 准备中，均返回 `false`，由前端继续轮询直到超时。
#[tauri::command]
pub async fn is_replay_ready(game_id: i64) -> Result<bool, String> {
    let metadata = replay::get_replay_metadata(game_id).await?;
    Ok(metadata.is_some_and(|m| m.state == STATE_READY))
}

/// 拉起游戏客户端播放该局回放。
#[tauri::command]
pub async fn watch_replay(game_id: i64) -> Result<(), String> {
    replay::watch_replay(game_id).await?;
    crate::observability::track_feature("watch_replay");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(version: &str) -> replay::ReplayConfiguration {
        replay::ReplayConfiguration {
            game_version: version.to_string(),
            is_replays_enabled: true,
            is_playing_replay: false,
            is_playing_game: false,
        }
    }

    #[test]
    fn patch_ignores_build_numbers() {
        assert_eq!(patch_of("16.14.794.9266").as_deref(), Some("16.14"));
        // 同补丁不同构建号必须判定为同一补丁
        assert_eq!(patch_of("16.14.800.1111"), patch_of("16.14.794.9266"));
    }

    #[test]
    fn patch_rejects_malformed_versions() {
        assert_eq!(patch_of(""), None);
        assert_eq!(patch_of("16"), None);
        assert_eq!(patch_of("16."), None);
    }

    #[test]
    fn same_patch_is_playable() {
        let verdict = judge_availability(&config("16.14.794.9266"), "16.14.800.1111");
        assert_eq!(verdict, ReplayAvailability::playable());
    }

    #[test]
    fn older_patch_is_blocked_with_both_versions_in_reason() {
        let verdict = judge_availability(&config("16.14.794.9266"), "16.13.700.1000");
        assert!(!verdict.playable);
        let reason = verdict.reason.unwrap();
        assert!(reason.contains("16.13"), "应说明对局版本: {}", reason);
        assert!(reason.contains("16.14"), "应说明客户端版本: {}", reason);
    }

    #[test]
    fn disabled_replays_blocked_before_version_check() {
        let mut cfg = config("16.14.794.9266");
        cfg.is_replays_enabled = false;
        // 即使版本一致，也应因功能未开启而拦下
        let verdict = judge_availability(&cfg, "16.14.794.9266");
        assert_eq!(verdict.reason.as_deref(), Some("当前客户端未开启回放功能"));
    }

    #[test]
    fn playing_replay_blocks() {
        let mut cfg = config("16.14.794.9266");
        cfg.is_playing_replay = true;
        let verdict = judge_availability(&cfg, "16.14.794.9266");
        assert!(!verdict.playable);
        assert!(verdict.reason.unwrap().contains("正在播放其他回放"));
    }

    #[test]
    fn missing_game_version_does_not_block() {
        // 解析不出版本时不武断禁用，让用户点一下拿 LCU 的真实结果
        let verdict = judge_availability(&config("16.14.794.9266"), "");
        assert_eq!(verdict, ReplayAvailability::playable());
    }
}
