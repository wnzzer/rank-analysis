// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::info;
use lol_record_analysis_app_lib::lcu::api::asset as asset_api;
use lol_record_analysis_app_lib::state::AppState;
use lol_record_analysis_app_lib::{automation, command};
use tauri::Manager;

// NOTE: main is no longer async
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 初始化日志，默认 info 级别，可通过 RUST_LOG 环境变量覆盖
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }

    // 配置日志格式，显示时间、级别、文件名、行号和消息
    env_logger::Builder::from_default_env()
        .format_timestamp_millis()
        .format(|buf, record| {
            use std::io::Write;
            // 提取文件名（不含路径）
            let file = record.file().unwrap_or("unknown");
            let file_name = file.split(['/', '\\']).next_back().unwrap_or(file);

            writeln!(
                buf,
                "[{} {} {}:{}] {}",
                buf.timestamp_millis(),
                record.level(),
                file_name,
                record.line().unwrap_or(0),
                record.args()
            )
        })
        .init();

    info!("========================================");
    info!("Starting Tauri application with Asset Protocol");
    info!("Current working directory: {:?}", std::env::current_dir());
    info!("Config file path: config.yaml");
    info!("========================================");

    let mut app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .register_uri_scheme_protocol("asset", move |_app, request| {
            let path = request.uri().path();
            // path is like /champion/123
            let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();

            if parts.len() < 2 {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap();
            }

            let kind = parts[0].to_string();
            let id_str = parts[1];
            let id = match id_str.parse::<i64>() {
                Ok(i) => i,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(400)
                        .body(Vec::new())
                        .unwrap()
                }
            };

            let result = tauri::async_runtime::block_on(async move {
                asset_api::get_asset_binary(kind, id).await
            });

            match result {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", "public, max-age=86400")
                    .body(bytes)
                    .unwrap(),
                Err(e) => tauri::http::Response::builder()
                    .status(404)
                    .body(e.into_bytes())
                    .unwrap(),
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            command::config::put_config,
            command::config::get_config,
            // command::config::get_http_server_port,
            command::config::get_champion_options,
            command::config::get_game_modes,
            command::get_summoner_by_puuid,
            command::get_summoner_by_name,
            command::get_my_summoner,
            command::rank::get_rank_by_name,
            command::rank::get_win_rate_by_name_mode,
            command::rank::get_win_rate_by_puuid_mode,
            command::match_history::get_match_history_by_puuid,
            command::match_history::get_match_history_by_name,
            command::match_history::get_filter_match_history_by_name,
            command::user_tag::get_user_tag_by_puuid,
            command::user_tag::get_user_tag_by_name,
            command::user_tag_config::get_all_tag_configs,
            command::user_tag_config::save_tag_configs,
            command::info::get_platform_name_by_name,
            command::session::get_session_data,
            command::fandom::update_fandom_data,
            command::fandom::get_aram_balance,
        ]);

    app_builder = app_builder.setup(move |app| {
        // 启动自动化系统
        tauri::async_runtime::spawn(async move {
            log::info!("Starting automation system...");
            tokio::spawn(async {
                automation::start_automation().await;
            });

            // Initialize asset caches
            asset_api::init().await;
        });

        // 启动游戏状态监听器
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            lol_record_analysis_app_lib::game_state_monitor::start_game_state_monitor(app_handle)
                .await;
        });

        // Start Fandom data update schedule (every 2 hours)
        let fandom_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match lol_record_analysis_app_lib::fandom::api::fetch_aram_balance_data().await {
                    Ok(data) => {
                        let state = fandom_handle.state::<AppState>();
                        let count = data.len();
                        for (id, balance) in data {
                            state.fandom_cache.insert(id, balance).await;
                        }
                        info!("Updated Fandom ARAM balance data. Count: {}", count);
                    }
                    Err(e) => {
                        log::error!("Failed to update Fandom data: {}", e);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(2 * 60 * 60)).await;
            }
        });

        Ok(())
    });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while building tauri application");

    Ok(())
}
