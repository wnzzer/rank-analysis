//! # 系统命令模块
//!
//! 与操作系统交互的辅助命令。目前提供"以管理员身份重启"——当检测到游戏客户端
//! 以更高完整性级别（管理员）运行、本工具无权读取其进程信息（`ACCESS_DENIED`）时，
//! 前端据此引导用户提权重启本工具。
//!
//! 采用**按需提权**而非在清单里强制 `requireAdministrator`：后者会让每次启动都弹
//! UAC，并与 `currentUser` 安装模式、自动更新静默重启相冲突。只在真正需要时提权，
//! 普通使用路径不受影响。

/// 以管理员身份重新启动本程序。
///
/// 通过 `ShellExecuteW` 的 `runas` 动词拉起一个提权实例（触发 UAC），成功后退出
/// 当前普通权限实例。用户在 UAC 取消则返回错误，当前实例不退出。
///
/// # 返回值
///
/// - `Ok(())`: 已拉起提权实例（随后当前进程退出）
/// - `Err(String)`: 拉起失败（如用户取消 UAC）
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
