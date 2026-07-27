//! # LCU 回放 API
//!
//! 对应客户端的 `lol-replays` 插件。`.rofl` 是 Riot 私有格式，只有游戏客户端本身
//! 能播放，所以观看回放的唯一路径就是这组接口：下载 → 查状态 → 拉起客户端观看。
//!
//! 端点形状为 2026-07-27 国服（TJ100，客户端 `16.14.794.9266`）真机实测结论，
//! 详见 `docs/superpowers/specs/2026-07-27-match-replay-design.md`。

use serde::{Deserialize, Serialize};

use crate::lcu::util::http::{lcu_get_with_status, lcu_post_with_status};

/// 客户端回放功能的全局配置。
///
/// 字段取实测返回中本功能真正用得到的部分；其余（`isInTournament` 等）忽略。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ReplayConfiguration {
    /// 客户端当前版本，形如 `16.14.794.9266`。与对局详情的 `gameVersion` 同格式。
    #[serde(rename = "gameVersion", default)]
    pub game_version: String,
    /// 客户端是否启用了回放功能。
    #[serde(rename = "isReplaysEnabled", default)]
    pub is_replays_enabled: bool,
    /// 是否正在播放某个回放（此时再拉起新回放没有意义）。
    #[serde(rename = "isPlayingReplay", default)]
    pub is_playing_replay: bool,
    /// 是否正在游戏中。
    #[serde(rename = "isPlayingGame", default)]
    pub is_playing_game: bool,
}

/// 单局回放的下载元数据。
///
/// **注意 `download_progress` 不是百分比**：实测 `checking` 态会返回
/// `203028176` 这类垃圾值，只有 `state == "watch"` 时才有意义。因此本类型
/// 只把它作为诊断信息保留，UI 一律不据此渲染进度。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ReplayMetadata {
    #[serde(rename = "gameId", default)]
    pub game_id: i64,
    /// 实测可见取值：`watch`（已就绪）、`checking`（查询中，也是无效对局的永久停留态）。
    #[serde(default)]
    pub state: String,
    #[serde(rename = "downloadProgress", default)]
    pub download_progress: i64,
}

/// `state` 表示回放已就绪、可以直接观看。
///
/// 唯一被当作"成功终态"的取值。其余取值（含未实测到的 `download` /
/// `downloading` / `lost` / `incompatible`）一律视为"尚未就绪"，由调用方
/// 继续轮询直到超时——这样未知取值不会引发错误行为，最坏只是走超时文案。
pub const STATE_READY: &str = "watch";

/// 动作类端点的请求体。
///
/// 客户端自身调用时会带 `componentType`；如实附带，避免国服实现对缺字段的请求
/// 返回 400。实测带 `"string"` 可正常返回 204。
#[derive(Serialize)]
struct ReplayActionBody {
    #[serde(rename = "componentType")]
    component_type: &'static str,
}

impl Default for ReplayActionBody {
    fn default() -> Self {
        Self {
            component_type: "string",
        }
    }
}

/// 读取回放全局配置。
///
/// # 错误
/// 客户端未运行时返回 `Err`——这是"未检测到游戏客户端"的判定依据。
pub async fn get_replay_configuration() -> Result<ReplayConfiguration, String> {
    let (status, body) = lcu_get_with_status("lol-replays/v1/configuration").await?;
    if status != 200 {
        return Err(format!("获取回放配置失败（HTTP {}）", status));
    }
    serde_json::from_str(&body).map_err(|e| format!("解析回放配置失败: {}", e))
}

/// 查询单局回放的下载状态。
///
/// # 返回值
/// - `Ok(Some(metadata))`: 已有本地元数据
/// - `Ok(None)`: 尚未对该局发起过下载（LCU 返回 404，属正常情况而非错误）
///
/// LCU 在**任何 download 请求之前**必然对该局返回 404，body 明说
/// "Plugin found no local metadata"。所以 404 必须归一成 `None` 而不是错误，
/// 否则会把"还没开始下载"误报成故障。
pub async fn get_replay_metadata(game_id: i64) -> Result<Option<ReplayMetadata>, String> {
    let uri = format!("lol-replays/v1/metadata/{}", game_id);
    let (status, body) = lcu_get_with_status(&uri).await?;
    match status {
        200 => serde_json::from_str(&body)
            .map(Some)
            .map_err(|e| format!("解析回放状态失败: {}", e)),
        404 => Ok(None),
        other => Err(format!("查询回放状态失败（HTTP {}）", other)),
    }
}

/// 请求下载指定对局的回放。
///
/// 实测成功返回 204。**204 不代表该局真的有回放**——对任意 gameId（哪怕 `1`）
/// 都会返回 204，是否真的可用要靠随后轮询 [`get_replay_metadata`] 判断。
/// 对已下载完成的回放重复调用是安全的，元数据会立刻变为 [`STATE_READY`]。
pub async fn start_replay_download(game_id: i64) -> Result<(), String> {
    let uri = format!("lol-replays/v1/rofls/{}/download", game_id);
    let (status, body) = lcu_post_with_status(&uri, &ReplayActionBody::default()).await?;
    expect_no_content(status, &body, "请求下载回放失败")
}

/// 拉起游戏客户端播放指定对局的回放。
///
/// 实测成功返回 204，随后 `League of Legends.exe` 启动、配置里的
/// `isPlayingReplay` 转为 `true`。仅应在元数据为 [`STATE_READY`] 后调用。
pub async fn watch_replay(game_id: i64) -> Result<(), String> {
    let uri = format!("lol-replays/v1/rofls/{}/watch", game_id);
    let (status, body) = lcu_post_with_status(&uri, &ReplayActionBody::default()).await?;
    expect_no_content(status, &body, "拉起回放失败")
}

/// 校验动作类端点的响应：2xx 视为成功，其余带上 LCU 的原始 message 便于排错。
fn expect_no_content(status: u16, body: &str, context: &str) -> Result<(), String> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    // LCU 的错误 body 形如 {"errorCode":"...","message":"..."}，取 message 更可读
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("message")?.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("HTTP {}", status));
    Err(format!("{}：{}", context, detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expect_no_content_accepts_204() {
        assert!(expect_no_content(204, "", "x").is_ok());
        assert!(expect_no_content(200, "{}", "x").is_ok());
    }

    #[test]
    fn expect_no_content_surfaces_lcu_message() {
        let body = r#"{"errorCode":"RESOURCE_NOT_FOUND","message":"Invalid URI format"}"#;
        let err = expect_no_content(404, body, "拉起回放失败").unwrap_err();
        assert!(err.contains("拉起回放失败"));
        assert!(err.contains("Invalid URI format"));
    }

    #[test]
    fn expect_no_content_falls_back_to_status_when_body_unparsable() {
        let err = expect_no_content(500, "<html>", "请求下载回放失败").unwrap_err();
        assert!(err.contains("HTTP 500"));
    }

    #[test]
    fn metadata_deserializes_observed_payload() {
        // 实测 payload（2026-07-27 国服）
        let raw = r#"{"downloadProgress":100,"gameId":300934069971,"state":"watch"}"#;
        let meta: ReplayMetadata = serde_json::from_str(raw).unwrap();
        assert_eq!(meta.game_id, 300934069971);
        assert_eq!(meta.state, STATE_READY);
    }

    #[test]
    fn configuration_deserializes_observed_payload_ignoring_extra_fields() {
        let raw = r#"{"gameVersion":"16.14.794.9266","isInTournament":false,
            "isReplaysEnabled":true,"isPlayingReplay":false,"isPlayingGame":false,
            "minutesUntilReplayConsideredLost":30}"#;
        let cfg: ReplayConfiguration = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.game_version, "16.14.794.9266");
        assert!(cfg.is_replays_enabled);
        assert!(!cfg.is_playing_replay);
    }
}
