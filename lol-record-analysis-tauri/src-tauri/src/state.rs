use crate::fandom::data::AramBalanceData;
use moka::future::Cache;
use std::sync::OnceLock;
use std::time::Duration;

// Shared application state managed by Tauri
pub struct AppState {
    pub http_port: OnceLock<u16>,
    pub fandom_cache: Cache<i32, AramBalanceData>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http_port: OnceLock::new(),
            fandom_cache: Cache::builder()
                .time_to_live(Duration::from_secs(2 * 60 * 60))
                .build(),
        }
    }
}
