//! # 免 WeGame 启动命令模块
//!
//! 直接拉起国服英雄联盟的「腾讯登录客户端」（`Launcher\Client.exe`，回退
//! `TCLS\Client.exe`），跳过 WeGame 主客户端。WeGame 点「开始游戏」本质就是拉起
//! 这个登录客户端；用绝对路径直接 spawn 它即可，登录后它会链式拉起
//! `RiotClientServices → LeagueClient → LeagueClientUx`，随后本工具的 LCU 连接
//! 自动就绪。注意：仍会弹腾讯登录窗，非免密登录。
//!
//! ## 安装目录发现（无需读注册表）
//!
//! 1. **config 记忆**（主来源）：客户端在线时由 [`remember_install_root`]（在
//!    `game_state_monitor` 检测到「已连接」时调用）从运行进程反推根目录并持久化。
//! 2. **进程反推**：极少数「已连着还点启动」时，直接从运行进程取。
//! 3. **扫盘兜底**：遍历盘符找默认安装位置 `<盘>:\WeGameApps\英雄联盟`。
//!
//! 三者皆失败时返回明确错误，引导用户先手动打开一次游戏（之后即被记忆）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::config::{self, Value};

/// 游戏安装根目录的 config 键；与前端 `CONFIG_KEYS.gameInstallPath` 对应。
const GAME_INSTALL_PATH_KEY: &str = "gameInstallPath";

/// 安装根目录下的登录客户端候选路径，按优先级排列。
///
/// 优先 `Launcher\Client.exe`（LeagueAkari 实测同款、最稳），回退 `TCLS\Client.exe`
/// （部分版本/机器只装了这个）。仅拼路径、不查存在性，便于纯逻辑单测。
fn launch_target_candidates(root: &Path) -> [PathBuf; 2] {
    [
        root.join("Launcher").join("Client.exe"),
        root.join("TCLS").join("Client.exe"),
    ]
}

/// 在安装根目录下定位首个真实存在的登录客户端 exe。
fn resolve_launch_target(root: &Path) -> Option<PathBuf> {
    launch_target_candidates(root)
        .into_iter()
        .find(|p| p.is_file())
}

/// 读取 config 中记忆的安装根目录（存在且仍是有效目录时才返回）。
async fn read_remembered_root() -> Option<PathBuf> {
    let value = config::get_config(GAME_INSTALL_PATH_KEY).await.ok()?;
    let root = PathBuf::from(config::extract_string(&value)?);
    root.is_dir().then_some(root)
}

/// 发现游戏安装根目录：config 记忆 → 运行进程反推 → 扫盘默认位置。
async fn discover_game_root() -> Option<PathBuf> {
    // 1) config 记忆（主来源）
    if let Some(root) = read_remembered_root().await {
        return Some(root);
    }
    // 2) 客户端正在运行时直接反推（少见：已连着还点启动）
    if let Some(root) = crate::lcu::util::token::get_client_install_root() {
        if root.is_dir() {
            return Some(root);
        }
    }
    // 3) 扫盘兜底：默认安装位置 <盘>:\WeGameApps\英雄联盟。
    //    以「能否定位到登录客户端 exe」为准，避免命中残留空目录。
    for drive in b'C'..=b'Z' {
        let candidate = PathBuf::from(format!(r"{}:\WeGameApps\英雄联盟", drive as char));
        if resolve_launch_target(&candidate).is_some() {
            return Some(candidate);
        }
    }
    None
}

/// 将安装根目录写入 config（前端包装格式 `{value: String}`）；与已存值一致则跳过写盘。
async fn persist_install_root(root: &Path) {
    if read_remembered_root().await.as_deref() == Some(root) {
        return; // 已记忆且一致，免去重复落盘
    }
    let mut wrapped = HashMap::new();
    wrapped.insert(
        "value".to_string(),
        Value::String(root.to_string_lossy().to_string()),
    );
    // 不打印具体路径：安装路径可能含用户名，日志开启上报时会外传。
    match config::put_config(GAME_INSTALL_PATH_KEY.to_string(), Value::Map(wrapped)).await {
        Ok(()) => log::info!("已记忆游戏安装目录，之后可免 WeGame 一键启动"),
        Err(e) => log::warn!("记忆游戏安装目录失败: {}", e),
    }
}

/// 在客户端「已连接」时记忆其安装目录。
///
/// 由 `game_state_monitor` 在「未连接 → 已连接」转变时调用。此刻
/// `LeagueClientUx.exe` 在运行，可反推出根目录；持久化后即便游戏关闭也能一键启动。
pub async fn remember_install_root() {
    if let Some(root) = crate::lcu::util::token::get_client_install_root() {
        persist_install_root(&root).await;
    }
}

/// 开机自启 Run 键的注册表子路径（HKLM 与 HKCU 共用）。
const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// 判断 Run 键中某条值的数据是否指向腾讯登录客户端的开机自启程序。
///
/// 登录客户端（`Launcher\Client.exe`）被拉起后，会以管理员权限把
/// `<安装根>\Launcher\startup_runner.exe` 注册为开机自启（值名形如 `Client_26`，
/// 随版本变化），导致每次开机自动弹出 LOL 登录窗。这里按「文件名 + 父目录名」
/// 双重匹配定位，与值名、安装盘符无关，也不会误删其他软件的自启项。
fn is_login_client_autostart(data: &str) -> bool {
    let path = Path::new(data.trim().trim_matches('"'));
    let name_is = |name: Option<&std::ffi::OsStr>, expect: &str| {
        name.is_some_and(|n| n.eq_ignore_ascii_case(expect))
    };
    name_is(path.file_name(), "startup_runner.exe")
        && name_is(path.parent().and_then(Path::file_name), "Launcher")
}

/// 清理腾讯登录客户端注册的 LOL 开机自启项。
///
/// 免 WeGame 直接拉起 `Launcher\Client.exe` 后（经 WeGame 启动亦可能发生），它会
/// 把 `startup_runner.exe` 写入机器级 Run 键（实测在 HKLM 的 32 位视图，即
/// `WOW6432Node`），使 LOL 每次开机自启。本函数扫描 HKLM（64/32 位视图）与 HKCU
/// 的 Run 键，删除所有指向 `Launcher\startup_runner.exe` 的值。
///
/// 删除 HKLM 值需要管理员权限。国服客户端本身以管理员运行，本工具要连上它时
/// 已经提权，故在「已连接/刚断开」时机调用基本必然成功；无权限时记日志静默
/// 跳过，待下次提权运行时再清。
pub fn purge_login_client_autostart() {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WOW64_32KEY,
        KEY_WOW64_64KEY,
    };
    use winreg::types::FromRegValue;
    use winreg::RegKey;

    // HKLM 需分别查 64/32 位视图（后者即 WOW6432Node）；HKCU 的 Run 键不受
    // WOW64 重定向影响，查一次即可。
    let views = [
        (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY),
        (HKEY_CURRENT_USER, 0),
    ];
    for (hive, view) in views {
        // 先只读枚举定位目标值名，再以写权限打开删除：普通权限下多数情况
        // 无目标值，避免无谓的 HKLM 写权限请求失败刷日志。
        let Ok(key) =
            RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_QUERY_VALUE | view)
        else {
            continue;
        };
        let targets: Vec<String> = key
            .enum_values()
            .filter_map(Result::ok)
            .filter(|(_, value)| {
                String::from_reg_value(value).is_ok_and(|data| is_login_client_autostart(&data))
            })
            .map(|(name, _)| name)
            .collect();
        if targets.is_empty() {
            continue;
        }
        let writable =
            match RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE | view) {
                Ok(k) => k,
                Err(e) => {
                    log::info!("发现 LOL 开机自启项但当前无权限清理（需管理员）: {}", e);
                    continue;
                }
            };
        for name in targets {
            match writable.delete_value(&name) {
                Ok(()) => log::info!("已移除腾讯登录客户端注册的 LOL 开机自启项（{}）", name),
                Err(e) => log::warn!("移除 LOL 开机自启项 {} 失败: {}", name, e),
            }
        }
    }
}

/// 免 WeGame 一键启动国服英雄联盟。
///
/// 发现安装根目录后，直接 spawn `Launcher\Client.exe`（回退 `TCLS\Client.exe`）。
/// 成功仅表示登录客户端进程已拉起——随后会弹腾讯登录窗，用户登录后客户端链式
/// 启动，本工具经 `game_state_monitor` 自动感知连接，无需在此等待。
///
/// # 返回值
///
/// - `Ok(())`: 登录客户端已拉起
/// - `Err(String)`: 未找到安装目录 / 未找到登录客户端 exe / spawn 失败（如被杀软拦截）
#[tauri::command]
pub async fn launch_league() -> Result<(), String> {
    let root = discover_game_root()
        .await
        .ok_or("未找到英雄联盟安装目录。请先手动打开一次游戏，之后即可一键启动。")?;
    let target = resolve_launch_target(&root).ok_or_else(|| {
        format!(
            "在 {} 下未找到登录客户端（Launcher\\Client.exe 或 TCLS\\Client.exe），安装可能不完整。",
            root.display()
        )
    })?;
    // spawn 前把根目录记下来，下次直接命中（尤其首次经扫盘发现的情况）。
    persist_install_root(&root).await;
    spawn_detached(&target)?;
    log::info!("已拉起国服登录客户端（免 WeGame）");
    crate::observability::track_feature("launch_league");
    Ok(())
}

/// 关闭客户端兜底强杀的进程链，先杀渲染层（Ux）再杀主进程。
///
/// 刻意不含对局进程 `League of Legends.exe`：对局中强退会被判定为逃跑
/// （掉胜点 + 排队惩罚），代价远超「客户端没关干净」，故只关客户端本体。
const CLIENT_PROCESS_CHAIN: [&str; 2] = ["LeagueClientUx.exe", "LeagueClient.exe"];

/// LCU 空 JSON 请求体（`process-control` 退出端点不需要参数）。
#[derive(serde::Serialize)]
struct EmptyJsonBody {}

/// 关闭正在运行的英雄联盟客户端。
///
/// 优先走 LCU 的 `POST /process-control/v1/process/quit` 让客户端优雅退出
/// （等同于点客户端右上角关闭，客户端自行收尾并带走整条进程链）；LCU 不可用
/// 或请求失败（客户端卡死等）时，兜底按进程名强杀
/// `LeagueClientUx.exe` / `LeagueClient.exe`。
///
/// # 返回值
///
/// - `Ok(())`: 已发出优雅退出指令，或已强制结束至少一个客户端进程
/// - `Err(String)`: 两条路径都失败（通常是客户端本就没在运行）
#[tauri::command]
pub async fn close_league() -> Result<(), String> {
    crate::observability::track_feature("close_league");

    let graceful = crate::lcu::util::http::lcu_post::<serde_json::Value, _>(
        "process-control/v1/process/quit",
        &EmptyJsonBody {},
    )
    .await;
    if graceful.is_ok() {
        log::info!("已通过 LCU 优雅退出游戏客户端");
        return Ok(());
    }

    // LCU 打不通时按进程名强杀兜底；单个进程名失败不影响其余
    let killed: u32 = CLIENT_PROCESS_CHAIN
        .iter()
        .map(|name| crate::lcu::util::token::kill_processes_by_name(name).unwrap_or(0))
        .sum();
    if killed > 0 {
        log::info!("已强制结束 {} 个游戏客户端进程", killed);
        Ok(())
    } else {
        Err("未检测到正在运行的游戏客户端。".to_string())
    }
}

/// 启动目标 exe（工作目录设为其所在目录），需要提权时自动弹 UAC。
///
/// **必须用 `ShellExecuteW` 而非 `std::process::Command`**：国服 `Launcher\Client.exe`
/// 的清单要求管理员权限（含 ACE/TP 反作弊驱动），`CreateProcess`（即 `Command::spawn`）
/// 会以 `ERROR_ELEVATION_REQUIRED`（os error 740）失败。`ShellExecuteW` 用默认动词
/// （`lpVerb = NULL`）会遵循 exe 清单——需要提权时自动弹 UAC（与 WeGame 启动游戏时
/// 弹 UAC 一致），普通 exe 则正常启动。路径作为独立宽字符串参数传入，**不加引号**。
/// 工作目录设为 exe 所在目录，避免其相对依赖的 dll 加载失败。
fn spawn_detached(exe: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::SW_SHOWNORMAL;

    let work_dir = exe.parent().ok_or("无法推导启动工作目录")?;

    // ShellExecuteW 需要以 null 结尾的宽字符串。
    let to_wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
    let file = to_wide(exe.as_os_str());
    let dir = to_wide(work_dir.as_os_str());

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(), // lpVerb = NULL：默认动词，遵循清单（要求提权则弹 UAC）
            file.as_ptr(),
            std::ptr::null(), // 无参数
            dir.as_ptr(),     // 工作目录 = exe 所在目录
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW 返回值 > 32 表示成功；<= 32 为错误码（用户取消 UAC 时为
    // SE_ERR_ACCESSDENIED 等）。
    if (result as isize) <= 32 {
        return Err(format!(
            "启动登录客户端失败（ShellExecuteW 错误码 {}）；若弹出 UAC 请点“是”授权。",
            result as isize
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_candidates_prefer_launcher_over_tcls() {
        let root = Path::new(r"C:\WeGameApps\英雄联盟");
        let candidates = launch_target_candidates(root);

        // 均以 Client.exe 结尾
        assert_eq!(candidates[0].file_name().unwrap(), "Client.exe");
        assert_eq!(candidates[1].file_name().unwrap(), "Client.exe");
        // 优先 Launcher，回退 TCLS
        assert_eq!(
            candidates[0].parent().unwrap().file_name().unwrap(),
            "Launcher"
        );
        assert_eq!(candidates[1].parent().unwrap().file_name().unwrap(), "TCLS");
        // 保持在安装根目录之下
        assert!(candidates[0].starts_with(root));
    }

    #[test]
    fn login_client_autostart_matches_launcher_startup_runner() {
        // 实测被注册的形态（HKLM\...\Run\Client_26）
        assert!(is_login_client_autostart(
            r"C:\WeGameApps\英雄联盟\Launcher\startup_runner.exe"
        ));
        // 自定义安装盘符/路径、带引号、大小写差异均应命中
        assert!(is_login_client_autostart(
            r#""D:\Games\LOL\launcher\Startup_Runner.EXE""#
        ));
    }

    #[test]
    fn login_client_autostart_ignores_unrelated_entries() {
        // 其他软件的自启项不能误删
        assert!(!is_login_client_autostart(
            r"C:\Program Files\Tencent\QQNT\QQ.exe"
        ));
        // 文件名相同但不在 Launcher 目录下（防止碰瓷同名 exe）
        assert!(!is_login_client_autostart(
            r"C:\SomeApp\bin\startup_runner.exe"
        ));
        // 父目录对但文件名不对
        assert!(!is_login_client_autostart(
            r"C:\WeGameApps\英雄联盟\Launcher\Client.exe"
        ));
        assert!(!is_login_client_autostart(""));
    }
}
