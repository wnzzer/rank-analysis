use moka::future::Cache;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::sync::{LazyLock, Mutex};
use tokio::sync::OnceCell;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum Value {
    String(String),
    Integer(i64),
    Boolean(bool),
    List(Vec<Value>),
    Map(HashMap<String, Value>),
}

type ConfigCallback = Box<dyn Fn(&str, &Value) + Send + Sync>;
type CallbackList = Mutex<Vec<ConfigCallback>>;

static CONFIG_PATH: &str = "config.yaml";
static ON_CHANGE_CALLBACK_ARR: LazyLock<CallbackList> = LazyLock::new(|| Mutex::new(Vec::new()));

static CACHE: OnceCell<Cache<String, Value>> = OnceCell::const_new();

pub async fn get_cache() -> &'static Cache<String, Value> {
    CACHE
        .get_or_init(|| async {
            println!("Initializing cache asynchronously...");
            let cache = Cache::builder().build();

            if let Ok(config) = read_config(CONFIG_PATH) {
                for (k, v) in config {
                    // 在 async 块中可以自由 .await
                    cache.insert(k, v).await;
                }
            }
            cache
        })
        .await
}

pub fn register_on_change_callback<F>(callback: F)
where
    F: Fn(&str, &Value) + Send + Sync + 'static,
{
    ON_CHANGE_CALLBACK_ARR
        .lock()
        .unwrap()
        .push(Box::new(callback));
}

// Initialize cache with config data
pub async fn init_config() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match read_config(CONFIG_PATH) {
        Ok(config) => {
            for (key, value) in config {
                get_cache().await.insert(key, value).await;
            }
        }
        Err(e) => eprintln!("Failed to load config: {}", e),
    }
    Ok(())
}

// Read config file
fn read_config(
    path: &str,
) -> Result<HashMap<String, Value>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let config: HashMap<String, Value> = serde_yaml::from_reader(reader)?;
    Ok(config)
}

// Write config to file
async fn write_config() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config: HashMap<String, Value> = get_cache()
        .await
        .iter()
        .map(|(k, v)| (k.as_ref().clone(), v.clone()))
        .collect();
    print!("Writing config: {:?}", config);
    let file = File::create(CONFIG_PATH)?;
    let writer = BufWriter::new(file);
    serde_yaml::to_writer(writer, &config)?;
    Ok(())
}

// Get config value from cache
pub async fn get_config(key: &str) -> Result<Value, String> {
    get_cache()
        .await
        .get(key)
        .await
        .ok_or_else(|| format!("Config not found: {}", key))
}

// Put config into cache and persist
pub async fn put_config(key: String, value: Value) -> Result<(), String> {
    get_cache().await.insert(key.clone(), value.clone()).await;
    for callback in ON_CHANGE_CALLBACK_ARR.lock().unwrap().iter() {
        callback(&key, &value);
    }
    write_config().await.map_err(|e| e.to_string())
}
