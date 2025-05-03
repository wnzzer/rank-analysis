#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            my_custom_command,
            another_command 
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn my_custom_command() -> String {
    println!("I was invoked from JavaScript!");
    "Hello from Rust!".to_string()
}

#[tauri::command]
fn another_command(name: String) -> String {
    println!("Received name: {}", name);
    format!("Hello, {}!", name)
}
