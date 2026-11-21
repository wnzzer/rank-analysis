//! 英雄伤害类型表：英雄 ID → 物理伤害占比。
//!
//! 来源是客户端英雄详情 `lol-game-data/assets/v1/champions/{id}.json` 的
//! `tacticalInfo.damageType`（`kPhysical` / `kMagic` / `kMixed`）。英雄列表接口不带这个
//! 字段，只能逐个取详情，所以按需取、进程内永久缓存——伤害类型只随版本更新变化，
//! 重启应用即刷新。
//!
//! 取不到的英雄不进表，调用方按「未知」处理（不参与阵容评价），不猜默认值。

use std::collections::HashMap;
use std::sync::{LazyLock, PoisonError, RwLock};

use serde::Deserialize;

use crate::lcu::util::http::lcu_get;

/// 三档伤害类型对应的物理占比。客户端只给定性分类，这里取代表值。
const PHYSICAL_SHARE: f64 = 0.9;
const MAGIC_SHARE: f64 = 0.1;
const MIXED_SHARE: f64 = 0.5;

static TABLE: LazyLock<RwLock<HashMap<i32, f64>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChampionDetail {
    #[serde(default)]
    tactical_info: TacticalInfo,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TacticalInfo {
    #[serde(default)]
    damage_type: String,
}

/// 客户端的伤害类型标记 → 物理占比；未知标记返回 None。
pub fn physical_share_of(damage_type: &str) -> Option<f64> {
    match damage_type {
        "kPhysical" => Some(PHYSICAL_SHARE),
        "kMagic" => Some(MAGIC_SHARE),
        "kMixed" => Some(MIXED_SHARE),
        _ => None,
    }
}

/// 当前已缓存的整张表。
pub fn table() -> HashMap<i32, f64> {
    TABLE.read().unwrap_or_else(PoisonError::into_inner).clone()
}

/// 把还没缓存的英雄补进表里。
///
/// 逐个请求本地客户端，失败的跳过、下次再试。单次调用最多取 `limit` 个，
/// 避免首次进选人期时一口气发出上百个请求卡住求值循环。
///
/// # 参数
/// - `ids`: 需要伤害类型的英雄
/// - `limit`: 本次最多取多少个
pub async fn ensure(ids: &[i32], limit: usize) {
    let missing: Vec<i32> = {
        let table = TABLE.read().unwrap_or_else(PoisonError::into_inner);
        let mut seen = std::collections::HashSet::new();
        ids.iter()
            .copied()
            .filter(|id| *id > 0 && !table.contains_key(id) && seen.insert(*id))
            .take(limit)
            .collect()
    };
    for id in missing {
        let uri = format!("lol-game-data/assets/v1/champions/{}.json", id);
        let share = match lcu_get::<ChampionDetail>(&uri).await {
            Ok(detail) => physical_share_of(&detail.tactical_info.damage_type),
            Err(e) => {
                log::debug!("BP damage table: champion {} detail unavailable: {}", id, e);
                None
            }
        };
        if let Some(share) = share {
            TABLE
                .write()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(id, share);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_map_client_damage_types_to_physical_share() {
        assert_eq!(physical_share_of("kPhysical"), Some(0.9));
        assert_eq!(physical_share_of("kMagic"), Some(0.1));
        assert_eq!(physical_share_of("kMixed"), Some(0.5));
        assert_eq!(physical_share_of(""), None);
        assert_eq!(physical_share_of("kTrue"), None);
    }

    #[test]
    fn should_parse_damage_type_from_champion_detail() {
        let raw = r#"{"id":157,"tacticalInfo":{"style":3,"difficulty":3,"damageType":"kPhysical","attackType":"melee"}}"#;

        let detail: ChampionDetail = serde_json::from_str(raw).unwrap();

        assert_eq!(detail.tactical_info.damage_type, "kPhysical");
    }

    #[test]
    fn should_tolerate_detail_without_tactical_info() {
        let detail: ChampionDetail = serde_json::from_str(r#"{"id":1}"#).unwrap();

        assert_eq!(physical_share_of(&detail.tactical_info.damage_type), None);
    }
}
