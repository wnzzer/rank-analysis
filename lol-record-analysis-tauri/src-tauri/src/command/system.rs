//! # 系统命令模块
//!
//! 与操作系统交互的辅助命令。目前提供"以管理员身份重启"——当检测到游戏客户端
//! 以更高完整性级别（管理员）运行、本工具无权读取其进程信息（`ACCESS_DENIED`）时，
//! 前端据此引导用户提权重启本工具。
//!
//! 采用**按需提权**而非在清单里强制 `requireAdministrator`：后者会让每次启动都弹
//! UAC，并与 `currentUser` 安装模式、自动更新静默重启相冲突。只在真正需要时提权，
//! 普通使用路径不受影响。

/// 获取匿名设备 ID（「关于」页展示用）。
///
/// 用户报障时附上此 ID，即可在 Sentry 侧按 `user.id` 精确定位其事件/日志/会话。
#[tauri::command]
pub fn get_device_id() -> String {
    crate::observability::current_device_id()
}

/// 返回前端加载游戏资源图片（英雄/装备/符文/技能等）所需的 asset URL 前缀。
///
/// Tauri 自定义协议 `asset` 在不同平台的访问格式不同，硬编码单一份会在某平台
/// 图裂（本地资源加载失败）：
/// - Windows（WebView2）：`http://asset.localhost`
/// - macOS / Linux（WKWebView / WebKitGTK）：自定义 scheme 需用 `asset://localhost`
#[tauri::command]
pub fn get_asset_prefix() -> String {
    asset_prefix().to_string()
}

/// 返回当前操作系统标识（`std::env::consts::OS`，如 `windows` / `macos` / `linux`）。
///
/// 供前端做**平台门控**：部分能力只在 Windows 存在（免 WeGame 一键启动、以管理员
/// 身份重启），在其他平台必然失败。没有这个信息，前端会渲染出点了必报错的死按钮。
#[tauri::command]
pub fn get_platform() -> &'static str {
    std::env::consts::OS
}

/// 平台相关的 asset 协议 URL 前缀（不含尾斜杠）。
pub fn asset_prefix() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "http://asset.localhost"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "asset://localhost"
    }
}

/// 以管理员身份重新启动本程序。
///
/// 通过 `ShellExecuteW` 的 `runas` 动词拉起一个提权实例（触发 UAC），成功后退出
/// 当前普通权限实例。用户在 UAC 取消则返回错误，当前实例不退出。
///
/// # 返回值
///
/// - `Ok(())`: 已拉起提权实例（随后当前进程退出）
/// - `Err(String)`: 拉起失败（如用户取消 UAC）
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn relaunch_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::SW_SHOWNORMAL;

    log::info!("用户请求以管理员身份重启");

    // 失败文本里不带路径：路径含 `C:\Users\<用户名>\`，开启上报时会随日志外传，
    // 而 redact_pii 不覆盖自由文本里的 Windows 路径。
    let exe = std::env::current_exe().map_err(|e| {
        log::error!("以管理员身份重启失败：获取当前程序路径失败: {}", e);
        format!("获取当前程序路径失败: {}", e)
    })?;

    // ShellExecuteW 需要以 null 结尾的宽字符串。
    let to_wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
    let verb = to_wide(OsStr::new("runas"));
    let file = to_wide(exe.as_os_str());

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW 返回值 > 32 表示成功；<= 32 为错误码（用户取消 UAC 时为
    // SE_ERR_ACCESSDENIED 等）。
    if (result as isize) <= 32 {
        log::warn!(
            "以管理员身份重启失败（ShellExecuteW 错误码 {}），用户可能取消了 UAC 提示",
            result as isize
        );
        return Err(format!(
            "以管理员身份重启失败（错误码 {}），用户可能取消了 UAC 提示",
            result as isize
        ));
    }

    // 提权实例已拉起，退出当前普通权限实例，避免两份同时运行。
    log::info!("已拉起提权实例，退出当前普通权限实例");
    app.exit(0);
    Ok(())
}

/// 以管理员身份重新启动本程序（非 Windows 平台占位）。
///
/// macOS 没有 UAC 提权概念，此命令返回明确错误，前端不会对非 Windows 平台展示
/// 「以管理员身份重启」引导。
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn relaunch_as_admin(_app: tauri::AppHandle) -> Result<(), String> {
    Err("当前平台不支持以管理员身份重新启动。".to_string())
}
