//! # Config 命令模块
//!
//! 提供配置读写、HTTP 服务端口查询、英雄/队列等选项数据。
//!
//! ## 主要功能
//!
//! - **配置读写**: 通过 Tauri 命令暴露给前端
//! - **端口查询**: 获取 HTTP 静态资源服务器端口
//! - **选项数据**: 提供英雄列表、游戏模式列表等选项数据
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 读取配置
//! let value = get_config("settings.theme".to_string()).await?;
//!
//! // 写入配置
//! put_config("settings.theme".to_string(), Value::String("dark".to_string())).await?;
//!
//! // 获取英雄选项
//! let champions = get_champion_options()?;
//!
//! // 获取游戏模式选项
//! let modes = get_game_modes();
//! ```

use crate::lcu::api::asset;
use crate::state::AppState;
use crate::{config, constant};
use serde::Serialize;

/// 写入配置项。
///
/// # 参数
///
/// - `key`: 配置键名
/// - `value`: 配置值
///
/// # 返回值
///
/// - `Ok(())`: 写入成功
/// - `Err(String)`: 写入失败时的错误信息
#[tauri::command]
pub async fn put_config(key: String, value: config::Value) -> Result<(), String> {
    config::put_config(key, value).await
}

/// 读取配置项。
///
/// # 参数
///
/// - `key`: 配置键名
///
/// # 返回值
///
/// - `Ok(Value)`: 配置值
/// - `Err(String)`: 读取失败时的错误信息
#[tauri::command]
pub async fn get_config(key: String) -> Result<config::Value, String> {
    config::get_config(&key).await
}

/// 获取当前 HTTP 服务端口（用于前端请求静态资源等）。
///
/// # 参数
///
/// - `state`: Tauri 应用状态
///
/// # 返回值
///
/// - `Ok(i32)`: HTTP 服务端口
/// - `Err(String)`: 端口未设置时的错误信息
#[tauri::command]
pub async fn get_http_server_port(state: tauri::State<'_, AppState>) -> Result<i32, String> {
    state
        .http_port
        .get()
        .copied()
        .map(|p| p as i32)
        .ok_or_else(|| "http_server_port not set".to_string())
}

/// 英雄选项，用于下拉/选择器：显示名、ID、真实名、昵称。
///
/// # 字段说明
///
/// - `label`: 显示名称（英雄中文名）
/// - `value`: 英雄 ID
/// - `real_name`: 英雄真实名称（英文原名）
/// - `nickname`: 英雄昵称（如 "卡特" 对应卡特琳娜）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionOption {
    /// 显示名称（英雄中文名）
    pub label: String,
    /// 英雄 ID
    pub value: i64,
    /// 英雄真实名称（英文原名）
    pub real_name: String,
    /// 英雄昵称（如 "卡特"）
    pub nickname: String,
}

/// 获取所有英雄选项列表（用于筛选等）。
///
/// # 返回值
///
/// - `Ok(Vec<ChampionOption>)`: 英雄选项列表
/// - `Err(String)`: 获取失败时的错误信息
///
/// # 过滤规则
///
/// - 排除名称包含"末日人机"的英雄（特殊模式英雄）
/// - 使用 `CHAMPION_MAP` 获取英雄昵称
#[tauri::command]
pub fn get_champion_options() -> Result<Vec<ChampionOption>, String> {
    let mut options = vec![];
    for (id, item) in asset::CHAMPION_CACHE.read().unwrap().iter() {
        let champion = item.clone();
        let known_alias = constant::game::CHAMPION_MAP
            .get(&(*id as u16))
            .map(|c| c.nickname.to_string())
            .unwrap_or_else(|| champion.alias.clone());

        // 末日人机不加入选项
        if champion.name.contains("末日人机") {
            continue;
        }
        options.push(ChampionOption {
            label: champion.name,
            value: champion.id,
            real_name: champion.description,
            nickname: format!("{} ({})", known_alias, champion.alias),
        });
    }

    Ok(options)
}

/// 对局模式选项：显示名与队列 ID，用于筛选等。
///
/// # 字段说明
///
/// - `label`: 显示名称（模式中文名）
/// - `value`: 队列 ID
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameModeOption {
    /// 显示名称（模式中文名）
    pub label: String,
    /// 队列 ID
    pub value: i32,
}

/// 获取所有对局模式选项（含「全部」及各队列中文名）。
///
/// # 返回值
///
/// 游戏模式选项列表，第一项为「全部」（ID 为 0），其余按 ID 排序
///
/// # 去重规则
///
/// 多个队列 ID 属于同一玩法分组（如新旧人机队列同难度、430/490 均为「匹配」），
/// 选项按 `canonical_queue_id` 分组去重，保留最小 ID（即代表 ID）；
/// 过滤对局时经 `queue_ids_same_group` 按分组匹配
#[tauri::command]
pub fn get_game_modes() -> Vec<GameModeOption> {
    let mut options = vec![GameModeOption {
        label: "全部".to_string(),
        value: 0,
    }];

    let mut modes: Vec<GameModeOption> = constant::game::QUEUE_ID_TO_CN
        .entries()
        .filter(|&(k, _)| *k != 0)
        .map(|(k, v)| GameModeOption {
            label: v.to_string(),
            value: *k as i32,
        })
        .collect();

    modes.sort_by_key(|k| k.value);
    let mut seen = std::collections::HashSet::new();
    modes.retain(|m| seen.insert(constant::game::canonical_queue_id(m.value as u32)));
    options.extend(modes);

    options
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 模式选项不应出现重复中文名（人机有 6 个队列 ID、匹配有 2 个）
    #[test]
    fn game_modes_should_have_unique_labels() {
        let options = get_game_modes();
        let mut labels: Vec<&str> = options.iter().map(|o| o.label.as_str()).collect();
        let total = labels.len();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), total, "模式选项存在重复中文名");
    }

    #[test]
    fn game_modes_should_start_with_all_option() {
        let options = get_game_modes();
        assert_eq!(options[0].label, "全部");
        assert_eq!(options[0].value, 0);
    }
}
