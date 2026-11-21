//! 赛后右下角弹卡（设计见 docs/superpowers/specs/2026-11-19-postgame-toast-design.md）
//!
//! 排位结算时在主显示器右下角（任务栏 / 托盘上方）弹一个小窗，把玩家从 LOL 客户端
//! 引回战报与标注。触发放在 Rust：主窗口最小化后 WebView2 会节流前端定时器，
//! 靠前端 watch 阶段再开窗不可靠。
//!
//! - 只弹 420 / 440（与隐藏分同一队列判断），每局一次
//! - **不看主窗口在不在前台，一律弹**。曾经有过「主窗口已在前台就不弹」的规则，
//!   但那个判断靠不住：游戏进程退出时 Windows 会先把焦点还给玩家上一个用过的窗口，
//!   如果正好是我们的主窗口，结算瞬间它就算「在前台」，一两秒后客户端才盖上来——
//!   玩家看着客户端结算页，弹卡却被压掉了（真机 2026-11-21，v2.2.2 日志
//!   `16:44:50 赛后弹卡：主窗口在前台，不弹`）。弹卡不抢焦点、25 秒自动收起，
//!   多弹一次的代价远小于该弹没弹
//! - 窗口不抢焦点（`focused(false)` + `focusable(false)`），不能打断玩家点「再来一局」
//! - 窗口先隐藏创建，弹卡页面取到数据后自己 show；取不到 / 重开局自己关
//! - 进选人 / 匹配时立刻关掉
//! - 设置 `postGameToast`（缺省视为开启）关闭时不弹

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constant::game;

/// 弹卡窗口 label 前缀（后接 gameId）；capability `postgame-toast-*` 与前端判断依赖它
pub const TOAST_LABEL_PREFIX: &str = "postgame-toast-";

/// 设置键：是否开启赛后弹卡。键不存在时视为开启
pub const CONFIG_KEY: &str = "postGameToast";

/// 弹卡要主窗口跳到对局页时发给主窗口的事件
pub const NAVIGATE_EVENT: &str = "postgame-toast-navigate";

/// 卡片本体尺寸（CSS 像素），与前端 `PostGameToast.vue` 的 `.pgt-card` 一致
const CARD_W: f64 = 340.0;
const CARD_H: f64 = 184.0;

/// 卡片四周给投影留的透明边（只在支持透明窗口的平台上留；mac 未开 private api，窗口不透明）
#[cfg(not(target_os = "macos"))]
const SHADOW_PAD: f64 = 20.0;
#[cfg(target_os = "macos")]
const SHADOW_PAD: f64 = 0.0;

/// 窗口与工作区边缘的距离（mac 窗口不透明，没有透明边垫着，单独留一点）
#[cfg(not(target_os = "macos"))]
const EDGE_GAP: f64 = 0.0;
#[cfg(target_os = "macos")]
const EDGE_GAP: f64 = 16.0;

/// 结算页刚出现时对局端点常常还没就绪：每 3 秒问一次，最多 1 分钟
const FIND_INTERVAL: Duration = Duration::from_secs(3);
const FIND_ATTEMPTS: u32 = 20;

/// 已弹过的 gameId（PreEndOfGame 与 EndOfGame 各触发一次，同一局只弹一次）
static SHOWN_GAME: AtomicI64 = AtomicI64::new(0);

/// 阶段变化入口（由 `game_state_monitor` 在阶段变化时调用）
///
/// # 行为
/// - `PreEndOfGame` / `EndOfGame`：后台确认对局后弹出
/// - `ChampSelect` / `Matchmaking`：关掉还开着的弹卡
pub fn on_phase_change(app: AppHandle, phase: &str) {
    match phase {
        game::PREENDOFGAME | game::ENDOFGAME => {
            tokio::spawn(async move { maybe_show(app).await });
        }
        game::CHAMPSELECT | game::MATCHMAKING => close_all(&app),
        _ => {}
    }
}

/// 这一局要不要弹：排位队列、有效 gameId、本局还没弹过
///
/// # 参数
/// - `queue_type`: 结算统计里的队列名（`RANKED_SOLO_5x5` 等）
/// - `game_id`: 本局 gameId
/// - `last_shown`: 上次弹过的 gameId
pub fn should_show(queue_type: &str, game_id: i64, last_shown: i64) -> bool {
    crate::hidden_mmr::collector::is_ranked_queue(queue_type)
        && game_id > 0
        && game_id != last_shown
}

/// 弹卡窗口的逻辑尺寸（含投影边）
pub fn window_size() -> (f64, f64) {
    (CARD_W + 2.0 * SHADOW_PAD, CARD_H + 2.0 * SHADOW_PAD)
}

/// 弹卡窗口左上角的逻辑坐标：贴在工作区右下角
///
/// 工作区已经扣掉任务栏 / Dock，所以这就是「托盘上方」。
///
/// # 参数
/// - `area_x` / `area_y` / `area_w` / `area_h`: 工作区（物理像素）
/// - `scale`: 显示器缩放倍率
pub fn toast_position(
    area_x: i32,
    area_y: i32,
    area_w: u32,
    area_h: u32,
    scale: f64,
) -> (f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let (w, h) = window_size();
    let right = (area_x as f64 + area_w as f64) / scale;
    let bottom = (area_y as f64 + area_h as f64) / scale;
    (right - w - EDGE_GAP, bottom - h - EDGE_GAP)
}

/// 设置是否开启（缺省 / 读不到都按开启）
async fn enabled() -> bool {
    crate::config::get_config(CONFIG_KEY)
        .await
        .ok()
        .and_then(|v| crate::config::extract_bool(&v))
        .unwrap_or(true)
}

async fn maybe_show(app: AppHandle) {
    if !enabled().await {
        return;
    }
    let mut found = None;
    for _ in 0..FIND_ATTEMPTS {
        if let Ok((game_id, queue_type, _)) =
            crate::hidden_mmr::collector::fetch_current_game().await
        {
            found = Some((game_id, queue_type));
            break;
        }
        tokio::time::sleep(FIND_INTERVAL).await;
    }
    let Some((game_id, queue_type)) = found else {
        log::info!("赛后弹卡：一直取不到结算对局，不弹");
        return;
    };
    if !should_show(&queue_type, game_id, SHOWN_GAME.load(Ordering::SeqCst)) {
        return;
    }
    // 两个阶段的触发者可能同时走到这里：只放行先占到位的那个
    if SHOWN_GAME.swap(game_id, Ordering::SeqCst) == game_id {
        return;
    }
    if let Err(e) = open(&app, game_id) {
        log::warn!("赛后弹卡：创建窗口失败: {}", e);
    }
}

/// 关掉所有弹卡窗口
fn close_all(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(TOAST_LABEL_PREFIX) {
            let _ = window.close();
        }
    }
}

/// 创建弹卡窗口（隐藏，前端取到数据后自己 show）
fn open(app: &AppHandle, game_id: i64) -> tauri::Result<()> {
    // 上一局没关掉的弹卡（玩家一直停在结算页）
    close_all(app);

    let (x, y) = match app.primary_monitor()? {
        Some(m) => {
            let area = m.work_area();
            toast_position(
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
                m.scale_factor(),
            )
        }
        None => (0.0, 0.0),
    };
    let (w, h) = window_size();
    let label = format!("{}{}", TOAST_LABEL_PREFIX, game_id);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("本局战报")
        .inner_size(w, h)
        .position(x, y)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false);
    // 透明窗口 + 自绘投影；mac 未开 macos-private-api，用系统投影、窗口不透明
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true).shadow(false);
    #[cfg(target_os = "macos")]
    let builder = builder.shadow(true);
    builder.build()?;
    Ok(())
}

/// 弹卡上的按钮：把主窗口拉到前台并跳到对局页（战报所在位置），然后关掉弹卡
///
/// 这里抢焦点是玩家主动点按钮的结果，可以接受。
///
/// # 参数
/// - `window`: 发起调用的弹卡窗口（命令自动注入）
#[tauri::command]
pub fn postgame_toast_open_main(app: AppHandle, window: tauri::WebviewWindow) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit(NAVIGATE_EVENT, "/Gaming");
    }
    if window.label().starts_with(TOAST_LABEL_PREFIX) {
        let _ = window.close();
    }
}

/// 弹卡打点：前端动作名 → 静态功能名（白名单，未知动作返回 None 不上报）
pub fn toast_feature(action: &str) -> Option<&'static str> {
    match action {
        "shown" => Some("postgame_toast_shown"),
        "guess" => Some("postgame_toast_guess"),
        "open" => Some("postgame_toast_open"),
        "copied" => Some("postgame_toast_copied"),
        "closed" => Some("postgame_toast_closed"),
        "expired" => Some("postgame_toast_expired"),
        _ => None,
    }
}

/// 弹卡用量打点（展示 / 去猜 / 看战报 / 复制 / 手动关 / 超时关）
///
/// # 参数
/// - `action`: 见 [`toast_feature`]，其余忽略
#[tauri::command]
pub fn track_postgame_toast(action: String) {
    if let Some(feature) = toast_feature(&action) {
        crate::observability::track_feature(feature);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_show_only_ranked_and_once_per_game() {
        assert!(should_show("RANKED_SOLO_5x5", 42, 0));
        assert!(should_show("RANKED_FLEX_SR", 42, 41));
        assert!(!should_show("RANKED_SOLO_5x5", 42, 42));
        assert!(!should_show("NORMAL_DRAFT", 42, 0));
        assert!(!should_show("ARAM_UNRANKED_5x5", 42, 0));
        assert!(!should_show("RANKED_SOLO_5x5", 0, 0));
    }

    #[test]
    fn should_place_toast_at_bottom_right_of_work_area() {
        let (w, h) = window_size();

        // 1920×1080，任务栏 40px 在底部，100% 缩放
        let (x, y) = toast_position(0, 0, 1920, 1040, 1.0);
        assert_eq!(x, 1920.0 - w - EDGE_GAP);
        assert_eq!(y, 1040.0 - h - EDGE_GAP);

        // 150% 缩放：物理像素换算成逻辑像素
        let (x, y) = toast_position(0, 0, 2880, 1560, 1.5);
        assert_eq!(x, 1920.0 - w - EDGE_GAP);
        assert_eq!(y, 1040.0 - h - EDGE_GAP);

        // 副屏在左侧（负坐标）也按工作区原点计算
        let (x, _) = toast_position(-1920, 0, 1920, 1040, 1.0);
        assert_eq!(x, -w - EDGE_GAP);
    }

    #[test]
    fn should_fall_back_to_scale_one_on_bad_scale() {
        assert_eq!(
            toast_position(0, 0, 100, 100, 0.0),
            toast_position(0, 0, 100, 100, 1.0)
        );
    }

    #[test]
    fn should_map_only_whitelisted_toast_actions() {
        assert_eq!(toast_feature("shown"), Some("postgame_toast_shown"));
        assert_eq!(toast_feature("guess"), Some("postgame_toast_guess"));
        assert_eq!(toast_feature("open"), Some("postgame_toast_open"));
        assert_eq!(toast_feature("copied"), Some("postgame_toast_copied"));
        assert_eq!(toast_feature("closed"), Some("postgame_toast_closed"));
        assert_eq!(toast_feature("expired"), Some("postgame_toast_expired"));
        assert_eq!(toast_feature("anything else"), None);
    }
}
