// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use lol_record_analysis_tauri_lib::command;
use lol_record_analysis_tauri_lib::config;
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

// 添加这一行来导入 CommandExt trait
use std::os::windows::process::CommandExt;

struct BackendProcess(Mutex<Option<std::process::Child>>);

fn start_backend_process() -> std::process::Child {
    let exe_path = std::env::current_exe()
        .expect("Failed to get current exe path")
        .parent()
        .expect("Failed to get parent directory")
        .join("lol-record-analysis.exe");

    Command::new(exe_path)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW 标志
        .spawn()
        .expect("Failed to start backend process")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            command::put_config,
            command::get_config,
            command::get_summoner_by_puuid,
            command::get_summoner_by_name,
            command::get_my_summoner,
            command::rank::get_rank_by_name,
            command::rank::get_win_rate_by_name_mode,
            command::rank::get_win_rate_by_puuid_mode,
            command::get_match_history_by_puuid,
            command::get_match_history_by_name,
            command::get_filter_match_history_by_name,
            command::get_user_tag_by_name,
            command::get_user_tag_by_puuid,
        ])
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            // 执行异步初始化
            tauri::async_runtime::spawn(async move {
                if let Err(e) = config::init_config().await {
                    eprintln!("Failed to initialize config: {}", e);
                }
            });

            if !cfg!(debug_assertions) {
                let process = start_backend_process();
                *app.state::<BackendProcess>().0.lock().unwrap() = Some(process);
            }
            Ok(())
        })
        .on_window_event(|app_handle, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(mut process) = app_handle
                    .state::<BackendProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = process.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
