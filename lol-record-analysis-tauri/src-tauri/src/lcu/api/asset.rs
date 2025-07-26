use crate::{
    constant,
    lcu::util::http::{self, lcu_get},
};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Champion {
    pub id: i32,
    pub name: String,
    pub description: String,
    pub alias: String,
    pub content_id: String,
    pub square_portrait_path: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]

pub struct Item {
    pub id: i32,
    pub icon_path: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Perk {
    pub id: i32,
    pub icon_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Spell {
    pub id: i32,
    pub icon_path: String,
}

static CHAMPION_CACHE: LazyLock<Cache<i32, Champion>> = LazyLock::new(|| Cache::builder().build());
static ITEM_CACHE: LazyLock<Cache<i32, Item>> = LazyLock::new(|| Cache::builder().build());
static PERK_CACHE: LazyLock<Cache<i32, Perk>> = LazyLock::new(|| Cache::builder().build());
static SPELL_CACHE: LazyLock<Cache<i32, Spell>> = LazyLock::new(|| Cache::builder().build());
static IDTOBASE64_CACHE: LazyLock<Cache<String, String>> =
    LazyLock::new(|| Cache::builder().build());

pub async fn init() {
    let items = lcu_get::<Vec<Item>>(constant::api::ITEM_URI).await.unwrap();
    let champions = lcu_get::<Vec<Champion>>(constant::api::CHAMPION_URI)
        .await
        .unwrap();
    let spells = lcu_get::<Vec<Spell>>(constant::api::SPELL_URI)
        .await
        .unwrap();
    let perks = lcu_get::<Vec<Perk>>(constant::api::PERK_URI).await.unwrap();

    // 将数据存储到缓存中
    for item in items {
        ITEM_CACHE.insert(item.id, item).await;
    }
    for champion in champions {
        CHAMPION_CACHE.insert(champion.id, champion).await;
    }
    for spell in spells {
        SPELL_CACHE.insert(spell.id, spell).await;
    }
    for perk in perks {
        PERK_CACHE.insert(perk.id, perk).await;
    }
}

#[tauri::command]
pub async fn get_asset_base64(type_string: String, id: i32) -> Result<String, String> {
    let cache_key = build_base64_key(&type_string, id);

    if let Some(cached) = IDTOBASE64_CACHE.get(&cache_key).await {
        return Ok(cached);
    }

    let result = match type_string.as_str() {
        // 将 String 转成 &str 用于模式匹配
        "champion" => match get_champion_base64(id).await {
            Ok(base64) => Ok(base64),
            Err(e) => Err(format!("Failed to get champion base64: {}", e)),
        },
        "item" => match get_item_base64(id).await {
            Ok(base64) => Ok(base64),
            Err(e) => Err(format!("Failed to get item base64: {}", e)),
        },
        "spell" => match get_spell_base64(id).await {
            Ok(base64) => Ok(base64),
            Err(e) => Err(format!("Failed to get spell base64: {}", e)),
        },
        // "perk" => Ok(format!("base64_perk_{}", id)),
        "profile" => match get_profile_base64(id).await {
            Ok(base64) => Ok(base64),
            Err(e) => Err(format!("Failed to get profile base64: {}", e)),
        },
        _ => Err("Invalid type string".to_string()),
    };

    // 如果成功获取到base64数据，存入缓存
    if let Ok(ref base64_data) = result {
        IDTOBASE64_CACHE
            .insert(cache_key, base64_data.clone())
            .await;
    }

    result
}

async fn fetch_base64(url: &str) -> Result<String, String> {
    http::lcu_get_img_as_base64(url).await
}

async fn get_champion_base64(id: i32) -> Result<String, String> {
    if let Some(champion) = CHAMPION_CACHE.get(&id).await {
        fetch_base64(&champion.square_portrait_path).await
    } else {
        Err(format!("Champion with id {} not found in cache", id))
    }
}

async fn get_item_base64(id: i32) -> Result<String, String> {
    if let Some(item) = ITEM_CACHE.get(&id).await {
        fetch_base64(&item.icon_path).await
    } else {
        Err(format!("Item with id {} not found in cache", id))
    }
}

async fn get_spell_base64(id: i32) -> Result<String, String> {
    if let Some(spell) = SPELL_CACHE.get(&id).await {
        fetch_base64(&spell.icon_path).await
    } else {
        Err(format!("Spell with id {} not found in cache", id))
    }
}

async fn get_profile_base64(id: i32) -> Result<String, String> {
    let profile_url = format!("/lol-game-data/assets/v1/profile-icons/{}.jpg", id);
    fetch_base64(&profile_url).await
}

fn build_base64_key(type_string: &str, id: i32) -> String {
    format!("{}:{}", type_string, id)
}
