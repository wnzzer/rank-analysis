//! # SGP 跨区查询命令模块
//!
//! 「全区战绩」对外命令：大区列表、当前登录大区、按 puuid 拉取任意大区战绩。
//! 本地 LCU 只能查当前登录区，这里经 SGP 网关（[`crate::lcu::api::sgp`]）跨区。

use crate::constant;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::sgp;
use serde::Serialize;

/// 大区选项（前端下拉用）：platformId + 中文名。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionOption {
    /// platformId，如 `TJ100`（作为后续查询的 `region` 参数）
    pub value: String,
    /// 中文名，如 `联盟四区`
    pub label: String,
}

/// 大区展示顺序（官方习惯：艾欧尼亚→黑玫→联盟一至五区→峡谷之巅），而非 platformId 字典序。
const REGION_ORDER: [&str; 8] = [
    "HN1", "HN10", "NJ100", "GZ100", "CQ100", "TJ100", "TJ101", "BGP2",
];

/// 支持跨区查询的大区列表（有 SGP 主机映射的腾讯大区），按官方习惯顺序排列。
#[tauri::command]
pub fn get_sgp_regions() -> Vec<RegionOption> {
    let mut regions: Vec<RegionOption> = constant::game::SGP_PLATFORM_TO_HOST
        .keys()
        .map(|&pid| RegionOption {
            value: pid.to_string(),
            label: constant::game::get_sgp_server_id_to_name(pid)
                .unwrap_or(pid)
                .to_string(),
        })
        .collect();
    regions.sort_by_key(|r| {
        REGION_ORDER
            .iter()
            .position(|&p| p == r.value)
            .unwrap_or(usize::MAX)
    });
    regions
}

/// 当前登录客户端所在大区的 platformId（如 `TJ100`）。
///
/// 供前端把大区选择器默认选中「当前区」，也用于判断某玩家是否与本区同区。
#[tauri::command]
pub async fn get_current_sgp_region() -> Result<String, String> {
    sgp::get_current_platform_id().await
}

/// 全区按「名字#TAG」查战绩（映射为前端可直接渲染的 `MatchHistory`）。
///
/// # 参数
/// - `region`: 目标大区 platformId（如 `HN10`），来自 [`get_sgp_regions`]
/// - `name`: 完整 Riot ID `名字#TAG`（跨区解析 puuid 必须带 TAG）
/// - `beg_index` / `count`: 分页起点与条数
///
/// # 流程
/// `名字#TAG` → Riot Client 解析全局 puuid → 目标大区 SGP 拉战绩 → 映射为
/// `MatchHistory`（`participants[0]`=被查玩家，全队进 `game_detail`，本地算占比/中文名）。
/// 段位/标签不跨区，故只出战绩列表。
#[tauri::command]
pub async fn get_sgp_match_history_by_name(
    region: String,
    name: String,
    beg_index: i32,
    count: i32,
) -> Result<MatchHistory, String> {
    sgp::get_match_history_by_name(&region, &name, beg_index, count).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_in_official_order_with_cn_names() {
        let regions = get_sgp_regions();
        // 带中文名
        let tj100 = regions
            .iter()
            .find(|r| r.value == "TJ100")
            .expect("含 TJ100");
        assert_eq!(tj100.label, "联盟四区");
        assert!(regions
            .iter()
            .any(|r| r.value == "HN10" && r.label == "黑色玫瑰"));
        // 官方习惯顺序：艾欧尼亚打头、峡谷之巅收尾
        assert_eq!(regions.first().unwrap().value, "HN1");
        assert_eq!(regions.first().unwrap().label, "艾欧尼亚");
        assert_eq!(regions.last().unwrap().value, "BGP2");
        assert_eq!(regions.last().unwrap().label, "峡谷之巅");
    }
}
