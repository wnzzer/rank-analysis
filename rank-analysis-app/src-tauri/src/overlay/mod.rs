//! # 对局内 Overlay 窗口管理（4b overlay POC）
//!
//! 管理透明置顶 overlay 窗口的完整生命周期——创建、显示、隐藏、销毁。
//! 窗口属性：`transparent` / `decorations=false` / `always_on_top` / `focusable=false` /
//! `skip_taskbar` / 鼠标穿透 / 右上角定位。
//!
//! ## 窗口位置
//!
//! 固定在主显示器右上角（评估文档 §3.1：320×200，边距 16px）。
//! 后续可配置化为左上/右下/左下（评估文档 §5.2）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::sync::Mutex;

use tauri::Manager;
use tauri::Position;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

/// 标记 overlay 窗口是否已创建。
static OVERLAY_CREATED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

/// 全局 AppHandle（创建窗口时写入，供后续通过标签查找窗口句柄）。
static APP_HANDLE: LazyLock<Mutex<Option<tauri::AppHandle>>> = LazyLock::new(|| Mutex::new(None));

/// Overlay 窗口固定尺寸（评估文档 §3.1）。
const OVERLAY_WIDTH: f64 = 320.0;
const OVERLAY_HEIGHT: f64 = 200.0;
/// 窗口与屏幕边缘的间距。
const OVERLAY_MARGIN: f64 = 16.0;

/// 创建 overlay 窗口（只建一次，幂等）。
///
/// 窗口初始不可见（`visible(false)`），由 [`show`] 在对局中激活。
/// 创建失败不 panic——降级为主窗口内 Tab 展示（当前 M5a/M5b 行为）。
fn create(app: &tauri::AppHandle) -> Result<(), String> {
    let _w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .transparent(true)
        .visible(false)
        .build()
        .map_err(|e| format!("overlay 窗口创建失败: {e}"))?;

    log::info!("[overlay] 窗口创建完成（置顶/无边框/透明/鼠标穿透）");

    APP_HANDLE.lock().unwrap().replace(app.clone());
    OVERLAY_CREATED.store(true, Ordering::Relaxed);
    Ok(())
}

/// 通过标签查找已创建的 overlay 窗口句柄。
fn get_window() -> Option<tauri::WebviewWindow> {
    let guard = APP_HANDLE.lock().unwrap();
    guard.as_ref()?.get_webview_window("overlay")
}

/// 将 overlay 窗口定位到主显示器右上角（带边距）。
fn position_top_right(app: &tauri::AppHandle) {
    let Some(monitor) = app.primary_monitor().ok().flatten() else {
        log::warn!("[overlay] 无法获取主显示器，窗口保持默认位置");
        return;
    };
    let size = monitor.size();
    let x = size.width as i32 - OVERLAY_WIDTH as i32 - OVERLAY_MARGIN as i32;
    let y = OVERLAY_MARGIN as i32;
    if let Some(w) = get_window() {
        let _ = w.set_position(Position::Physical(tauri::PhysicalPosition::new(x, y)));
    }
}

/// 显示 overlay 窗口（对局中调用）。
pub fn show(app: &tauri::AppHandle) {
    if !OVERLAY_CREATED.load(Ordering::Relaxed) {
        if let Err(e) = create(app) {
            log::warn!("[overlay] 创建失败: {e}");
            return;
        }
    }
    if let Some(w) = get_window() {
        let _ = w.show();
        // 鼠标穿透：对局内悬浮建议不应拦截玩家对游戏窗口的操作
        let _ = w.set_ignore_cursor_events(true);
    }
    position_top_right(app);
}

/// 隐藏 overlay 窗口（对局结束调用）。
pub fn hide() {
    if let Some(w) = get_window() {
        let _ = w.hide();
    }
}

/// 销毁 overlay 窗口（进程退出时清理）。
pub fn destroy() {
    if let Some(w) = get_window() {
        let _ = w.close();
        log::info!("[overlay] 窗口已销毁");
    }
    OVERLAY_CREATED.store(false, Ordering::Relaxed);
    APP_HANDLE.lock().unwrap().take();
}
