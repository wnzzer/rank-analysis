use crate::{
    constant,
    lcu::util::http::{self, lcu_get},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

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
    pub icon_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Perk {
    pub id: i64,
    pub icon_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Spell {
    pub id: i64,
    pub icon_path: String,
}

// NOTE: switched from moka::Cache to RwLock<HashMap<..>> to support direct iteration.
// If TTL/size-based eviction is later required, consider wrapping with moka again or
// implementing a lightweight LRU.
pub static CHAMPION_CACHE: LazyLock<RwLock<HashMap<i64, Champion>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static ITEM_CACHE: LazyLock<RwLock<HashMap<i64, Item>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
// static PERK_CACHE: LazyLock<RwLock<HashMap<i64, Perk>>> = LazyLock::new(|| RwLock::new(HashMap::new()));
static SPELL_CACHE: LazyLock<RwLock<HashMap<i64, Spell>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

// Keep binary cache as moka for weighted size-based eviction (still useful) - optional future refactor.
use moka::future::Cache; // retained only for BINARY_CACHE
static BINARY_CACHE: LazyLock<Cache<String, (Vec<u8>, String)>> = LazyLock::new(|| {
    Cache::builder()
        .weigher(|_k: &String, v: &(Vec<u8>, String)| v.0.len() as u32)
        .build()
});

pub async fn init() {
    log::info!("Initializing asset API caches");
    let items = lcu_get::<Vec<Item>>(constant::api::ITEM_URI).await.unwrap();
    let champions = lcu_get::<Vec<Champion>>(constant::api::CHAMPION_URI)
        .await
        .unwrap();
    let spells = lcu_get::<Vec<Spell>>(constant::api::SPELL_URI)
        .await
        .unwrap();
    // let perks = lcu_get::<Vec<Perk>>(constant::api::PERK_URI).await.unwrap();

    // 先记录长度，避免后续 move
    let item_count = items.len();
    let champion_count = champions.len();
    let spell_count = spells.len();
    // let perk_count = perks.len();

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
    // {
    //     let mut map = PERK_CACHE.write().unwrap();
    //     for perk in perks { map.insert(perk.id, perk); }
    // }
    log::info!("item count: {}", item_count);
    log::info!("champion count: {}", champion_count);
    log::info!("spell count: {}", spell_count);
    // log::info!("perk count: {}", perk_count);
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

async fn get_profile_binary(id: i64) -> Result<(Vec<u8>, String), String> {
    log::info!("Getting profile binary for id {}", id);
    let profile_url = format!("/lol-game-data/assets/v1/profile-icons/{}.jpg", id);
    fetch_binary(&profile_url).await
}

fn build_asset_key(type_string: &str, id: i64) -> String {
    format!("{}:{}", type_string, id)
}
