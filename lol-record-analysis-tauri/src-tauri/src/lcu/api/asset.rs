use serde_json::{from_str, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::lcu::util::http;

fn global_map() -> &'static std::sync::Mutex<HashMap<String, String>> {
    static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn get_asset_base64(type_string: String, id: i32) -> Result<String, String> {
    if id < 0 {
        return Err("ID must be a non-negative integer".to_string());
    }
    match type_string.as_str() {
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
    }
}
async fn get_champion_base64(id: i32) -> Result<String, String> {
    print!("get_champion_base64: {}", id);
    let key = format!("base64_champion_{}", id);
    // 先检查缓存
    if !global_map().lock().unwrap().contains_key(&key) {
        let json: String = http::lcu_get("lol-game-data/assets/v1/champion-summary.json").await?;
        let paths = get_path_by_json(&json)?;
        for path in paths {
            let path_uri = if let Some(path_id) = path.get("id") {
                format!("base64_champion_{}", path_id)
            } else {
                continue;
            };
            let base64: String = http::lcu_get_img_as_base64(&path_uri).await?;
            // 每次插入都重新加锁
            global_map().lock().unwrap().insert(key.clone(), base64);
        }
    }
    global_map()
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or("Champion base64 not found".to_string())
}

async fn get_item_base64(id: i32) -> Result<String, String> {
    print!("get_item_base64: {}", id);
    let key = format!("base64_item_{}", id);
    if !global_map().lock().unwrap().contains_key(&key) {
        let json: String = http::lcu_get("lol-game-data/assets/v1/items.json").await?;
        let paths = get_path_by_json(&json)?;
        for path in paths {
            println!("get_item_base64 path: {:?}", path);
            let path_uri = path.get("path").unwrap();
            let base64: String = http::lcu_get_img_as_base64(&path_uri).await?;
            // 每次插入都重新加锁，避免 MutexGuard 跨 await
            global_map().lock().unwrap().insert(key.clone(), base64);
        }
    }
    global_map()
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or("Item base64 not found".to_string())
}

async fn get_spell_base64(id: i32) -> Result<String, String> {
    print!("get_spell_base64: {}", id);
    let key = format!("base64_spell_{}", id);
    if !global_map().lock().unwrap().contains_key(&key) {
        let json: String = http::lcu_get("lol-game-data/assets/v1/summoner-spells.json").await?;
        let paths = get_path_by_json(&json)?;
        println!("get_spell_base64 paths: {:?}", paths);
        for path in paths {
            let path_uri = format!("base64_spell_{}", path.get("id").unwrap());
            let base64: String = http::lcu_get_img_as_base64(&path_uri).await?;
            // 每次插入都重新加锁，避免 MutexGuard 跨 await
            global_map().lock().unwrap().insert(key.clone(), base64);
        }
    }
    global_map()
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or("Spell base64 not found".to_string())
}

async fn get_profile_base64(id: i32) -> Result<String, String> {
    print!("get_profile_base64: {}", id);
    let key = format!("base64_profile_{}", id);
    if !global_map().lock().unwrap().contains_key(&key) {
        let uri = format!("lol-game-data/assets/v1/profile-icons/{}.jpg", id);
        let base64: String = http::lcu_get(&uri).await?;
        // 每次插入都重新加锁
        global_map().lock().unwrap().insert(key.clone(), base64);
    }
    global_map()
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or("Profile base64 not found".to_string())
}

fn get_path_by_json(json: &str) -> Result<Vec<HashMap<String, String>>, String> {
    let value: Value = match from_str(&json) {
        Ok(v) => v,
        Err(e) => return Err(format!("Failed to parse JSON: {}", e)),
    };

    // 确保JSON是一个数组
    let array = match value.as_array() {
        Some(arr) => arr,
        None => return Err("Expected a JSON array".to_string()),
    };

    let mut result = Vec::new();

    // 遍历数组中的每个对象
    for item in array {
        if let Some(obj) = item.as_object() {
            let mut map = HashMap::new();

            // 获取 id
            if let Some(id) = obj.get("id") {
                if let Some(id_str) = id.as_str() {
                    map.insert("id".to_string(), id_str.to_string());
                } else if let Some(id_num) = id.as_i64() {
                    map.insert("id".to_string(), id_num.to_string());
                }
            }

            // 查找键名包含"Path"的键
            for (key, val) in obj {
                if key.contains("Path") {
                    if let Some(path) = val.as_str() {
                        map.insert("path".to_string(), path.to_string());
                    }
                }
            }

            if !map.is_empty() {
                result.push(map);
            }
        }
    }

    if result.is_empty() {
        Err("No valid entries found".to_string())
    } else {
        Ok(result)
    }
}
