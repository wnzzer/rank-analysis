//! # 对局内 Overlay 窗口管理（4b overlay POC）
//!
//! 管理透明置顶 overlay 窗口的完整生命周期——创建、显示、隐藏、销毁。
//! 窗口属性：`transparent` / `decorations=false` / `always_on_top` / `focusable=false` /
//! `skip_taskbar` / `set_ignore_cursor_events(true)`（鼠标穿透，不挡游戏操作）。
//!
//! ## 窗口位置
//!
//! 默认右上角（评估文档 §3.1：320×200）。后续可配置化为左上/右下/左下
//! （评估文档 §5.2）。

use std::sync::LazyLock;
use std::sync::Mutex;

use tauri::Manager;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

/// 全局 overlay 窗口句柄（懒创建，全生命周期只建一次）。
static OVERLAY: LazyLock<Mutex<Option<tauri::WebviewWindow>>> = LazyLock::new(|| Mutex::new(None));

/// 创建 overlay 窗口（只建一次，幂等）。
///
/// 窗口初始不可见（`visible(false)`），由 [`show`] 在对局中激活。
/// 创建失败不 panic——降级为主窗口内 Tab 展示（当前 M5a/M5b 行为）。
fn create(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    let w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("")
        .inner_size(320.0, 200.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| format!("overlay 窗口创建失败: {e}"))?;

    w.set_ignore_cursor_events(true)
        .map_err(|e| format!("overlay 鼠标穿透设置失败: {e}"))?;
    log::info!("[overlay] 窗口创建完成（透明/置顶/鼠标穿透）");
    Ok(w)
}

/// 获取或创建 overlay 窗口句柄。
fn get_or_create(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    let mut guard = OVERLAY.lock().unwrap();
    if let Some(ref w) = *guard {
        return Ok(w.clone());
    }
    let w = create(app)?;
    *guard = Some(w.clone());
    Ok(w)
}

/// 显示 overlay 窗口（对局中调用）。
pub fn show(app: &tauri::AppHandle) {
    match get_or_create(app) {
        Ok(w) => {
            let _ = w.show();
            // 再次确保鼠标穿透（防止窗口重构后属性丢失）
            let _ = w.set_ignore_cursor_events(true);
        }
        Err(e) => log::warn!("[overlay] 显示失败: {e}"),
    }
}

/// 隐藏 overlay 窗口（对局结束调用）。
pub fn hide() {
    if let Some(ref w) = *OVERLAY.lock().unwrap() {
        let _ = w.hide();
    }
}

/// 销毁 overlay 窗口（进程退出时清理）。
pub fn destroy() {
    if let Some(w) = OVERLAY.lock().unwrap().take() {
        let _ = w.close();
        log::info!("[overlay] 窗口已销毁");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hide_on_nonexistent_window_is_noop() {
        // 确保 OVERLAY 为空时 hide 不 panic
        assert!(OVERLAY.lock().unwrap().is_none());
        hide();
        assert!(OVERLAY.lock().unwrap().is_none());
    }

    #[test]
    fn destroy_on_nonexistent_window_is_noop() {
        assert!(OVERLAY.lock().unwrap().is_none());
        destroy();
        assert!(OVERLAY.lock().unwrap().is_none());
    }
}
