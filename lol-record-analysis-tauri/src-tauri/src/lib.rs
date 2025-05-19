// src/lib.rs

pub mod lcu {
    pub mod util {
        pub mod http;
        pub mod token;
    }
    pub mod api {
        pub mod asset;
    }
}


// src/lib.rs

// 删除原有的 run() 函数

// 暴露命令配置方法
pub fn setup_commands() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("custom_commands")
        .invoke_handler(tauri::generate_handler![
            my_custom_command,
            another_command
        ])
        .build()
}


#[tauri::command(async)]	
fn my_custom_command() -> String {
    println!("I was invoked from JavaScript!");
    "Hello from Rust!".to_string()
}

#[tauri::command(async)]	
fn another_command(name: String) -> String {
    println!("Received name: {}", name);
    format!("Hello, {}!", name)
}
