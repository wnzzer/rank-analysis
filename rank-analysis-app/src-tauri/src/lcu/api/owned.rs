//! # LCU 英雄拥有信息 API
//!
//! 对应 `lol-champions/v1/owned-champions-minimal`：查询当前登录账号的已拥有英雄。
//!
//! 排位选人只能选已拥有的英雄，推荐面板的候选池需要先按拥有状态收敛，
//! 避免推荐一个玩家根本没法选的英雄。

use serde::{Deserialize, Serialize};

use crate::lcu::util::http::lcu_get;

/// 已拥有英雄列表的单条记录（owned-champions-minimal 的最小子集）。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OwnedChampion {
    /// 英雄 ID
    pub id: i32,
    /// 是否已拥有（未购买且非免费轮换时为 false）
    pub owned: bool,
}

/// 拉取当前账号的已拥有英雄 ID 列表。
///
/// # 返回值
///
/// - `Ok(Vec<i32>)`: 已拥有的英雄 ID（保持 LCU 返回顺序）
/// - `Err(String)`: LCU 请求失败或响应解析失败
///
/// 失败时调用方应降级为「不筛拥有状态」而不是把候选池清空——拿不到拥有数据
/// 只是少一层过滤，推荐仍应正常可用。
pub async fn get_owned_champion_ids() -> Result<Vec<i32>, String> {
    let champions =
        lcu_get::<Vec<OwnedChampion>>("lol-champions/v1/owned-champions-minimal").await?;
    Ok(champions
        .into_iter()
        .filter(|c| c.owned)
        .map(|c| c.id)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owned_champion_parses_minimal_response() {
        let body = r#"[
            {"id": 1, "name": "Annie", "owned": true},
            {"id": 86, "name": "Garen", "owned": false},
            {"id": 103, "name": "Ahri", "owned": true}
        ]"#;
        let parsed: Vec<OwnedChampion> = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.len(), 3);
        assert!(parsed[0].owned);
        assert!(!parsed[1].owned);
        assert_eq!(parsed[0].id, 1);
    }

    #[test]
    fn filters_to_owned_ids() {
        let champions = vec![
            OwnedChampion { id: 1, owned: true },
            OwnedChampion {
                id: 86,
                owned: false,
            },
            OwnedChampion {
                id: 103,
                owned: true,
            },
        ];
        let ids: Vec<i32> = champions
            .into_iter()
            .filter(|c| c.owned)
            .map(|c| c.id)
            .collect();
        assert_eq!(ids, vec![1, 103]);
    }
}
