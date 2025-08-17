use std::sync::OnceLock;

// Shared application state managed by Tauri
pub struct AppState {
    pub http_port: OnceLock<u16>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http_port: OnceLock::new(),
        }
    }
}
