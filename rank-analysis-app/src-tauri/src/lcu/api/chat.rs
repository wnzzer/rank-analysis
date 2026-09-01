//! # LCU 聊天/社交 API
//!
//! 对应 `lol-chat` 相关接口,目前只封装好友列表(供 Header 超级搜索做本地候选)。

use crate::lcu::util::http::lcu_get;
use serde::{Deserialize, Serialize};

/// 好友条目(超级搜索候选用的精简形态)。
///
/// LCU `/lol-chat/v1/friends` 返回字段较多,这里只取检索需要的三个;
/// 注意 LCU 侧标签字段名是 `gameTag` 而非 `tagLine`。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub game_name: String,
    #[serde(rename(deserialize = "gameTag"))]
    pub tag_line: String,
    #[serde(default)]
    pub puuid: String,
}

/// 获取当前登录账号的好友列表。
///
/// # 返回值
/// - `Ok(Vec<Friend>)`: 好友列表(已过滤掉没有游戏名的条目,如群聊/系统账号)
/// - `Err(String)`: LCU 未连接或请求失败
pub async fn get_friends() -> Result<Vec<Friend>, String> {
    let friends = lcu_get::<Vec<Friend>>("lol-chat/v1/friends").await?;
    Ok(friends
        .into_iter()
        .filter(|f| !f.game_name.trim().is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_deserializes_lcu_game_tag_field() {
        let raw = r#"{
            "gameName": "某好友",
            "gameTag": "12345",
            "puuid": "abc-def",
            "availability": "online",
            "icon": 123
        }"#;
        let f: Friend = serde_json::from_str(raw).expect("好友 JSON 应可反序列化");
        assert_eq!(f.game_name, "某好友");
        assert_eq!(f.tag_line, "12345");
        assert_eq!(f.puuid, "abc-def");
    }

    #[test]
    fn friend_serializes_tag_line_for_frontend() {
        let f = Friend {
            game_name: "某好友".into(),
            tag_line: "12345".into(),
            puuid: "p".into(),
        };
        let json = serde_json::to_string(&f).unwrap();
        // 前端约定统一用 tagLine,不暴露 LCU 的 gameTag 命名
        assert!(json.contains("\"gameName\""));
        assert!(json.contains("\"tagLine\""));
        assert!(!json.contains("\"gameTag\""));
    }

    #[test]
    fn friend_missing_puuid_defaults_to_empty() {
        let raw = r#"{"gameName": "某好友", "gameTag": "12345"}"#;
        let f: Friend = serde_json::from_str(raw).expect("缺 puuid 也应可反序列化");
        assert_eq!(f.puuid, "");
    }
}
