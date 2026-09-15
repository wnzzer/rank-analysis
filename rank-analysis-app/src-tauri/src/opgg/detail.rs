//! OP.GG 英雄详情（符文 / 出装 / 加点 / 召唤师技能）：请求目标解析、响应裁剪、分片磁盘缓存。
//!
//! 与 [`crate::opgg::api`]（全英雄列表快照）互补：列表一次拉全、按模式一个文件；
//! 详情按「英雄 × 分路」按需拉，条目多，故按 patch 分目录、每个英雄一个文件。
//! 缓存编排（内存 → 磁盘 → HTTP → stale）见 [`crate::command::champion_build`]。
//!
//! # 命名纠正
//! OP.GG 把符文**系**叫 `primary_page_id` / `secondary_page_id`，与「符文页」（用户
//! 符文页的句柄）毫无关系。本模块一律改名 `primary_style_id` / `sub_style_id`，
//! 与 LCU 的 `primaryStyleId` / `subStyleId` 对齐。
//!
//! # 裁剪
//! 解析即裁剪、不缓存原始响应（同 `asset.rs` 处理 cdragon 大文件的先例）：原始约 21 KB
//! 里大半是页面不渲染的长尾，按 `pick_rate` 降序各留几条后约 2.5 KB。

use crate::opgg::data::normalize_position;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 缓存条目 schema 版本；磁盘里版本不一致的条目视为 miss
pub const BUILD_SCHEMA_VERSION: u32 = 1;

/// 样本阈值：低于它的构筑不作为自动应用候选。
///
/// 取 200 的依据：实测 `master_plus` 这种最窄分段下头部构筑仍有 1527 场，
/// 200 能滤掉长尾又不误伤冷门英雄。
pub const MIN_BUILD_PLAY: i32 = 200;

/// 大乱斗固定用的 tier。
///
/// 实测 aram 不传 tier 等价于 `all`（亚索 23467 场），传 `emerald_plus` 样本缩到约
/// 1/12，大量英雄的第二套构筑跌破 [`MIN_BUILD_PLAY`]。与既有约定一致：列表接口的
/// aram 请求不带 tier、对局页 aram 不给段位下拉——大乱斗没有段位概念。
pub const ARAM_TIER: &str = "all";

// 裁剪保留条数（按 pick_rate 降序）
const KEEP_RUNES: usize = 3;
const KEEP_SPELLS: usize = 2;
const KEEP_STARTER_ITEMS: usize = 2;
const KEEP_BOOTS: usize = 3;
const KEEP_CORE_ITEMS: usize = 5;
const KEEP_LAST_ITEMS: usize = 6;
const KEEP_SKILLS: usize = 2;

/// 某英雄在某分路 / 模式 / 段位下的推荐构筑（裁剪后），内存与磁盘缓存的最小单元。
///
/// 字段保持 snake_case 序列化，前端同构类型见 `src/types/championBuild.ts`。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ChampionBuild {
    pub schema_version: u32,
    pub champion_id: i32,
    /// LCU 小写分路命名 top/jungle/middle/bottom/utility；大乱斗为 "none"
    pub position: String,
    /// "ranked" | "aram"
    pub mode: String,
    /// 请求时的段位分段；大乱斗恒为 [`ARAM_TIER`]
    pub tier: String,
    /// OP.GG `meta.version`，如 "16.18"，即缓存目录的 patch 键
    pub patch: String,
    /// 拉取时间（unix 秒）
    pub fetched_at: u64,
    /// 该分路（大乱斗为全体）样本场次
    pub play: i32,
    /// 该分路（大乱斗为全体）胜率 0~1
    pub win_rate: f64,
    pub runes: Vec<RuneBuild>,
    pub spells: Vec<IdsEntry>,
    pub starter_items: Vec<IdsEntry>,
    pub boots: Vec<IdsEntry>,
    pub core_items: Vec<IdsEntry>,
    pub last_items: Vec<IdsEntry>,
    pub skills: Vec<SkillBuild>,
    /// 是否为拉取失败时降级返回的旧 patch 数据。只在返回时置位，磁盘里恒为 false。
    #[serde(default)]
    pub stale: bool,
}

/// 一套完整的符文构筑，字段与 LCU 符文页一一对应、无需转换表。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RuneBuild {
    /// 主系（OP.GG `primary_page_id`）→ LCU `primaryStyleId`
    pub primary_style_id: i32,
    /// 副系（OP.GG `secondary_page_id`）→ LCU `subStyleId`
    pub sub_style_id: i32,
    /// 主系 4 个（首个为基石）
    pub primary_perk_ids: Vec<i32>,
    /// 副系 2 个
    pub sub_perk_ids: Vec<i32>,
    /// 属性碎片 3 个
    pub stat_mod_ids: Vec<i32>,
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}

impl RuneBuild {
    /// LCU `selectedPerkIds`：主系 4 ++ 副系 2 ++ 属性 3，**顺序不可乱**。
    pub fn perk_ids(&self) -> Vec<i32> {
        self.primary_perk_ids
            .iter()
            .chain(&self.sub_perk_ids)
            .chain(&self.stat_mod_ids)
            .copied()
            .collect()
    }
}

/// 一组 id（召唤师技能 / 出门装 / 鞋 / 核心装 / 后期装）及其统计。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct IdsEntry {
    pub ids: Vec<i32>,
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}

/// 一套加点顺序（15 项 "Q"/"W"/"E"/"R"）及其统计。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SkillBuild {
    pub order: Vec<String>,
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}

/// 一次详情请求的目标：决定 URL、缓存路径与缓存命中校验。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BuildTarget {
    /// "ranked" | "aram"
    pub mode: String,
    /// LCU 小写分路命名；大乱斗为 "none"
    pub position: String,
    pub tier: String,
}

/// LCU 分路命名（大小写不敏感）→ OP.GG 详情接口的分路命名；非法值返回 `None`。
///
/// 实测 OP.GG 详情接口只认 top/jungle/mid/adc/support（及大乱斗的 none），
/// 传 LCU 的 middle/bottom/utility 一律 422。方向与 [`normalize_position`] 相反。
pub fn to_opgg_position(lcu: &str) -> Option<&'static str> {
    match lcu.to_ascii_lowercase().as_str() {
        "top" => Some("top"),
        "jungle" => Some("jungle"),
        "middle" => Some("mid"),
        "bottom" => Some("adc"),
        "utility" => Some("support"),
        "none" => Some("none"),
        _ => None,
    }
}

/// 把 LCU 分路名归一成小写；不是五个合法分路之一返回 `None`。
fn lcu_lane(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    match lower.as_str() {
        "top" | "jungle" | "middle" | "bottom" | "utility" => Some(lower),
        _ => None,
    }
}

/// 由 LCU 会话信息解析详情请求目标；不该推荐符文的模式返回 `None`。
///
/// 按 `gameMode` 而不是「有无分配分路」判定模式：后者会让匹配自选 / 自定义
/// （无分配分路的召唤师峡谷）拿到大乱斗符文，自动应用时就是实打实的错页。
///
/// # 参数
/// - `game_mode`: LCU `gameMode`（CLASSIC / ARAM / KIWI / CHERRY ...）
/// - `position`: 我的 `assignedPosition`（LCU 小写命名，无分配为 None / ""）
/// - `main_position`: OP.GG 列表快照里该英雄的主分路（LCU 大写命名），无分配分路时兜底
/// - `ranked_tier`: 用户配置的段位分段（已经过 `sanitize_tier`）
///
/// # 规则
/// - ARAM / KIWI（极地地图）→ aram / none / [`ARAM_TIER`]
/// - CHERRY（斗魂竞技场，海克斯强化代替符文）/ STRAWBERRY（无尽狂潮）/ 空串（会话元信息
///   未到）→ None
/// - 其余 → ranked：分配分路优先，否则主分路，都没有则 None
pub fn resolve_target(
    game_mode: &str,
    position: Option<&str>,
    main_position: Option<&str>,
    ranked_tier: &str,
) -> Option<BuildTarget> {
    match game_mode.to_ascii_uppercase().as_str() {
        "ARAM" | "KIWI" => Some(BuildTarget {
            mode: "aram".into(),
            position: "none".into(),
            tier: ARAM_TIER.into(),
        }),
        "" | "CHERRY" | "STRAWBERRY" => None,
        _ => {
            let lane = position
                .and_then(lcu_lane)
                .or_else(|| main_position.and_then(lcu_lane))?;
            Some(BuildTarget {
                mode: "ranked".into(),
                position: lane,
                tier: ranked_tier.into(),
            })
        }
    }
}

// ---- OP.GG 原始响应（只解出需要的字段；数值字段全部 Option 容错 null）----

#[derive(Deserialize)]
struct RawDetail {
    data: RawData,
    meta: RawMeta,
}

#[derive(Deserialize)]
struct RawMeta {
    version: String,
}

#[derive(Deserialize)]
struct RawData {
    summary: RawSummary,
    #[serde(default)]
    summoner_spells: Vec<RawIds>,
    #[serde(default)]
    starter_items: Vec<RawIds>,
    #[serde(default)]
    boots: Vec<RawIds>,
    #[serde(default)]
    core_items: Vec<RawIds>,
    #[serde(default)]
    last_items: Vec<RawIds>,
    #[serde(default)]
    runes: Vec<RawRune>,
    #[serde(default)]
    skills: Vec<RawSkill>,
}

#[derive(Deserialize)]
struct RawSummary {
    average_stats: Option<RawStats>,
    positions: Option<Vec<RawPosition>>,
}

#[derive(Deserialize)]
struct RawStats {
    play: Option<i32>,
    win_rate: Option<f64>,
}

#[derive(Deserialize)]
struct RawPosition {
    name: String,
    stats: Option<RawStats>,
}

#[derive(Deserialize)]
struct RawIds {
    #[serde(default)]
    ids: Vec<i32>,
    play: Option<i32>,
    win: Option<i32>,
    pick_rate: Option<f64>,
}

#[derive(Deserialize)]
struct RawRune {
    primary_page_id: i32,
    #[serde(default)]
    primary_rune_ids: Vec<i32>,
    secondary_page_id: i32,
    #[serde(default)]
    secondary_rune_ids: Vec<i32>,
    #[serde(default)]
    stat_mod_ids: Vec<i32>,
    play: Option<i32>,
    win: Option<i32>,
    pick_rate: Option<f64>,
}

#[derive(Deserialize)]
struct RawSkill {
    #[serde(default)]
    order: Vec<String>,
    play: Option<i32>,
    win: Option<i32>,
    pick_rate: Option<f64>,
}

/// 按 `pick_rate` 降序稳定排序后截断到 `keep` 条（不足不 panic）。
fn top_by_pick_rate<T>(mut list: Vec<T>, keep: usize, pick_rate: impl Fn(&T) -> f64) -> Vec<T> {
    list.sort_by(|a, b| {
        pick_rate(b)
            .partial_cmp(&pick_rate(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    list.truncate(keep);
    list
}

fn ids_entries(raw: Vec<RawIds>, keep: usize) -> Vec<IdsEntry> {
    let list = raw
        .into_iter()
        .filter(|r| !r.ids.is_empty())
        .map(|r| IdsEntry {
            ids: r.ids,
            play: r.play.unwrap_or(0),
            win: r.win.unwrap_or(0),
            pick_rate: r.pick_rate.unwrap_or(0.0),
        })
        .collect();
    top_by_pick_rate(list, keep, |e: &IdsEntry| e.pick_rate)
}

/// 把 OP.GG 详情响应解析、裁剪为 [`ChampionBuild`]。
///
/// # 参数
/// - `body`: 响应体 JSON
/// - `target`: 本次请求目标（写入结果，并决定取哪个分路的统计）
/// - `champion_id`: 请求的英雄 ID
/// - `fetched_at`: 拉取时间（unix 秒），由调用方注入以便测试
///
/// # 容错
/// - 三段 id 数量不是 4/2/3 的构筑直接丢弃（拼不出合法的 9 个 `selectedPerkIds`）
/// - ranked 找不到当前分路的统计时退回 `average_stats`
pub fn parse_build(
    body: &str,
    target: &BuildTarget,
    champion_id: i32,
    fetched_at: u64,
) -> Result<ChampionBuild, String> {
    let raw: RawDetail = serde_json::from_str(body)
        .map_err(|e| format!("OP.GG detail response parse error: {}", e))?;
    let data = raw.data;

    let lane_stats = data.summary.positions.as_ref().and_then(|ps| {
        ps.iter()
            .find(|p| normalize_position(&p.name).eq_ignore_ascii_case(&target.position))
            .and_then(|p| p.stats.as_ref())
    });
    let stats = lane_stats.or(data.summary.average_stats.as_ref());

    let runes = data
        .runes
        .into_iter()
        .filter(|r| {
            r.primary_rune_ids.len() == 4
                && r.secondary_rune_ids.len() == 2
                && r.stat_mod_ids.len() == 3
        })
        .map(|r| RuneBuild {
            primary_style_id: r.primary_page_id,
            sub_style_id: r.secondary_page_id,
            primary_perk_ids: r.primary_rune_ids,
            sub_perk_ids: r.secondary_rune_ids,
            stat_mod_ids: r.stat_mod_ids,
            play: r.play.unwrap_or(0),
            win: r.win.unwrap_or(0),
            pick_rate: r.pick_rate.unwrap_or(0.0),
        })
        .collect();

    let skills = data
        .skills
        .into_iter()
        .filter(|s| !s.order.is_empty())
        .map(|s| SkillBuild {
            order: s.order,
            play: s.play.unwrap_or(0),
            win: s.win.unwrap_or(0),
            pick_rate: s.pick_rate.unwrap_or(0.0),
        })
        .collect();

    Ok(ChampionBuild {
        schema_version: BUILD_SCHEMA_VERSION,
        champion_id,
        position: target.position.clone(),
        mode: target.mode.clone(),
        tier: target.tier.clone(),
        patch: raw.meta.version,
        fetched_at,
        play: stats.and_then(|s| s.play).unwrap_or(0),
        win_rate: stats.and_then(|s| s.win_rate).unwrap_or(0.0),
        runes: top_by_pick_rate(runes, KEEP_RUNES, |r: &RuneBuild| r.pick_rate),
        spells: ids_entries(data.summoner_spells, KEEP_SPELLS),
        starter_items: ids_entries(data.starter_items, KEEP_STARTER_ITEMS),
        boots: ids_entries(data.boots, KEEP_BOOTS),
        core_items: ids_entries(data.core_items, KEEP_CORE_ITEMS),
        last_items: ids_entries(data.last_items, KEEP_LAST_ITEMS),
        skills: top_by_pick_rate(skills, KEEP_SKILLS, |s: &SkillBuild| s.pick_rate),
        stale: false,
    })
}

/// 拉取并解析一个英雄的详情。
///
/// # 错误
/// 网络失败、非 2xx、解析失败返回 Err；调用方负责降级到缓存。
pub async fn fetch_build(
    url: &str,
    target: &BuildTarget,
    champion_id: i32,
) -> Result<ChampionBuild, String> {
    log::info!("Fetching OP.GG detail: {}", url);
    let client = reqwest::Client::builder()
        .user_agent(crate::opgg::api::USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("OP.GG detail returned status {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    parse_build(&body, target, champion_id, now)
}

// ---- 分片磁盘缓存 ----

/// 详情缓存根目录：`{temp}/rank-analysis-builds`
pub fn builds_root() -> PathBuf {
    crate::paths::cache_subdir("builds")
}

/// patch 是否可以安全地作为目录名（只允许数字与点，防路径穿越）。
pub fn is_safe_patch(patch: &str) -> bool {
    !patch.is_empty() && patch.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// 单条缓存的路径：`{root}/{patch}/{mode}_{tier}/{champion_id}_{position}.json`
///
/// patch 做目录层级：版本变化时整目录删掉即可，不用逐文件判 TTL。
pub fn build_file_path(
    root: &Path,
    patch: &str,
    target: &BuildTarget,
    champion_id: i32,
) -> PathBuf {
    root.join(patch)
        .join(format!("{}_{}", target.mode, target.tier))
        .join(format!("{}_{}.json", champion_id, target.position))
}

/// 读取一条缓存；缺失、损坏、schema / 目标不一致一律视为 miss（缓存问题不阻塞主流程）。
pub fn load_file(path: &Path, target: &BuildTarget) -> Option<ChampionBuild> {
    let content = std::fs::read_to_string(path).ok()?;
    let build: ChampionBuild = match serde_json::from_str(&content) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("OP.GG detail cache corrupt at {}: {}", path.display(), e);
            return None;
        }
    };
    let matches = build.schema_version == BUILD_SCHEMA_VERSION
        && build.mode == target.mode
        && build.tier == target.tier
        && build.position == target.position;
    matches.then_some(build)
}

/// 写入一条缓存（自动建目录）。
pub fn save_file(path: &Path, build: &ChampionBuild) -> Result<(), String> {
    crate::paths::ensure_parent_dir(path)
        .map_err(|e| format!("mkdir {}: {}", path.display(), e))?;
    let json = serde_json::to_string(build).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write {}: {}", path.display(), e))
}

/// "16.18" → [16, 18]，用于按数字比较 patch（字典序下 "16.9" > "16.18"）。
fn patch_order_key(patch: &str) -> Vec<u32> {
    patch.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// 根目录下所有 patch 目录名。
fn patch_dirs(root: &Path) -> Vec<String> {
    std::fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|name| is_safe_patch(name))
                .collect()
        })
        .unwrap_or_default()
}

/// 在任意 patch 目录里找该目标的缓存，取最新 patch 的一条（拉取失败时的降级来源）。
pub fn find_stale(root: &Path, target: &BuildTarget, champion_id: i32) -> Option<ChampionBuild> {
    let mut patches = patch_dirs(root);
    patches.sort_by_key(|p| std::cmp::Reverse(patch_order_key(p)));
    patches
        .iter()
        .find_map(|p| load_file(&build_file_path(root, p, target, champion_id), target))
}

/// 删掉 `keep_patch` 以外的所有 patch 目录（写入新 patch 后惰性清理旧版本）。
pub fn cleanup_other_patches(root: &Path, keep_patch: &str) {
    for patch in patch_dirs(root) {
        if patch != keep_patch {
            let dir = root.join(&patch);
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => log::info!("OP.GG detail cache: removed old patch {}", patch),
                Err(e) => log::warn!("OP.GG detail cache cleanup {}: {}", dir.display(), e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RANKED_FIXTURE: &str = include_str!("fixtures/detail_ranked_157_mid.json");
    const ARAM_FIXTURE: &str = include_str!("fixtures/detail_aram_157.json");

    fn target(mode: &str, position: &str, tier: &str) -> BuildTarget {
        BuildTarget {
            mode: mode.into(),
            position: position.into(),
            tier: tier.into(),
        }
    }

    fn ranked_mid() -> BuildTarget {
        target("ranked", "middle", "emerald_plus")
    }

    /// 每个用例独享一个临时根目录，互不干扰
    fn temp_root(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("ra-builds-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    // ---- 分路映射 / 目标解析 ----

    #[test]
    fn to_opgg_position_should_map_lcu_names() {
        assert_eq!(to_opgg_position("top"), Some("top"));
        assert_eq!(to_opgg_position("jungle"), Some("jungle"));
        assert_eq!(to_opgg_position("middle"), Some("mid"));
        assert_eq!(to_opgg_position("bottom"), Some("adc"));
        assert_eq!(to_opgg_position("utility"), Some("support"));
        assert_eq!(to_opgg_position("none"), Some("none"));
        // 快照里的主分路是大写 LCU 命名
        assert_eq!(to_opgg_position("MIDDLE"), Some("mid"));
        assert_eq!(to_opgg_position(""), None);
        assert_eq!(to_opgg_position("mid"), None, "OP.GG 命名不是合法输入");
    }

    #[test]
    fn resolve_target_should_use_aram_all_tier_for_aram_like_modes() {
        let t = resolve_target("ARAM", Some("middle"), None, "gold_plus").unwrap();
        assert_eq!(t, target("aram", "none", "all"));
        // 海克斯大乱斗同为极地地图
        let t = resolve_target("KIWI", None, None, "gold_plus").unwrap();
        assert_eq!(t, target("aram", "none", "all"));
    }

    #[test]
    fn resolve_target_should_skip_modes_without_runes() {
        assert!(resolve_target("CHERRY", None, None, "gold_plus").is_none());
        assert!(resolve_target("STRAWBERRY", None, None, "gold_plus").is_none());
        // 会话元信息还没到：宁可不推荐也不猜
        assert!(resolve_target("", Some("middle"), None, "gold_plus").is_none());
    }

    #[test]
    fn resolve_target_should_use_assigned_position_for_classic() {
        let t = resolve_target("CLASSIC", Some("middle"), Some("TOP"), "gold_plus").unwrap();
        assert_eq!(t, target("ranked", "middle", "gold_plus"));
        let t = resolve_target("CLASSIC", Some("UTILITY"), None, "all").unwrap();
        assert_eq!(t, target("ranked", "utility", "all"));
    }

    #[test]
    fn resolve_target_should_fall_back_to_main_position_without_assignment() {
        // 匹配自选 / 自定义：没有分配分路，取 OP.GG 快照里该英雄的主分路，而不是给大乱斗符文
        let t = resolve_target("CLASSIC", None, Some("MIDDLE"), "gold_plus").unwrap();
        assert_eq!(t, target("ranked", "middle", "gold_plus"));
        let t = resolve_target("CLASSIC", Some(""), Some("TOP"), "gold_plus").unwrap();
        assert_eq!(t, target("ranked", "top", "gold_plus"));
        assert!(resolve_target("CLASSIC", None, None, "gold_plus").is_none());
    }

    // ---- 解析 + 裁剪 ----

    #[test]
    fn parse_ranked_should_rename_page_ids_and_keep_lcu_order() {
        let b = parse_build(RANKED_FIXTURE, &ranked_mid(), 157, 1_700_000_000).unwrap();
        assert_eq!(b.schema_version, BUILD_SCHEMA_VERSION);
        assert_eq!(b.champion_id, 157);
        assert_eq!(b.mode, "ranked");
        assert_eq!(b.position, "middle");
        assert_eq!(b.tier, "emerald_plus");
        assert_eq!(b.patch, "16.18");
        assert_eq!(b.fetched_at, 1_700_000_000);
        assert!(!b.stale);

        let r = &b.runes[0];
        assert_eq!(r.primary_style_id, 8000, "OP.GG primary_page_id 是符文系");
        assert_eq!(r.sub_style_id, 8400);
        assert_eq!(r.primary_perk_ids, vec![8008, 9101, 9104, 8299]);
        assert_eq!(r.sub_perk_ids, vec![8444, 8451]);
        assert_eq!(r.stat_mod_ids, vec![5005, 5008, 5001]);
        assert_eq!(r.play, 24385);
        assert_eq!(
            r.perk_ids(),
            vec![8008, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001]
        );
    }

    #[test]
    fn parse_ranked_should_use_current_position_stats() {
        // 英雄总场次 12.9 万是全分路之和；中单这一路的样本才是依据文案该给的数
        let b = parse_build(RANKED_FIXTURE, &ranked_mid(), 157, 0).unwrap();
        assert_eq!(b.play, 77441);
        assert!((b.win_rate - 0.491419).abs() < 1e-9);
    }

    #[test]
    fn parse_should_trim_each_list_by_pick_rate_desc() {
        let b = parse_build(RANKED_FIXTURE, &ranked_mid(), 157, 0).unwrap();
        assert_eq!(b.runes.len(), 3);
        assert_eq!(b.spells.len(), 2);
        assert_eq!(b.starter_items.len(), 2);
        assert_eq!(b.boots.len(), 3);
        assert_eq!(b.core_items.len(), 5);
        assert_eq!(b.last_items.len(), 6);
        assert_eq!(b.skills.len(), 2);
        // fixture 里 core_items 被倒序打乱过：裁剪必须按 pick_rate 重排，不能依赖源顺序
        assert_eq!(b.core_items[0].ids, vec![3153, 6673, 3031]);
        assert!(b
            .core_items
            .windows(2)
            .all(|w| w[0].pick_rate >= w[1].pick_rate));
        assert_eq!(b.skills[0].order.len(), 15);
    }

    #[test]
    fn parse_aram_should_use_average_stats_and_skip_malformed_runes() {
        let t = target("aram", "none", "all");
        let b = parse_build(ARAM_FIXTURE, &t, 157, 0).unwrap();
        assert_eq!(b.mode, "aram");
        assert_eq!(b.position, "none");
        assert_eq!(b.play, 1991);
        // fixture 注入了一条主系只有 3 个符文、pick_rate 最高的残缺构筑：必须跳过，
        // 否则会拼出 8 个 id 的坏页
        assert!(b.runes.iter().all(|r| r.perk_ids().len() == 9));
        assert_eq!(b.runes[0].play, 519);
        assert_eq!(b.runes.len(), 3);
    }

    #[test]
    fn parse_should_not_panic_when_lists_are_shorter_than_limits() {
        let b = parse_build(ARAM_FIXTURE, &target("aram", "none", "all"), 157, 0).unwrap();
        assert_eq!(b.starter_items.len(), 1);
        assert_eq!(b.skills.len(), 1);
    }

    #[test]
    fn parse_should_reject_malformed_body() {
        assert!(parse_build("not json", &ranked_mid(), 157, 0).is_err());
        assert!(parse_build(r#"{"data":{}}"#, &ranked_mid(), 157, 0).is_err());
    }

    // ---- 分片磁盘缓存 ----

    #[test]
    fn build_file_path_should_nest_patch_then_mode_tier() {
        let p = build_file_path(Path::new("/root"), "16.18", &ranked_mid(), 157);
        assert_eq!(
            p,
            PathBuf::from("/root/16.18/ranked_emerald_plus/157_middle.json")
        );
    }

    #[test]
    fn save_then_load_should_round_trip() {
        let root = temp_root("roundtrip");
        let b = parse_build(RANKED_FIXTURE, &ranked_mid(), 157, 42).unwrap();
        let path = build_file_path(&root, &b.patch, &ranked_mid(), 157);
        save_file(&path, &b).unwrap();

        let loaded = load_file(&path, &ranked_mid()).expect("should load");
        assert_eq!(loaded, b);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_should_treat_tier_or_schema_mismatch_as_miss() {
        let root = temp_root("mismatch");
        let mut b = parse_build(RANKED_FIXTURE, &ranked_mid(), 157, 0).unwrap();
        let path = build_file_path(&root, &b.patch, &ranked_mid(), 157);
        save_file(&path, &b).unwrap();
        assert!(load_file(&path, &target("ranked", "middle", "gold_plus")).is_none());

        b.schema_version = BUILD_SCHEMA_VERSION + 1;
        save_file(&path, &b).unwrap();
        assert!(load_file(&path, &ranked_mid()).is_none());

        std::fs::write(&path, "not json").unwrap();
        assert!(load_file(&path, &ranked_mid()).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_stale_should_prefer_newest_patch_by_numeric_order() {
        let root = temp_root("stale");
        let t = ranked_mid();
        for patch in ["16.9", "16.18"] {
            let mut b = parse_build(RANKED_FIXTURE, &t, 157, 0).unwrap();
            b.patch = patch.into();
            save_file(&build_file_path(&root, patch, &t, 157), &b).unwrap();
        }
        // 字典序 "16.9" > "16.18"，必须按数字比较
        let got = find_stale(&root, &t, 157).expect("should find");
        assert_eq!(got.patch, "16.18");
        assert!(find_stale(&root, &t, 86).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_should_remove_other_patch_dirs_only() {
        let root = temp_root("cleanup");
        let t = ranked_mid();
        for patch in ["16.17", "16.18"] {
            let mut b = parse_build(RANKED_FIXTURE, &t, 157, 0).unwrap();
            b.patch = patch.into();
            save_file(&build_file_path(&root, patch, &t, 157), &b).unwrap();
        }
        cleanup_other_patches(&root, "16.18");
        assert!(root.join("16.18").is_dir());
        assert!(!root.join("16.17").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn is_safe_patch_should_only_allow_digits_and_dots() {
        assert!(is_safe_patch("16.18"));
        assert!(!is_safe_patch(""));
        assert!(!is_safe_patch("../evil"));
        assert!(!is_safe_patch("16/18"));
    }

    /// 真实网络冒烟测试：默认忽略，本机联调时 `cargo test detail -- --ignored` 手动跑。
    #[tokio::test]
    #[ignore]
    async fn live_fetch_should_parse_real_response() {
        let url = crate::opgg::source::fill_template(
            &crate::opgg::source::default_source().url_template,
            "ranked",
            157,
            "mid",
            "emerald_plus",
        );
        let b = fetch_build(&url, &ranked_mid(), 157).await.expect("live");
        assert!(!b.patch.is_empty());
        assert!(!b.runes.is_empty());
    }
}
