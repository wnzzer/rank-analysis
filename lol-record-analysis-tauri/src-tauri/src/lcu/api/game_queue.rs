//! # LCU 队列表
//!
//! 从客户端 `/lol-game-queues/v1/queues` 拉取队列表，与人工维护的
//! [`QUEUE_ID_TO_CN`] **各司其职**。
//!
//! ## 解决什么问题
//!
//! Riot 每加一个模式就多一个 queueId，纯硬编码必然漂移——实测已出现：
//!
//! - **缺失**：queueId 400（现行匹配队列）不在表里，打匹配时对局页「模式」显示「未知模式」
//! - **过时**：筛选下拉里还列着已下线的盲选 430
//!
//! ## 两张表的分工
//!
//! | | 人工表 [`QUEUE_ID_TO_CN`] | LCU 队列表 |
//! |---|---|---|
//! | 管什么 | 常用队列**怎么显示** | **别漏**任何队列 / 下拉**列哪些** |
//! | 优先级 | 高（[`queue_name`] 先查它） | 补空缺 |
//! | 为什么 | 短名适配窄列，且不随客户端文案变动 | 随版本自动更新，新模式无需改代码 |
//!
//! 具体取舍见 [`queue_name`] 与 [`visible_queues`] 的文档。LCU 未连接时
//! 名称解析仍走人工表，下拉回落硬编码列表——**离线不降级**。
//!
//! [`QUEUE_ID_TO_CN`]: crate::constant::game::QUEUE_ID_TO_CN

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

/// LCU 队列条目（只取用得上的字段）。
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LcuQueue {
    id: i64,
    /// 完整名，如「排位赛 单排/双排」
    #[serde(default)]
    name: String,
    /// 短名，多数队列与 `name` 相同；个别更适合展示（如 3260「经典模式 (自定义 自选)」）
    #[serde(default)]
    short_name: String,
    /// 玩法，如 CLASSIC / ARAM / CHERRY / TFT
    #[serde(default)]
    game_mode: String,
    /// 该队列当前是否在客户端可选。已下线的老队列为 false，
    /// 但老战绩里仍会出现，故**只用于筛选下拉，不用于名称解析**。
    #[serde(default)]
    is_visible: bool,
    /// 是否为自定义房队列。客户端里有 13 个（召唤师峡谷/嚎哭深渊 的自选、征召、
    /// 全随机、比赛…），玩家不会拿它们筛战绩，混进下拉只会淹没常用模式。
    #[serde(default)]
    is_custom: bool,
}

/// 缓存里的队列信息。
#[derive(Debug, Clone)]
pub struct QueueInfo {
    pub name: String,
    pub game_mode: String,
    pub is_visible: bool,
    pub is_custom: bool,
}

static QUEUE_CACHE: LazyLock<RwLock<HashMap<u32, QueueInfo>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// 缓存是否为空（未拉取 / 拉取失败）。
pub fn cache_is_empty() -> bool {
    QUEUE_CACHE.read().map(|g| g.is_empty()).unwrap_or(true)
}

/// 从 LCU 拉取队列表并填充缓存。幂等：已有数据时直接返回。
///
/// 由 `game_state_monitor` 在「LCU 已连接」时调用，与静态资源缓存同一时机。
pub async fn init() {
    if !cache_is_empty() {
        return;
    }
    match crate::lcu::util::http::lcu_get::<Vec<LcuQueue>>("lol-game-queues/v1/queues").await {
        Ok(queues) => {
            let map: HashMap<u32, QueueInfo> = queues
                .into_iter()
                .filter_map(|q| {
                    let id = u32::try_from(q.id).ok()?;
                    // 名称优先取 shortName——个别队列 name 为空（如 4310），
                    // 且 shortName 通常更适合窄列展示
                    let name = pick_name(&q.short_name, &q.name)?;
                    Some((
                        id,
                        QueueInfo {
                            name,
                            game_mode: q.game_mode,
                            is_visible: q.is_visible,
                            is_custom: q.is_custom,
                        },
                    ))
                })
                .collect();
            let count = map.len();
            if let Ok(mut guard) = QUEUE_CACHE.write() {
                *guard = map;
            }
            log::info!("[queue] LCU 队列表就绪，{} 条", count);
        }
        Err(e) => {
            // 不是致命错误：所有解析点都会回落到硬编码表
            log::warn!("[queue] 拉取 LCU 队列表失败，回落硬编码表: {}", e);
        }
    }
}

/// 在 shortName / name 里挑一个非空的展示名，都为空则丢弃该条。
fn pick_name(short_name: &str, name: &str) -> Option<String> {
    let short = short_name.trim();
    if !short.is_empty() {
        return Some(short.to_string());
    }
    let full = name.trim();
    if !full.is_empty() {
        return Some(full.to_string());
    }
    None
}

/// 解析队列中文名：**人工短名优先，LCU 表补空缺**。
///
/// ## 为什么不反过来
///
/// LCU 的名字权威但偏长——「排位赛 单排/双排」「极地大乱斗」「海克斯大乱斗 经典模式版」，
/// 而我们要塞进战绩列表的窄列里（`PlayerHistoryGrid` 的模式列本就靠省略号兜着，
/// 注释里点名过长模式名的问题）。[`QUEUE_ID_TO_CN`] 是人工挑的短名（「单双排」
/// 「大乱斗」「匹配」），更适合展示。
///
/// 两者分工：
/// - **人工表**决定常用队列**怎么显示**（短、稳定、不随客户端文案变动）
/// - **LCU 表**负责**别漏**——Riot 新加的模式无需改代码就能有名字，
///   这才是「未知模式」问题的根治点
///
/// 都没有时返回 `None`，由调用方决定兜底（战绩列表退到 `gameMode` 名，
/// 对局页显示「未知模式」）。
///
/// [`QUEUE_ID_TO_CN`]: crate::constant::game::QUEUE_ID_TO_CN
pub fn queue_name(id: u32) -> Option<String> {
    if let Some(curated) = crate::constant::game::get_queue_id_to_cn(id) {
        return Some(curated.to_string());
    }
    QUEUE_CACHE
        .read()
        .ok()
        .and_then(|guard| guard.get(&id).map(|info| info.name.clone()))
}

/// 「近期数据」卡片里「模式」一栏的显示名，解析不到时给「未知模式」。
///
/// 与 [`queue_name`] 的区别只在兜底：这里必须给一个可展示的字符串。
pub fn mode_display_name(mode: i32) -> String {
    u32::try_from(mode)
        .ok()
        .and_then(queue_name)
        .unwrap_or_else(|| "未知模式".to_string())
}

/// 当前客户端可选的队列（供模式筛选下拉）。
///
/// **由 LCU 决定「列哪些」，由 [`queue_name`] 决定「叫什么」**——前者让下拉随客户端
/// 更新（下线的盲选 430 自动消失、新模式自动出现），后者保证常用队列仍用人工短名。
///
/// 过滤掉三类噪音：
/// - **云顶之弈**：本工具只分析英雄联盟对局
/// - **自定义房**：客户端有 13 个（召唤师峡谷/嚎哭深渊 的自选、征召、全随机、比赛…），
///   没人拿它们筛战绩，混进来只会淹没常用模式
/// - **重名**：LCU 里确实存在同名不同 ID（如 4310/4320 都叫「经典模式」），
///   保留较小 ID，与 `canonical_queue_id` 取代表 ID 的规则一致
///
/// 缓存为空时返回空 vec，调用方回落硬编码表。
pub fn visible_queues() -> Vec<(u32, String)> {
    let Ok(guard) = QUEUE_CACHE.read() else {
        return Vec::new();
    };
    let mut out: Vec<(u32, String)> = guard
        .iter()
        .filter(|(_, info)| info.is_visible && !info.is_custom && !is_tft(&info.game_mode))
        .map(|(id, info)| (*id, queue_name(*id).unwrap_or_else(|| info.name.clone())))
        .collect();
    out.sort_by_key(|(id, _)| *id);
    // 同名只留最小 ID（out 已按 ID 升序，first-wins 即最小）
    let mut seen = std::collections::HashSet::new();
    out.retain(|(_, label)| seen.insert(label.clone()));
    out
}

/// 是否为云顶之弈相关玩法。
fn is_tft(game_mode: &str) -> bool {
    game_mode.eq_ignore_ascii_case("TFT")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_name_prefers_short_then_full() {
        assert_eq!(pick_name("短名", "全名"), Some("短名".to_string()));
        assert_eq!(pick_name("", "全名"), Some("全名".to_string()));
        assert_eq!(pick_name("  ", " 全名 "), Some("全名".to_string()));
        // 两者皆空的条目（LCU 里确实存在，如 4310）直接丢弃
        assert_eq!(pick_name("", ""), None);
        assert_eq!(pick_name("  ", "  "), None);
    }

    #[test]
    fn tft_modes_are_excluded_from_filter() {
        assert!(is_tft("TFT"));
        assert!(is_tft("tft"));
        assert!(!is_tft("CLASSIC"));
        assert!(!is_tft("ARAM"));
        assert!(!is_tft("CHERRY"));
    }

    /// 人工短名优先：这些 ID 无论 LCU 说什么，都必须用人工表里的短名，
    /// 否则窄列（战绩列表的模式列）会被「排位赛 单排/双排」这类长名撑爆
    #[test]
    fn curated_short_names_win_over_lcu() {
        assert!(cache_is_empty(), "单测环境不应有 LCU 缓存");
        assert_eq!(queue_name(420), Some("单双排".to_string())); // LCU: 排位赛 单排/双排
        assert_eq!(queue_name(450), Some("大乱斗".to_string())); // LCU: 极地大乱斗
        assert_eq!(queue_name(400), Some("匹配".to_string())); // LCU: 匹配模式
        assert_eq!(queue_name(870), Some("人机(入门)".to_string())); // LCU: 入门级（无「人机」）
    }

    /// 人工表没有的 ID 才轮到 LCU；两者皆无返回 None，由调用方兜底
    #[test]
    fn unknown_id_returns_none_without_lcu_cache() {
        assert!(cache_is_empty());
        assert_eq!(queue_name(99999), None);
    }

    #[test]
    fn visible_queues_empty_without_cache() {
        assert!(visible_queues().is_empty());
    }
}
