//! # SGP 跨区查询命令模块
//!
//! 「全区战绩」与「跨区段位」对外命令：大区列表、当前登录大区、按 puuid 拉取任意
//! 大区战绩、按 puuid 拉取任意大区段位。本地 LCU 只能查当前登录区，这里经 SGP
//! 网关（[`crate::lcu::api::sgp`]）跨区。

use crate::constant;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::rank::Rank;
use crate::lcu::api::sgp;
use serde::Serialize;
use std::collections::HashMap;
/// 大区选项（前端下拉用）：platformId + 中文名。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionOption {
    /// platformId，如 `TJ100`（作为后续查询的 `region` 参数）
    pub value: String,
    /// 中文名，如 `联盟四区`
    pub label: String,
}

/// 大区展示顺序：腾讯官方习惯（艾欧尼亚→黑玫→联盟一至五区→峡谷之巅），
/// 随后国际区（对齐 LeagueAkari builtin 配置的顺序），而非 platformId 字典序。
const REGION_ORDER: [&str; 24] = [
    "HN1", "HN10", "NJ100", "GZ100", "CQ100", "TJ100", "TJ101", "BGP2", "TW2", "SG2", "PH2",
    "VN2", "PBE", "EUW", "JP", "RU", "BR1", "OC1", "TR1", "LA1", "LA2", "NA1", "TH2", "KR",
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
    crate::observability::track_feature("sgp_cross_region_query");
    sgp::get_match_history_by_name(&region, &name, beg_index, count).await
}

/// 按大区 + gameId 拉取单局 SGP 详情(帧数据/事件流/伤害明细)。
///
/// 供详情页高级 tab(事件/时间线/出装)消费;返回类型化结构,字段缺失已 default 容错。
#[tauri::command]
pub async fn get_sgp_match_detail(
    region: String,
    game_id: i64,
) -> Result<sgp::SgpGameDetailResponse, String> {
    crate::observability::track_feature("sgp_match_detail");
    sgp::fetch_match_detail(&region, game_id).await
}

/// 跨区按「名字#TAG」查玩家段位。
///
/// # 流程
/// `名字#TAG` → Riot Client 解析全局 puuid → 目标大区 SGP `leagues-ledge`
/// rankedStats 直查 → 映射为现有 `Rank`（复用前端展示链：图标/中文/胜点）。
/// 未定级/该大区无记录返回空 Rank（各队列 tier 为空，前端显示「无段位」）。
///
/// # 参数
/// - `region`: 目标大区 platformId（如 `HN10` / `NA1`），来自 [`get_sgp_regions`]
/// - `name`: 完整 Riot ID `名字#TAG`
#[tauri::command]
pub async fn get_sgp_rank_by_name(region: String, name: String) -> Result<Rank, String> {
    crate::observability::track_feature("sgp_cross_region_rank");
    sgp::get_rank_by_name(&region, &name).await
}

/// 跨区批量按 PUUID 查段位：单次 IPC 返回多人的段位（SGP 侧 30min 缓存兜底）。
///
/// 跨区战绩详情页 10 人场景替代逐个 IPC（语义对齐 `get_ranks_by_puuids`）：
/// 单人失败返回 None 不拖垮整批。
///
/// # 参数
/// - `region`: 目标大区 platformId
/// - `puuids`: 召唤师 PUUID 列表
///
/// # 返回值
/// puuid → 段位信息；查询失败/无数据/未定级的玩家为 `None`
#[tauri::command]
pub async fn get_sgp_ranks_by_puuids(
    region: String,
    puuids: Vec<String>,
) -> HashMap<String, Option<Rank>> {
    let results = futures::future::join_all(puuids.into_iter().map(|puuid| {
        let region = region.clone();
        async move {
            let rank = sgp::fetch_ranked_stats(&region, &puuid)
                .await
                .ok()
                .map(|stats| sgp::map_sgp_ranked_stats_to_rank(&stats));
            (puuid, rank)
        }
    }))
    .await;
    results.into_iter().collect()
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
        // 官方习惯顺序：艾欧尼亚打头、腾讯区后接国际区、韩国收尾
        assert_eq!(regions.first().unwrap().value, "HN1");
        assert_eq!(regions.first().unwrap().label, "艾欧尼亚");
        assert_eq!(regions.last().unwrap().value, "KR");
        assert_eq!(regions.last().unwrap().label, "韩国");
        // 腾讯 8 区都在国际区之前
        let tencent_last = regions.iter().position(|r| r.value == "BGP2").unwrap();
        let intl_first = regions.iter().position(|r| r.value == "TW2").unwrap();
        assert!(tencent_last < intl_first);
    }

    #[test]
    fn regions_cover_international_servers_with_cn_names() {
        let regions = get_sgp_regions();
        for pid in [
            "TW2", "SG2", "PH2", "VN2", "PBE", "EUW", "JP", "RU", "BR1", "OC1", "TR1", "LA1",
            "LA2", "NA1", "TH2", "KR",
        ] {
            let opt = regions.iter().find(|r| r.value == pid).unwrap_or_else(|| panic!("缺国际区 {pid}"));
            assert!(!opt.label.is_empty(), "国际区 {pid} 中文名为空");
        }
    }
}
