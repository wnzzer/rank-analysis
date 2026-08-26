//! # Overlay 窗口命令（4b overlay POC）
//!
//! 暴露给前端的 overlay 控制命令。

use crate::live::NextAction;
use tauri::Emitter;

/// 显示 overlay 窗口（对局中由前端 Gaming.vue 调用）。
///
/// 创建/显示透明置顶 overlay 窗口，设置鼠标穿透。
/// 场景：phase 转 InProgress 时调用。
#[tauri::command]
pub fn show_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::overlay::show(&app);
    Ok(())
}

/// 隐藏 overlay 窗口（对局结束由前端调用）。
///
/// 场景：phase 离开 InProgress 时调用。
#[tauri::command]
pub fn hide_overlay_window() -> Result<(), String> {
    crate::overlay::hide();
    Ok(())
}

/// 向 overlay 窗口推送 NextAction 建议数据。
///
/// 主窗口（Gaming.vue）轮询 `get_next_actions`（前端 30s 节流），结果通过此命令
/// 经 `overlay:update` 事件送达 overlay 窗口。定向 [`Emitter::emit_to`] 只发给
/// overlay：全局广播会把同一份数据冗余投递给主窗与全部 record-* 子窗口。
#[tauri::command]
pub fn push_overlay_data(app: tauri::AppHandle, actions: Vec<NextAction>) -> Result<(), String> {
    if let Err(e) = app.emit_to("overlay", "overlay:update", &actions) {
        return Err(format!("overlay 数据推送失败: {e}"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// B1 多面板框架
// ---------------------------------------------------------------------------

/// 向指定 overlay 面板推送任意负载（B1 面板信封）。
///
/// 与 [`push_overlay_data`] 的区别：事件为 `overlay:panel`，payload 为
/// `{ panel, payload }` 信封——overlay 端按 `panel` 分发到注册的渲染组件，
/// 主窗侧无需关心 overlay 内部结构。
#[tauri::command]
pub fn push_overlay_panel(
    app: tauri::AppHandle,
    panel: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let envelope = serde_json::json!({ "panel": panel, "payload": payload });
    if let Err(e) = app.emit_to("overlay", "overlay:panel", &envelope) {
        return Err(format!("overlay 面板推送失败: {e}"));
    }
    Ok(())
}

/// 调整 overlay 尺寸与锚点（`top-left` / `top-center` / `top-right`）。
#[tauri::command]
pub fn set_overlay_layout(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    anchor: String,
) -> Result<(), String> {
    crate::overlay::layout(&app, width, height, &anchor);
    Ok(())
}

/// 切换鼠标穿透（true=穿透；手动校正面板交互时传 false）。
#[tauri::command]
pub fn set_overlay_click_through(enabled: bool) -> Result<(), String> {
    crate::overlay::set_click_through(enabled)
}
