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
    let builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false);
    // tauri 的 WebviewWindowBuilder#transparent 在 macOS 上不存在（webview 透明
    // 走 window effects 通道）；overlay 主战场是 Windows 国服，macOS 分支不设透明，
    // 由 CSS 透明背景兜底。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let _w = builder
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
///
/// 以 [`get_window`] 的**真实存活**为准决定是否创建：`OVERLAY_CREATED` 只是
/// 缓存标志，窗口被外部销毁后它仍为 true，若只信标志将永远不再重建。
/// 并发首次 show 时后到者会因 label 冲突创建失败并告警返回——先到者已完成
/// 显示与定位，无实际影响。
pub fn show(app: &tauri::AppHandle) {
    if get_window().is_none() {
        if OVERLAY_CREATED.load(Ordering::Relaxed) {
            log::info!("[overlay] 标志为已创建但窗口不存在，重建...");
        }
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

/// 调整 overlay 窗口尺寸并定位到指定锚点。
///
/// B1 多面板：三选一卡组等面板比原 NextAction 卡大，且需要贴屏幕顶部的
/// 左中右位置。尺寸钳制在合理范围防止把游戏窗口整个盖住。
///
/// # 参数
/// - `anchor`: `"top-left"` | `"top-center"` | `"top-right"`（未知值回退右上）
pub fn layout(app: &tauri::AppHandle, width: f64, height: f64, anchor: &str) {
    let width = width.clamp(200.0, 900.0);
    let height = height.clamp(80.0, 500.0);
    if let Some(w) = get_window() {
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
    }
    position_by_anchor(app, width, anchor);
}

/// 按锚点将窗口贴主显示器顶部（带边距）。
fn position_by_anchor(app: &tauri::AppHandle, width: f64, anchor: &str) {
    let Some(monitor) = app.primary_monitor().ok().flatten() else {
        log::warn!("[overlay] 无法获取主显示器，窗口保持默认位置");
        return;
    };
    let screen_w = monitor.size().width as i32;
    let x = match anchor {
        "top-left" => OVERLAY_MARGIN as i32,
        "top-center" => (screen_w - width as i32) / 2,
        // 默认右上（历史行为）
        _ => screen_w - width as i32 - OVERLAY_MARGIN as i32,
    };
    if let Some(w) = get_window() {
        let _ = w.set_position(Position::Physical(tauri::PhysicalPosition::new(x, OVERLAY_MARGIN as i32)));
    }
}

/// 切换鼠标穿透。
///
/// 三选一识别失败时的手动校正面板需要接收点击，其余时间保持穿透，
/// 避免悬浮窗挡住游戏操作。
pub fn set_click_through(enabled: bool) -> Result<(), String> {
    let Some(w) = get_window() else {
        return Err("overlay 窗口不存在".to_string());
    };
    w.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
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
