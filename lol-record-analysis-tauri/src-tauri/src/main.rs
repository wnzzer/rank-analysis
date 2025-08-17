// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use actix_web::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, App, HttpResponse, HttpServer};
use log::info;
use lol_record_analysis_tauri_lib::command;
use lol_record_analysis_tauri_lib::lcu::api::asset as asset_api;
use lol_record_analysis_tauri_lib::state::AppState;
use std::io::Result;
use tauri::Manager;

async fn image_ok(bytes: Vec<u8>, content_type: String) -> actix_web::Result<HttpResponse> {
    Ok(HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, content_type))
        .insert_header((CACHE_CONTROL, "public, max-age=86400"))
        .body(bytes))
}

// 单一对外接口：GET /asset/{kind}/{id}
// kind: champion | item | spell | profile
async fn asset_route(path: web::Path<(String, i64)>) -> actix_web::Result<HttpResponse> {
    let (kind, id) = path.into_inner();
    match asset_api::get_asset_binary(kind, id).await {
        Ok((bytes, ct)) => image_ok(bytes, ct).await,
        Err(e) => Ok(HttpResponse::NotFound().body(e)),
    }
}

// NOTE: main is no longer async
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    info!("Starting Tauri application with HTTP server");

    // Create a channel to send the discovered port from the HTTP server thread to the main thread
    let (tx, rx) = std::sync::mpsc::sync_channel::<u16>(1);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async move {
            // Initialize asset caches BEFORE starting HTTP server so routes can serve assets immediately.
            asset_api::init().await; // logs: Initializing ... + counts

            if let Err(e) = start_http_server(tx).await {
                log::error!("HTTP server error: {}", e);
            }
        });
    });

    let mut app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            command::config::put_config,
            command::config::get_config,
            command::config::get_http_server_port,
            command::config::get_champion_options,
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
        ]);

    // In setup, set the HTTP port once received
    app_builder = app_builder.setup(move |app| {
        if let Ok(port) = rx.recv() {
            let state = app.state::<AppState>();
            let _ = state.http_port.set(port);
        }
        Ok(())
    });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while building tauri application");

    Ok(())
}

async fn start_http_server(tx: std::sync::mpsc::SyncSender<u16>) -> Result<()> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;

    let addr = listener.local_addr()?;
    let port = addr.port();
    // pass port back to the Tauri process
    let _ = tx.send(port);

    HttpServer::new(|| App::new().route("/asset/{kind}/{id}", web::get().to(asset_route)))
        .listen(listener)?
        .run()
        .await
}
