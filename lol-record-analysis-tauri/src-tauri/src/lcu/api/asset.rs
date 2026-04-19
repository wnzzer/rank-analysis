use crate::{
    constant,
    lcu::util::http::{self, external_get_json, lcu_get},
};
use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, RwLock};

/// LCU `cherry-augments.json` 里 rarity 字段在不同版本下既可能是字符串
/// ("kPrismatic"/"kGold"/...)，也可能是整数枚举 (0=Silver / 1=Gold / 2=Prismatic)。
/// 若按 String 反序列化遇到整数会导致整个 augment 解析失败 → PERK_CACHE 里
/// 没有海克斯数据 → 前端 tooltip 无颜色无介绍。
fn deserialize_rarity<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Visitor;
    use std::fmt;

    struct RarityVisitor;

    impl<'de> Visitor<'de> for RarityVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a rarity string (e.g. kPrismatic) or integer enum")
        }

        fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<String, E> {
            Ok(value.to_string())
        }

        fn visit_string<E: serde::de::Error>(self, value: String) -> Result<String, E> {
            Ok(value)
        }

        fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<String, E> {
            Ok(match value {
                0 => "kSilver".to_string(),
                1 => "kGold".to_string(),
                2 => "kPrismatic".to_string(),
                3 => "kBronze".to_string(),
                _ => String::new(),
            })
        }

        fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<String, E> {
            if value < 0 {
                return Ok(String::new());
            }
            self.visit_u64(value as u64)
        }

        fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<String, E> {
            if value < 0.0 || !value.is_finite() {
                return Ok(String::new());
            }
            self.visit_u64(value as u64)
        }

        fn visit_none<E: serde::de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }

        fn visit_unit<E: serde::de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }

        fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<String, D::Error> {
            deserializer.deserialize_any(RarityVisitor)
        }
    }

    deserializer.deserialize_any(RarityVisitor)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Champion {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub alias: String,
    pub content_id: String,
    pub square_portrait_path: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub icon_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Perk {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub tooltip: String,
    #[serde(default)]
    pub short_desc: String,
    #[serde(default)]
    pub long_desc: String,
    #[serde(default)]
    pub rarity: Option<String>,
    pub icon_path: String,
}

/// CommunityDragon 的 menu stringtable —— 单个 JSON 含 10w+ 键值对，
/// cherry_<apiName>_{summary,tooltip,name} 就是海克斯描述的真正位置
#[derive(Deserialize, Debug)]
struct CDragonStringTable {
    entries: HashMap<String, String>,
}

/// 从 LCU augment 的 icon path 提取 apiName（stringtable 的 key 前缀）
/// `/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/ADAPt_small.png` → `adapt`
fn api_name_from_icon(icon_path: &str) -> Option<String> {
    let filename = std::path::Path::new(icon_path)
        .file_stem()
        .and_then(|s| s.to_str())?;
    let stripped = filename
        .strip_suffix("_small")
        .or_else(|| filename.strip_suffix("_large"))
        .unwrap_or(filename);
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_lowercase())
    }
}

/// 从 stringtable 过滤出海克斯相关键，按 apiName 归拢 (summary, tooltip)。
/// 同时覆盖 cherry_* 与 kiwi_aram_* 两大前缀（后者是从 ARAM 迁移过来的 passive augments）
fn build_cherry_desc_map(table: &CDragonStringTable) -> HashMap<String, (String, String)> {
    let mut by_api: HashMap<String, (String, String)> = HashMap::new();
    for (key, value) in table.entries.iter() {
        let (api, suffix) = match key
            .strip_prefix("cherry_")
            .or_else(|| key.strip_prefix("kiwi_aram_"))
        {
            Some(rest) => match rest.rsplit_once('_') {
                Some((api, suffix)) => (api, suffix),
                None => continue,
            },
            None => continue,
        };
        let entry = by_api.entry(api.to_string()).or_default();
        match suffix {
            "summary" => entry.0 = normalize_cdragon_desc(value),
            "tooltip" => entry.1 = normalize_cdragon_desc(value),
            _ => {}
        }
    }
    by_api
}

/// 清理 cdragon 描述里的 XML-like 标签（`<spellName>xxx</spellName>` 等）与
/// @fN@ 类占位符，保留可读内容给前端展示
fn normalize_cdragon_desc(raw: &str) -> String {
    if raw.trim().is_empty() {
        return String::new();
    }
    // 先把 <br>/<br/> 替换为换行
    let with_breaks = raw
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<br>", "\n");
    // 去其他 XML 标签，保留内容
    let no_tags = ASSET_TAG_REGEX.replace_all(&with_breaks, "").to_string();
    // 占位符 @xxx@ 在没有 dataValues 上下文时无意义，替换为 "?"
    let no_placeholders = CDRAGON_PLACEHOLDER_REGEX
        .replace_all(&no_tags, "?")
        .to_string();
    // 处理换行和多余空白
    let decoded = no_placeholders
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded.trim().to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CherryAugment {
    pub id: i64,
    /// LCU 不同版本/locale 下 name 字段名不一致：
    /// - 老版本/繁体：nameTRA
    /// - 新版本/通用：name
    /// - 部分变体：nameCn / display_name
    #[serde(
        default,
        alias = "nameTRA",
        alias = "name",
        alias = "nameCn",
        alias = "displayName"
    )]
    pub name_tra: String,
    /// 同上，描述字段名也不统一
    #[serde(
        default,
        alias = "descriptionTRA",
        alias = "desc",
        alias = "description",
        alias = "descTRA",
        alias = "descriptionCn"
    )]
    pub description_tra: String,
    #[serde(default)]
    pub tooltip: String,
    #[serde(default, alias = "augmentSmallIconPath", alias = "iconSmall")]
    pub augment_small_icon_path: String,
    #[serde(default, alias = "iconLargePath", alias = "iconLarge")]
    pub icon_large_path: String,
    #[serde(default, deserialize_with = "deserialize_rarity")]
    pub rarity: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkStyle {
    pub id: i64,
    pub name: String,
    pub icon_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkStylesResponse {
    pub styles: Vec<PerkStyle>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetDetails {
    pub id: i64,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rarity: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Spell {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub icon_path: String,
}

// NOTE: switched from moka::Cache to RwLock<HashMap<..>> to support direct iteration.
// If TTL/size-based eviction is later required, consider wrapping with moka again or
// implementing a lightweight LRU.
pub static CHAMPION_CACHE: LazyLock<RwLock<HashMap<i64, Champion>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static ITEM_CACHE: LazyLock<RwLock<HashMap<i64, Item>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static PERK_CACHE: LazyLock<RwLock<HashMap<i64, Perk>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static SPELL_CACHE: LazyLock<RwLock<HashMap<i64, Spell>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static ASSET_TAG_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<[^>]+>").expect("valid asset html regex"));
static CDRAGON_PLACEHOLDER_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@[^@]+@").expect("valid cdragon placeholder regex"));

/// CommunityDragon 的 menu stringtable —— LCU 不暴露海克斯描述文本，
/// 只能从这个 26MB 的 JSON 里按 cherry_<apiName>_summary / _tooltip 键取。
/// 被拉下来后会本地缓存，避免每次启动都拉整个文件。
const CDRAGON_STRINGTABLE_URL: &str =
    "https://raw.communitydragon.org/latest/game/zh_cn/data/menu/en_us/lol.stringtable.json";
const CDRAGON_STRINGTABLE_FALLBACK_URL: &str =
    "https://raw.communitydragon.org/latest/game/en_us/data/menu/en_us/lol.stringtable.json";

// Keep binary cache as moka for weighted size-based eviction (still useful) - optional future refactor.
use moka::future::Cache; // retained only for BINARY_CACHE
static BINARY_CACHE: LazyLock<Cache<String, (Vec<u8>, String)>> = LazyLock::new(|| {
    Cache::builder()
        .weigher(|_k: &String, v: &(Vec<u8>, String)| v.0.len() as u32)
        .build()
});

/// 英雄缓存是否为空（用于判断启动时是否因未开客户端而未能拉取 LCU 静态资源）。
pub fn champion_cache_is_empty() -> bool {
    CHAMPION_CACHE.read().map(|g| g.is_empty()).unwrap_or(true)
}

pub async fn init() {
    log::info!("Initializing asset API caches");
    let items = match lcu_get::<Vec<Item>>(constant::api::ITEM_URI).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("未从 LCU 加载物品列表（可先启动英雄联盟客户端）: {}", e);
            Vec::new()
        }
    };
    let champions = match lcu_get::<Vec<Champion>>(constant::api::CHAMPION_URI).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("未从 LCU 加载英雄列表（可先启动英雄联盟客户端）: {}", e);
            Vec::new()
        }
    };
    let spells = match lcu_get::<Vec<Spell>>(constant::api::SPELL_URI).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("未从 LCU 加载召唤师技能列表: {}", e);
            Vec::new()
        }
    };
    let perk_styles = match lcu_get::<PerkStylesResponse>(constant::api::PERK_URI).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("未从 LCU 加载符文风格列表: {}", e);
            PerkStylesResponse { styles: Vec::new() }
        }
    };
    let perks = match lcu_get::<Vec<Perk>>(constant::api::PERKS_URI).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("未从 LCU 加载符文列表: {}", e);
            Vec::new()
        }
    };
    // per-item 解析，单条字段坏了不影响其他 augment 入缓存
    let cherry_augments_raw =
        match lcu_get::<Vec<serde_json::Value>>(constant::api::CHERRY_AUGMENTS_URI).await {
            Ok(v) => v,
            Err(error) => {
                log::warn!("Failed to fetch cherry augments raw JSON: {}", error);
                Vec::new()
            }
        };

    let mut cherry_augments: Vec<CherryAugment> = Vec::with_capacity(cherry_augments_raw.len());
    let mut parse_fail_count = 0usize;
    for raw in &cherry_augments_raw {
        match serde_json::from_value::<CherryAugment>(raw.clone()) {
            Ok(a) => cherry_augments.push(a),
            Err(e) => {
                if parse_fail_count < 3 {
                    log::warn!("cherry-augment parse failed: {} — raw={}", e, raw);
                }
                parse_fail_count += 1;
            }
        }
    }
    if parse_fail_count > 0 {
        log::warn!(
            "cherry-augments parse failed total: {} / {}",
            parse_fail_count,
            cherry_augments_raw.len()
        );
    }
    let perk_styles_only: Vec<Perk> = perk_styles
        .styles
        .into_iter()
        .map(|perk_style| Perk {
            id: perk_style.id,
            name: perk_style.name,
            tooltip: String::new(),
            short_desc: String::new(),
            long_desc: String::new(),
            rarity: None,
            icon_path: perk_style.icon_path,
        })
        .collect();
    // 从 CommunityDragon 拉 stringtable（26MB），按 cherry_<apiName>_summary/tooltip 取描述。
    //
    // 为什么必须走外部：LCU 不暴露 stringtable / fontconfig 文件（已探针确认）；
    // LCU 的 cherry-augments.json 只含 id/nameTRA/rarity/icon，描述文本在游戏客户端的
    // fontconfig stringtable 里，Riot 没把它挂到 LCU HTTP API。
    //
    // 26MB 的 JSON 一次过网络 + 解析成本较高（启动 +~2-3s），后续如果成为痛点再加磁盘缓存。
    let cdragon_desc_map: HashMap<String, (String, String)> =
        match external_get_json::<CDragonStringTable>(CDRAGON_STRINGTABLE_URL).await {
            Ok(table) => build_cherry_desc_map(&table),
            Err(primary_err) => {
                log::warn!(
                    "CommunityDragon zh_cn stringtable 拉取失败，回退 en_us：{}",
                    primary_err
                );
                match external_get_json::<CDragonStringTable>(CDRAGON_STRINGTABLE_FALLBACK_URL)
                    .await
                {
                    Ok(table) => build_cherry_desc_map(&table),
                    Err(fallback_err) => {
                        log::warn!(
                            "CommunityDragon en_us stringtable 也失败了：{}",
                            fallback_err
                        );
                        HashMap::new()
                    }
                }
            }
        };
    log::info!(
        "cdragon stringtable cherry descriptions loaded: {}",
        cdragon_desc_map.len()
    );

    let cherry_augment_perks: Vec<Perk> = cherry_augments
        .into_iter()
        .map(|augment| {
            let api_name = api_name_from_icon(&augment.augment_small_icon_path)
                .or_else(|| api_name_from_icon(&augment.icon_large_path));
            let (cdragon_summary, cdragon_tooltip) = api_name
                .as_deref()
                .and_then(|n| cdragon_desc_map.get(n))
                .cloned()
                .unwrap_or_default();
            // 描述优先级：cdragon.summary（简洁） > cdragon.tooltip（完整） > LCU 空值
            let long_desc = if !cdragon_summary.is_empty() {
                cdragon_summary
            } else if !cdragon_tooltip.is_empty() {
                cdragon_tooltip.clone()
            } else {
                augment.description_tra
            };
            let tooltip = if !cdragon_tooltip.is_empty() {
                cdragon_tooltip
            } else {
                augment.tooltip
            };
            Perk {
                id: augment.id,
                name: if augment.name_tra.is_empty() {
                    format!("Augment {}", augment.id)
                } else {
                    augment.name_tra
                },
                tooltip,
                short_desc: String::new(),
                long_desc,
                rarity: if augment.rarity.is_empty() {
                    None
                } else {
                    Some(augment.rarity)
                },
                icon_path: if augment.augment_small_icon_path.is_empty() {
                    augment.icon_large_path
                } else {
                    augment.augment_small_icon_path
                },
            }
        })
        .collect();

    // 先记录长度，避免后续 move
    let item_count = items.len();
    let champion_count = champions.len();
    let spell_count = spells.len();
    let perk_style_count = perk_styles_only.len();
    let perk_count = perks.len();
    let cherry_augment_count = cherry_augment_perks.len();

    // 将数据存储到缓存中
    {
        let mut map = ITEM_CACHE.write().unwrap();
        for item in items {
            map.insert(item.id, item);
        }
    }
    {
        let mut map = CHAMPION_CACHE.write().unwrap();
        for champion in champions {
            map.insert(champion.id, champion);
        }
    }
    {
        let mut map = SPELL_CACHE.write().unwrap();
        for spell in spells {
            map.insert(spell.id, spell);
        }
    }
    {
        let mut map = PERK_CACHE.write().unwrap();
        for perk in perk_styles_only {
            map.insert(perk.id, perk);
        }
        for perk in perks {
            map.insert(perk.id, perk);
        }
        for augment in cherry_augment_perks {
            map.insert(augment.id, augment);
        }
    }
    log::info!("item count: {}", item_count);
    log::info!("champion count: {}", champion_count);
    log::info!("spell count: {}", spell_count);
    log::info!("perk style count: {}", perk_style_count);
    log::info!("perk count: {}", perk_count);
    log::info!("cherry augment count: {}", cherry_augment_count);
    log::info!("Asset API caches initialized successfully");
}

// 新增：返回二进制与 content-type，便于通过 HTTP 下发
pub async fn get_asset_binary(type_string: String, id: i64) -> Result<(Vec<u8>, String), String> {
    let cache_key = build_asset_key(&type_string, id);
    if let Some(hit) = BINARY_CACHE.get(&cache_key).await {
        return Ok(hit);
    }

    let result = match type_string.as_str() {
        "champion" => get_champion_binary(id).await,
        "item" => get_item_binary(id).await,
        "perk" => get_perk_binary(id).await,
        "spell" => get_spell_binary(id).await,
        "profile" => get_profile_binary(id).await,
        _ => Err("Invalid type string".to_string()),
    }?;

    // 写入缓存
    BINARY_CACHE.insert(cache_key, result.clone()).await;
    Ok(result)
}

async fn fetch_binary(url: &str) -> Result<(Vec<u8>, String), String> {
    http::lcu_get_img_as_binary(url).await
}

// 新增：各类型的二进制获取
async fn get_champion_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    let chapmpion = {
        let cache = CHAMPION_CACHE.read().unwrap();
        cache.get(&id).cloned()
    };
    match chapmpion {
        Some(champion) => {
            log::info!("Getting champion binary for id {}", id);
            fetch_binary(&champion.square_portrait_path).await
        }
        None => Err(format!("Champion with id {} not found in cache", id)),
    }
}

async fn get_item_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    let item = {
        let cache = ITEM_CACHE.read().unwrap();
        cache.get(&id).cloned()
    };
    match item {
        Some(item) => {
            log::info!("Getting item binary for id {}", id);
            fetch_binary(&item.icon_path).await
        }
        None => Err(format!("Item with id {} not found in cache", id)),
    }
}

async fn get_spell_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    let spell = {
        let cache = SPELL_CACHE.read().unwrap();
        cache.get(&id).cloned()
    };
    match spell {
        Some(spell) => {
            log::info!("Getting spell binary for id {}", id);
            fetch_binary(&spell.icon_path).await
        }
        None => Err(format!("Spell with id {} not found in cache", id)),
    }
}

async fn get_perk_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    let perk = {
        let cache = PERK_CACHE.read().unwrap();
        cache.get(&id).cloned()
    };
    match perk {
        Some(perk) => {
            log::info!("Getting perk binary for id {}", id);
            fetch_binary(&perk.icon_path).await
        }
        None => Err(format!("Perk with id {} not found in cache", id)),
    }
}

async fn get_profile_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    log::info!("Getting profile binary for id {}", id);
    let profile_url = format!("/lol-game-data/assets/v1/profile-icons/{}.jpg", id);
    fetch_binary(&profile_url).await
}

fn build_asset_key(type_string: &str, id: i64) -> String {
    format!("{}:{}", type_string, id)
}

pub fn get_asset_details(type_string: String, ids: Vec<i64>) -> Result<Vec<AssetDetails>, String> {
    match type_string.as_str() {
        "item" => Ok(get_item_details(ids)),
        "perk" => Ok(get_perk_details(ids)),
        "spell" => Ok(get_spell_details(ids)),
        _ => Err("Invalid type string".to_string()),
    }
}

fn get_spell_details(ids: Vec<i64>) -> Vec<AssetDetails> {
    let cache = SPELL_CACHE.read().unwrap();
    collect_unique_ids(ids)
        .into_iter()
        .filter_map(|id| {
            cache.get(&id).map(|spell| AssetDetails {
                id,
                name: spell.name.clone(),
                description: normalize_asset_text(&spell.description).unwrap_or_default(),
                rarity: None,
            })
        })
        .collect()
}

fn get_item_details(ids: Vec<i64>) -> Vec<AssetDetails> {
    let cache = ITEM_CACHE.read().unwrap();
    collect_unique_ids(ids)
        .into_iter()
        .filter_map(|id| {
            cache.get(&id).map(|item| AssetDetails {
                id,
                name: item.name.clone(),
                description: normalize_asset_text(&item.description).unwrap_or_default(),
                rarity: None,
            })
        })
        .collect()
}

fn get_perk_details(ids: Vec<i64>) -> Vec<AssetDetails> {
    let cache = PERK_CACHE.read().unwrap();
    collect_unique_ids(ids)
        .into_iter()
        .filter_map(|id| {
            cache.get(&id).map(|perk| AssetDetails {
                id,
                name: perk.name.clone(),
                description: normalize_asset_text(&perk.long_desc)
                    .or_else(|| normalize_asset_text(&perk.tooltip))
                    .or_else(|| normalize_asset_text(&perk.short_desc))
                    .unwrap_or_default(),
                rarity: perk.rarity.clone(),
            })
        })
        .collect()
}

fn collect_unique_ids(ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for id in ids {
        if id <= 0 || !seen.insert(id) {
            continue;
        }
        result.push(id);
    }

    result
}

fn normalize_asset_text(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }

    let with_breaks = raw
        .replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
        .replace("<hr />", "\n")
        .replace("<hr/>", "\n")
        .replace("<hr>", "\n")
        .replace("</li>", "\n")
        .replace("<li>", "• ")
        .replace("</p>", "\n")
        .replace("<p>", "");

    let without_tags = ASSET_TAG_REGEX.replace_all(&with_breaks, "");
    let decoded = without_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    let mut lines = Vec::new();
    let mut previous_blank = false;

    for line in decoded.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !previous_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            previous_blank = true;
            continue;
        }

        lines.push(trimmed.to_string());
        previous_blank = false;
    }

    while matches!(lines.last(), Some(last) if last.is_empty()) {
        lines.pop();
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str) -> CherryAugment {
        serde_json::from_str(raw).expect("valid CherryAugment JSON")
    }

    #[test]
    fn should_accept_integer_rarity_gold() {
        let a = parse(r#"{"id":1,"rarity":1}"#);
        assert_eq!(a.rarity, "kGold");
    }

    #[test]
    fn should_accept_integer_rarity_prismatic() {
        let a = parse(r#"{"id":2,"rarity":2}"#);
        assert_eq!(a.rarity, "kPrismatic");
    }

    #[test]
    fn should_accept_integer_rarity_silver() {
        let a = parse(r#"{"id":3,"rarity":0}"#);
        assert_eq!(a.rarity, "kSilver");
    }

    #[test]
    fn should_accept_string_rarity_as_is() {
        let a = parse(r#"{"id":4,"rarity":"kPrismatic"}"#);
        assert_eq!(a.rarity, "kPrismatic");
    }

    #[test]
    fn should_default_when_rarity_missing() {
        let a = parse(r#"{"id":5}"#);
        assert_eq!(a.rarity, "");
    }

    #[test]
    fn should_default_when_rarity_null() {
        let a = parse(r#"{"id":6,"rarity":null}"#);
        assert_eq!(a.rarity, "");
    }

    #[test]
    fn should_fallback_to_empty_for_unknown_integer() {
        let a = parse(r#"{"id":7,"rarity":99}"#);
        assert_eq!(a.rarity, "");
    }

    #[test]
    fn should_accept_name_tra_primary() {
        let a = parse(r#"{"id":8,"nameTRA":"末日"}"#);
        assert_eq!(a.name_tra, "末日");
    }

    #[test]
    fn should_accept_name_as_alias() {
        let a = parse(r#"{"id":9,"name":"末日"}"#);
        assert_eq!(a.name_tra, "末日");
    }

    #[test]
    fn should_accept_description_tra_primary() {
        let a = parse(r#"{"id":10,"descriptionTRA":"效果描述"}"#);
        assert_eq!(a.description_tra, "效果描述");
    }

    #[test]
    fn should_accept_desc_as_alias() {
        let a = parse(r#"{"id":11,"desc":"效果描述"}"#);
        assert_eq!(a.description_tra, "效果描述");
    }

    #[test]
    fn should_strip_xml_tags_from_cdragon_desc() {
        let cleaned = normalize_cdragon_desc("<spellName>技能</spellName>造成额外伤害");
        assert_eq!(cleaned, "技能造成额外伤害");
    }

    #[test]
    fn should_replace_cdragon_placeholders() {
        let cleaned = normalize_cdragon_desc("每 @f1@ 秒恢复 @f2@ 生命");
        assert_eq!(cleaned, "每 ? 秒恢复 ? 生命");
    }

    #[test]
    fn should_return_empty_for_blank_cdragon_desc() {
        assert_eq!(normalize_cdragon_desc(""), "");
        assert_eq!(normalize_cdragon_desc("   "), "");
    }

    #[test]
    fn should_decode_html_entities() {
        let cleaned = normalize_cdragon_desc("A&nbsp;B&amp;C");
        assert_eq!(cleaned, "A B&C");
    }

    #[test]
    fn should_extract_api_name_from_small_icon_path() {
        let api = api_name_from_icon(
            "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Eureka_small.png",
        );
        assert_eq!(api.as_deref(), Some("eureka"));
    }

    #[test]
    fn should_extract_api_name_from_large_icon_path() {
        let api = api_name_from_icon(
            "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/BigBrain_large.png",
        );
        assert_eq!(api.as_deref(), Some("bigbrain"));
    }

    #[test]
    fn should_lowercase_api_name_with_mixed_case() {
        // LCU 实际路径里大小写混乱（如 ADAPt_small.png），apiName 需要统一小写
        let api = api_name_from_icon("/foo/bar/ADAPt_small.png");
        assert_eq!(api.as_deref(), Some("adapt"));
    }

    #[test]
    fn should_return_none_for_empty_icon() {
        assert!(api_name_from_icon("").is_none());
    }

    #[test]
    fn should_build_cherry_desc_map_from_stringtable() {
        let mut entries = HashMap::new();
        entries.insert("cherry_eureka_name".to_string(), "尤里卡".to_string());
        entries.insert(
            "cherry_eureka_summary".to_string(),
            "获得相当于<scaleAP>@APToHasteConversion*100@%法术强度</scaleAP>的技能急速。"
                .to_string(),
        );
        entries.insert(
            "cherry_eureka_tooltip".to_string(),
            "获得@APToHasteConversionCalc@技能急速。".to_string(),
        );
        // 其他 prefix
        entries.insert(
            "kiwi_aram_weightedpopoffs_name".to_string(),
            "负重爆气".to_string(),
        );
        entries.insert(
            "kiwi_aram_weightedpopoffs_summary".to_string(),
            "你的冷却时间已缩短。".to_string(),
        );
        // 无关 key 应被忽略
        entries.insert(
            "game_mode_summoners_rift".to_string(),
            "召唤师峡谷".to_string(),
        );

        let table = CDragonStringTable { entries };
        let map = build_cherry_desc_map(&table);

        let eureka = map.get("eureka").expect("eureka present");
        assert!(eureka.0.contains("技能急速")); // summary
        assert_eq!(eureka.1, "获得?技能急速。"); // tooltip with placeholder replaced

        let weight = map.get("weightedpopoffs").expect("weightedpopoffs present");
        assert_eq!(weight.0, "你的冷却时间已缩短。");
        assert!(!map.contains_key("summoners_rift")); // 无关键不入
    }
}
