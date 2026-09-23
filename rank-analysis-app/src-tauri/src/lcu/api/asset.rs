use crate::{
    constant,
    lcu::util::http::{self, external_get_img_as_binary, external_get_json, lcu_get},
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

// BINARY_CACHE：图片字节的进程内缓存。无 TTL、无 max_capacity ——
// 即**永不过期、永不驱逐**，首次取过后常驻到进程退出（asset 集合有限，内存可控）。
// 注意：下面的 weigher 已设但**当前不生效** —— moka 仅在配了 max_capacity 时才按权重驱逐。
// 如需容量上限，给 builder 补 `.max_capacity(...)` 即可激活（代价是冷数据可能被淘汰后重下）。
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

/// 公共入口：确保资源缓存就绪（图标可用）。幂等、单飞——main.rs setup 与图标协议处理器
/// 都走这里并合并到同一把锁，避免冷启动并发跑两次 init。
pub async fn init() {
    ensure_caches_ready().await;
}

/// 一次性初始化：先用 LCU 列表填好图标缓存（快、本地，实测 <1s）让图标立刻可用；
/// 再把耗时的 augment 文字描述补全（cdragon 26MB）丢到后台，绝不挡图标关键路径。
async fn init_once() {
    init_lcu_assets().await;
    tokio::spawn(enrich_augment_descriptions());
}

/// 从 LCU 拉取静态资源列表并填充各图标缓存（item/champion/spell/perk/augment）。
/// 全程走 LCU 本地。augment 描述此处只用 LCU 自带文本兜底，cdragon 增强见
/// [`enrich_augment_descriptions`]（后台执行）。
async fn init_lcu_assets() {
    log::info!("Initializing asset API caches (LCU lists)");
    let t0 = std::time::Instant::now();
    let items = lcu_list_or_mirror::<Vec<Item>>(constant::api::ITEM_URI, "物品列表")
        .await
        .unwrap_or_default();
    let champions = lcu_list_or_mirror::<Vec<Champion>>(constant::api::CHAMPION_URI, "英雄列表")
        .await
        .unwrap_or_default();
    let spells = lcu_list_or_mirror::<Vec<Spell>>(constant::api::SPELL_URI, "召唤师技能列表")
        .await
        .unwrap_or_default();
    let perk_styles =
        lcu_list_or_mirror::<PerkStylesResponse>(constant::api::PERK_URI, "符文风格列表")
            .await
            .unwrap_or(PerkStylesResponse { styles: Vec::new() });
    let perks = lcu_list_or_mirror::<Vec<Perk>>(constant::api::PERKS_URI, "符文列表")
        .await
        .unwrap_or_default();
    // per-item 解析，单条字段坏了不影响其他 augment 入缓存
    let cherry_augments_raw = lcu_list_or_mirror::<Vec<serde_json::Value>>(
        constant::api::CHERRY_AUGMENTS_URI,
        "海克斯强化列表",
    )
    .await
    .unwrap_or_default();

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

    // augment 入缓存：描述先用 LCU 自带文本兜底；cdragon 增强稍后由后台 enrich 回填。
    let cherry_augment_perks: Vec<Perk> = cherry_augments
        .into_iter()
        .map(|augment| Perk {
            id: augment.id,
            name: if augment.name_tra.is_empty() {
                format!("Augment {}", augment.id)
            } else {
                augment.name_tra
            },
            tooltip: augment.tooltip,
            short_desc: String::new(),
            long_desc: augment.description_tra,
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
        })
        .collect();

    let item_count = items.len();
    let champion_count = champions.len();
    let spell_count = spells.len();
    let perk_style_count = perk_styles_only.len();
    let perk_count = perks.len();
    let cherry_augment_count = cherry_augment_perks.len();

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
    log::info!(
        "[asset] LCU 资源就绪（图标可用）{} ms — item {} / champion {} / spell {} / perkStyle {} / perk {} / augment {}",
        t0.elapsed().as_millis(),
        item_count,
        champion_count,
        spell_count,
        perk_style_count,
        perk_count,
        cherry_augment_count
    );
}

/// cdragon 描述表磁盘缓存路径（temp 目录：可写、跨重启保留、无需额外依赖）。
///
/// 走 [`crate::paths::cache_file`] 与其余缓存统一；解析结果与改造前逐字节一致。
fn cdragon_cache_path() -> std::path::PathBuf {
    crate::paths::cache_file("cdragon-augments.json")
}

/// 描述表磁盘缓存有效期：7 天。过期则后台重拉刷新（augment 偶尔随版本新增）。
const CDRAGON_CACHE_TTL_SECS: u64 = 7 * 24 * 3600;

/// 读磁盘缓存的描述表；不存在 / 过期 / 损坏一律返回 None。纯 IO，便于单测（now 可注入）。
fn read_cached_desc_map(
    path: &std::path::Path,
    ttl_secs: u64,
    now: std::time::SystemTime,
) -> Option<HashMap<String, (String, String)>> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    if now.duration_since(modified).ok()?.as_secs() > ttl_secs {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// 把描述表写入磁盘缓存（失败仅记日志，不影响功能）。
fn write_cached_desc_map(path: &std::path::Path, map: &HashMap<String, (String, String)>) {
    match serde_json::to_vec(map) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(path, bytes) {
                log::warn!("写入 cdragon 描述缓存失败: {}", e);
            }
        }
        Err(e) => log::warn!("序列化 cdragon 描述缓存失败: {}", e),
    }
}

/// 从 CommunityDragon 拉 26MB stringtable（zh_cn 优先，失败回退 en_us），
/// 构建 apiName→(summary,tooltip)。
async fn fetch_cdragon_desc_map() -> HashMap<String, (String, String)> {
    match external_get_json::<CDragonStringTable>(CDRAGON_STRINGTABLE_URL).await {
        Ok(table) => build_cherry_desc_map(&table),
        Err(primary_err) => {
            log::warn!(
                "CommunityDragon zh_cn stringtable 拉取失败，回退 en_us：{}",
                primary_err
            );
            match external_get_json::<CDragonStringTable>(CDRAGON_STRINGTABLE_FALLBACK_URL).await {
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
    }
}

/// 后台补全 augment 文字描述（斗魂竞技场 tooltip 专用，**不在图标关键路径**）：
/// 优先读磁盘缓存（新鲜则秒回、不走网络），否则拉 26MB 并落盘；拿到描述表后回填
/// PERK_CACHE 里 augment 条目的 long_desc / tooltip。由 [`init_once`] 用 tokio::spawn 调起。
async fn enrich_augment_descriptions() {
    let t0 = std::time::Instant::now();
    let path = cdragon_cache_path();
    let (desc_map, source) =
        match read_cached_desc_map(&path, CDRAGON_CACHE_TTL_SECS, std::time::SystemTime::now()) {
            Some(m) => (m, "disk"),
            None => {
                let m = fetch_cdragon_desc_map().await;
                if !m.is_empty() {
                    write_cached_desc_map(&path, &m);
                }
                (m, "network")
            }
        };
    if desc_map.is_empty() {
        log::warn!("[asset] augment 描述为空（cdragon 拉取失败且无缓存），保留 LCU 兜底文本");
        return;
    }

    let mut updated = 0usize;
    {
        let mut cache = PERK_CACHE.write().unwrap();
        for perk in cache.values_mut() {
            let Some(api) = api_name_from_icon(&perk.icon_path) else {
                continue;
            };
            let Some((summary, tooltip)) = desc_map.get(&api) else {
                continue;
            };
            // 描述优先级：cdragon.summary（简洁） > cdragon.tooltip（完整） > 已有 LCU 文本
            if !summary.is_empty() {
                perk.long_desc = summary.clone();
            } else if !tooltip.is_empty() {
                perk.long_desc = tooltip.clone();
            }
            if !tooltip.is_empty() {
                perk.tooltip = tooltip.clone();
            }
            updated += 1;
        }
    }
    log::info!(
        "[asset] augment 描述补全完成（来源 {}，{} 条，回填 {} 项）{} ms",
        source,
        desc_map.len(),
        updated,
        t0.elapsed().as_millis()
    );
}

/// 自愈用单飞器：仅当 `is_empty()` 为真时，拿锁后再次确认仍为空，才跑一次 `run_init`。
/// 并发调用只触发一次 init，其余等锁后复查即返回。抽出来便于单测（不依赖 LCU）。
async fn run_once_if_empty<E, I, F>(is_empty: E, lock: &tokio::sync::Mutex<()>, run_init: I)
where
    E: Fn() -> bool,
    I: Fn() -> F,
    F: std::future::Future<Output = ()>,
{
    if !is_empty() {
        return;
    }
    let _guard = lock.lock().await;
    // 双检：等锁期间可能已有别的请求填好缓存。
    if !is_empty() {
        return;
    }
    run_init().await;
}

/// 资源缓存自愈：启动竞态下缓存还空时，确保 [`init`] 至少跑过一次再继续，
/// 避免协议处理器在缓存就绪前对 champion/item/perk 图标直接返回 404（首屏图裂、
/// 且因 no-store 不缓存失败、又无前端重试，会一直裂到手动刷新）。
///
/// **只能在异步协议处理器里 await**（见 main.rs 的 `register_asynchronous_uri_scheme_protocol`）：
/// init 会发多次 LCU 请求、耗时较长，绝不可在同步处理器里 `block_on`，否则会占满
/// webview 资源加载线程导致 UI 卡死。
async fn ensure_caches_ready() {
    static ASSET_INIT_LOCK: LazyLock<tokio::sync::Mutex<()>> =
        LazyLock::new(|| tokio::sync::Mutex::new(()));
    if init_retry_in_cooldown() {
        return;
    }
    run_once_if_empty(champion_cache_is_empty, &ASSET_INIT_LOCK, init_once).await;
}

/// init 失败后的重试冷却窗口。
const ASSET_INIT_RETRY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(30);

/// 上一次 init 尝试的时刻（None = 还没试过）。
static LAST_INIT_ATTEMPT: LazyLock<std::sync::Mutex<Option<std::time::Instant>>> =
    LazyLock::new(|| std::sync::Mutex::new(None));

/// 是否处于失败重试冷却中——是则本次跳过 init。
///
/// [`run_once_if_empty`] 的判据是「CHAMPION_CACHE 为空」，这在**没开客户端时永远成立**，
/// 而每个图标请求都会走一次 [`ensure_caches_ready`]。于是一屏几十个图标 = 几十次
/// 全量 init，每次把 6 个 LCU 端点各重试一遍、各做一轮进程扫描，日志被刷爆
/// （实测同一秒内 `Initializing asset API caches` 出现 3 次以上）。
///
/// 注意这里用「尝试即打点」而非「失败才打点」：成功的那次会填上缓存，
/// `run_once_if_empty` 自己的 `is_empty` 短路会先生效，冷却不会拖慢正常路径。
///
/// 副作用：打点本身在本函数内完成（返回 false 时即记录本次尝试）。
fn init_retry_in_cooldown() -> bool {
    let mut guard = match LAST_INIT_ATTEMPT.lock() {
        Ok(g) => g,
        // 锁被毒化时宁可放行：多跑一次 init 只是浪费，卡住则永久无图
        Err(poisoned) => poisoned.into_inner(),
    };
    let now = std::time::Instant::now();
    if let Some(last) = *guard {
        if now.duration_since(last) < ASSET_INIT_RETRY_COOLDOWN {
            return true;
        }
    }
    *guard = Some(now);
    false
}

// 新增：返回二进制与 content-type，便于通过 HTTP 下发
pub async fn get_asset_binary(type_string: String, id: i64) -> Result<(Vec<u8>, String), String> {
    let cache_key = build_asset_key(&type_string, id);
    if let Some(hit) = BINARY_CACHE.get(&cache_key).await {
        return Ok(hit);
    }

    // 磁盘缓存：BINARY_CACHE 是纯进程内的，退出即丢。这一层让「开过一次客户端」
    // 之后的每次冷启动都能直接出图，不必再依赖 LCU 在线。
    if let Some(hit) = read_icon_from_disk(&type_string, id) {
        BINARY_CACHE.insert(cache_key, hit.clone()).await;
        return Ok(hit);
    }

    // 自愈：缓存未就绪（启动竞态）时先确保 init 跑过一次，避免直接 404。
    // 现在 init 只等 LCU 图标列表（快），cdragon 描述在后台补，故首图标不再被 26MB 拖住。
    ensure_caches_ready().await;

    let result = match type_string.as_str() {
        "champion" => get_champion_binary(id).await,
        "item" => get_item_binary(id).await,
        "perk" => get_perk_binary(id).await,
        "spell" => get_spell_binary(id).await,
        "profile" => get_profile_binary(id).await,
        _ => Err("Invalid type string".to_string()),
    }?;

    // 写入缓存（磁盘 + 进程内）
    write_icon_to_disk(&type_string, id, &result.0, &result.1);
    BINARY_CACHE.insert(cache_key, result.clone()).await;
    Ok(result)
}

// ─── CommunityDragon 镜像兜底 ───────────────────────────────────────────────
//
// 图标此前**只有 LCU 一个来源**，没开客户端就全是裂图——mac 上更是永久裂图
// （客户端只有 Windows 版，CHAMPION_CACHE 恒为空）。CommunityDragon 把 LCU 的
// `/lol-game-data/assets/` 整棵树镜像到了公网且路径一一对应，所以一个转换函数
// 就能同时给「列表 JSON」和「所有类型的图标」兜底。
//
// 两个根刻意分开（实测结论）：
// - 列表 JSON 走 zh_cn：英雄名/物品名要与国服客户端一致（"黑暗之女" 而非 "Annie"）
// - 图片走 default：zh_cn 下没有图片资源，一律 404
const CDRAGON_DATA_ROOT: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn";
const CDRAGON_IMAGE_ROOT: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

/// LCU asset 路径 → CommunityDragon 镜像 URL。
///
/// # 参数
/// - `root`: [`CDRAGON_DATA_ROOT`]（列表）或 [`CDRAGON_IMAGE_ROOT`]（图片）
/// - `lcu_path`: LCU 侧路径。列表里的 iconPath 带前导斜杠
///   （`/lol-game-data/assets/v1/champion-icons/1.png`），`constant::api` 的 URI 不带，
///   两种都能吃——只认 `lol-game-data/assets/` 这个标记再取其后的尾巴。
///
/// # 行为
/// 尾巴**必须小写**：cdragon 的文件树是全小写的，而 LCU 的 item/perk iconPath 带大写
/// （如 `ASSETS/Items/Icons2D/1001_Class_T1_BootsOfSpeed.png`），原样请求 404。
///
/// # 返回值
/// 路径里没有 `lol-game-data/assets/` 标记时返回 `None`（不是 LCU 资源路径，无从镜像）
fn cdragon_url(root: &str, lcu_path: &str) -> Option<String> {
    const MARKER: &str = "lol-game-data/assets/";
    let idx = lcu_path.find(MARKER)?;
    let tail = &lcu_path[idx + MARKER.len()..];
    Some(format!("{}/{}", root, tail.to_lowercase()))
}

/// 图标磁盘缓存支持的扩展名。扩展名同时承载 content-type（见 [`mime_for_ext`]），
/// 省掉一个并行的元数据文件。
const ICON_CACHE_EXTS: [&str; 4] = ["png", "jpg", "webp", "gif"];

/// content-type → 落盘扩展名。
fn ext_for_mime(mime: &str) -> &'static str {
    if mime.contains("jpeg") || mime.contains("jpg") {
        "jpg"
    } else if mime.contains("webp") {
        "webp"
    } else if mime.contains("gif") {
        "gif"
    } else {
        "png"
    }
}

/// 落盘扩展名 → content-type。
fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

/// 图标磁盘缓存目录。
fn icon_cache_dir() -> std::path::PathBuf {
    crate::paths::cache_subdir("icons")
}

/// 单个图标在指定目录下的缓存路径。
fn icon_cache_path_in(dir: &std::path::Path, kind: &str, id: i64, ext: &str) -> std::path::PathBuf {
    dir.join(format!("{}-{}.{}", kind, id, ext))
}

/// 从磁盘缓存读图标；未命中 / 空文件返回 None。
///
/// 无 TTL 是刻意的：图标按 id 寻址且内容几乎不变，而这份缓存的全部意义就是
/// **未开客户端也能出图**——加了过期反而会在离线时把唯一的来源判死。
/// 系统清理 temp 时自然刷新。
fn read_icon_from_disk(kind: &str, id: i64) -> Option<(Vec<u8>, String)> {
    read_icon_in(&icon_cache_dir(), kind, id)
}

/// [`read_icon_from_disk`] 的纯 IO 内核（目录可注入，便于单测）。
///
/// 空文件视为未命中：写盘不是原子的，进程在 `std::fs::write` 中途被杀会留下
/// 0 字节文件，若当成命中就会永久返回一张坏图（本层无 TTL，不会自然过期）。
fn read_icon_in(dir: &std::path::Path, kind: &str, id: i64) -> Option<(Vec<u8>, String)> {
    for ext in ICON_CACHE_EXTS {
        let path = icon_cache_path_in(dir, kind, id, ext);
        match std::fs::read(&path) {
            Ok(bytes) if !bytes.is_empty() => {
                return Some((bytes, mime_for_ext(ext).to_string()));
            }
            _ => continue,
        }
    }
    None
}

/// 把图标写入磁盘缓存（失败仅记日志，绝不影响本次出图）。
fn write_icon_to_disk(kind: &str, id: i64, bytes: &[u8], mime: &str) {
    write_icon_in(&icon_cache_dir(), kind, id, bytes, mime);
}

/// [`write_icon_to_disk`] 的纯 IO 内核（目录可注入，便于单测）。
fn write_icon_in(dir: &std::path::Path, kind: &str, id: i64, bytes: &[u8], mime: &str) {
    let path = icon_cache_path_in(dir, kind, id, ext_for_mime(mime));
    if let Err(e) = crate::paths::ensure_parent_dir(&path) {
        log::warn!("创建图标缓存目录失败: {}", e);
        return;
    }
    if let Err(e) = std::fs::write(&path, bytes) {
        log::warn!("写入图标缓存失败({}): {}", path.display(), e);
    }
}

/// 取图标二进制：先 LCU（本地、与客户端版本严格一致），失败再走 CommunityDragon 镜像。
///
/// 顺序不能反：LCU 是本地请求且版本与玩家客户端对齐，镜像是 `latest`，
/// 版本更新当天可能与客户端有出入。
async fn fetch_binary(url: &str) -> Result<(Vec<u8>, String), String> {
    match http::lcu_get_img_as_binary(url).await {
        Ok(hit) => Ok(hit),
        Err(lcu_err) => {
            let Some(mirror) = cdragon_url(CDRAGON_IMAGE_ROOT, url) else {
                return Err(lcu_err);
            };
            log::debug!("LCU 取图失败({})，改走镜像: {}", lcu_err, mirror);
            external_get_img_as_binary(&mirror)
                .await
                .map_err(|cdn_err| format!("LCU: {} / 镜像: {}", lcu_err, cdn_err))
        }
    }
}

/// 取 LCU 列表，失败则回退 CommunityDragon 镜像（zh_cn，中文名）。
///
/// 这一层兜底不只为了图标：`get_champion_options`（英雄筛选下拉、AI 搜战绩的英雄
/// 清单）直接读 CHAMPION_CACHE，列表空则下拉整个是空的。
///
/// # 参数
/// - `uri`: `constant::api` 里的 LCU 资源 URI
/// - `what`: 日志里的人类可读名称
async fn lcu_list_or_mirror<T: serde::de::DeserializeOwned + 'static>(
    uri: &str,
    what: &str,
) -> Option<T> {
    match lcu_get::<T>(uri).await {
        Ok(v) => Some(v),
        Err(lcu_err) => {
            let mirror = cdragon_url(CDRAGON_DATA_ROOT, uri)?;
            match external_get_json::<T>(&mirror).await {
                Ok(v) => {
                    log::info!("{}：LCU 不可用({})，已从镜像加载", what, lcu_err);
                    Some(v)
                }
                Err(cdn_err) => {
                    log::warn!("{}：LCU({}) 与镜像({}) 均失败", what, lcu_err, cdn_err);
                    None
                }
            }
        }
    }
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn parse(raw: &str) -> CherryAugment {
        serde_json::from_str(raw).expect("valid CherryAugment JSON")
    }

    #[tokio::test]
    async fn run_once_if_empty_skips_when_already_ready() {
        // 缓存已就绪（is_empty=false）时不应触发 init。
        let init_count = AtomicUsize::new(0);
        let lock = tokio::sync::Mutex::new(());
        run_once_if_empty(
            || false,
            &lock,
            || async {
                init_count.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await;
        assert_eq!(init_count.load(Ordering::SeqCst), 0, "就绪时不应跑 init");
    }

    #[tokio::test]
    async fn run_once_if_empty_dedups_concurrent_callers() {
        // 启动竞态下，多个并发图片请求只应触发一次 init，其余等锁后复查即返回。
        let init_count = AtomicUsize::new(0);
        let lock = tokio::sync::Mutex::new(());
        let is_empty = || init_count.load(Ordering::SeqCst) == 0;
        let run_init = || async {
            tokio::task::yield_now().await; // 制造交错窗口
            init_count.fetch_add(1, Ordering::SeqCst);
        };
        let call = || run_once_if_empty(is_empty, &lock, run_init);
        tokio::join!(call(), call(), call(), call(), call(), call());
        assert_eq!(init_count.load(Ordering::SeqCst), 1, "init 应只跑一次");
        assert!(!is_empty(), "init 后缓存应视为就绪");
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

    #[test]
    fn disk_cache_roundtrip_reads_fresh() {
        let path = std::env::temp_dir().join("test-cdragon-roundtrip.json");
        let _ = std::fs::remove_file(&path);
        let mut map = HashMap::new();
        map.insert(
            "eureka".to_string(),
            ("简介".to_string(), "完整".to_string()),
        );
        write_cached_desc_map(&path, &map);
        let got = read_cached_desc_map(&path, 3600, std::time::SystemTime::now());
        assert_eq!(got.as_ref(), Some(&map));
        let _ = std::fs::remove_file(&path);
    }

    // ─── CommunityDragon 镜像兜底 ──────────────────────────────────────────
    //
    // `cdragon_url` 是整条离线兜底链的单点：它错了，未开客户端时所有图标和所有
    // 列表一起失效，而失败表现只是「图裂 + 下拉空」，没有任何报错指向这里。

    #[test]
    fn cdragon_url_converts_icon_path_from_list() {
        // 列表里的 iconPath 带前导斜杠
        let got = cdragon_url(
            CDRAGON_IMAGE_ROOT,
            "/lol-game-data/assets/v1/champion-icons/1.png",
        );

        assert_eq!(
            got.as_deref(),
            Some(concat!(
                "https://raw.communitydragon.org/latest/plugins/",
                "rcp-be-lol-game-data/global/default/v1/champion-icons/1.png"
            ))
        );
    }

    #[test]
    fn cdragon_url_converts_bare_uri_constant() {
        // constant::api 里的 URI 不带前导斜杠，同一个函数要能吃
        let got = cdragon_url(CDRAGON_DATA_ROOT, constant::api::CHAMPION_URI);

        assert_eq!(
            got.as_deref(),
            Some(concat!(
                "https://raw.communitydragon.org/latest/plugins/",
                "rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json"
            ))
        );
    }

    #[test]
    fn cdragon_url_lowercases_path() {
        // cdragon 的文件树全小写，而 LCU 的 item/perk iconPath 带大写驼峰。
        // 不小写化就是 404——这条是实测踩出来的，务必守住。
        let got = cdragon_url(
            CDRAGON_IMAGE_ROOT,
            "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Class_T1_BootsOfSpeed.png",
        );

        assert_eq!(
            got.as_deref(),
            Some(concat!(
                "https://raw.communitydragon.org/latest/plugins/",
                "rcp-be-lol-game-data/global/default/",
                "assets/items/icons2d/1001_class_t1_bootsofspeed.png"
            ))
        );
    }

    #[test]
    fn cdragon_url_rejects_non_lcu_path() {
        // 不是 LCU 资源路径就无从镜像，返回 None 让调用方保留原始 LCU 错误
        assert!(cdragon_url(CDRAGON_IMAGE_ROOT, "lol-game-queues/v1/queues").is_none());
        assert!(cdragon_url(CDRAGON_IMAGE_ROOT, "").is_none());
    }

    #[test]
    fn icon_mime_ext_maps_both_ways() {
        // 扩展名是 content-type 的唯一载体（不另存元数据文件），必须能往返
        for (mime, ext) in [
            ("image/jpeg", "jpg"),
            ("image/webp", "webp"),
            ("image/gif", "gif"),
            ("image/png", "png"),
        ] {
            assert_eq!(ext_for_mime(mime), ext, "mime {} → ext", mime);
            assert_eq!(mime_for_ext(ext), mime, "ext {} → mime", ext);
        }
        // 未知 content-type 落到 png（LCU 图标绝大多数是 png）
        assert_eq!(ext_for_mime("application/octet-stream"), "png");
    }

    #[test]
    fn icon_disk_cache_roundtrip_preserves_mime() {
        let dir = std::env::temp_dir().join("test-icon-cache-roundtrip");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp icon dir");

        write_icon_in(&dir, "profile", 29, b"\x89PNG-fake", "image/jpeg");
        let got = read_icon_in(&dir, "profile", 29);

        // content-type 经由扩展名还原，不能退化成默认 png
        assert_eq!(
            got,
            Some((b"\x89PNG-fake".to_vec(), "image/jpeg".to_string()))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn icon_disk_cache_missing_returns_none() {
        let dir = std::env::temp_dir().join("test-icon-cache-missing");
        let _ = std::fs::remove_dir_all(&dir);

        assert!(read_icon_in(&dir, "champion", 404).is_none());
    }

    #[test]
    fn icon_disk_cache_treats_empty_file_as_miss() {
        // 写盘非原子：进程在 write 中途被杀会留下 0 字节文件。本层无 TTL，
        // 若当成命中就是永久坏图。
        let dir = std::env::temp_dir().join("test-icon-cache-empty");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp icon dir");
        std::fs::write(icon_cache_path_in(&dir, "champion", 7, "png"), b"").expect("write empty");

        assert!(read_icon_in(&dir, "champion", 7).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disk_cache_missing_returns_none() {
        let path = std::env::temp_dir().join("test-cdragon-missing-xyz.json");
        let _ = std::fs::remove_file(&path);
        assert!(read_cached_desc_map(&path, 3600, std::time::SystemTime::now()).is_none());
    }

    #[test]
    fn disk_cache_stale_returns_none() {
        let path = std::env::temp_dir().join("test-cdragon-stale.json");
        let mut map = HashMap::new();
        map.insert("adapt".to_string(), ("a".to_string(), "b".to_string()));
        write_cached_desc_map(&path, &map);
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        // ttl=10s，now 取 mtime+100s → 过期，应返回 None
        let future = modified + std::time::Duration::from_secs(100);
        assert!(read_cached_desc_map(&path, 10, future).is_none());
        let _ = std::fs::remove_file(&path);
    }
}
