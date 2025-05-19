// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
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
        // 添加库的命令插件
        .plugin(lol_record_analysis_tauri_lib::setup_commands())
        // 添加进程管理
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
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
