//! # LCU 认证获取（Windows / macOS）
//!
//! 通过查找 `LeagueClientUx`（Windows 下为 `LeagueClientUx.exe`）进程并读取其命令行
//! 参数，解析出 `remoting-auth-token` 与 `app-port`，用于后续 LCU HTTP 请求的认证。
//! 命令行读取失败时回退到同目录下的 `lockfile` 兜底。
//!
//! ## 结构
//!
//! 本文件保持单文件结构：平台无关的通用逻辑（解析、兜底、入口）在顶层，平台差异
//! 实现（Windows / macOS 进程枚举与命令行读取）放在文件内的 `platform` 子模块中，
//! 通过 `#[cfg(target_os)]` 分别编译，未引入额外的 `platform/` 目录。
//!
//! | 目标 | 实现 |
//! |------|------|
//! | Windows | `CreateToolhelp32Snapshot` + `NtQueryInformationProcess`，无固定 lockfile 路径，认证走进程查找 |
//! | macOS | 进程枚举用 `libproc`；认证优先读固定安装位置的 lockfile，未命中再用 `sysctl(KERN_PROCARGS2)` 命令行解析 |
//! | 其他 | 由平台无感知的公共逻辑返回明确的不支持错误（此处不编译任何实现） |

use regex::Regex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;

/// LCU 命令行参数解析的正则：`--key`、`--key=value`、`--key="value with spaces"`。
/// 编译一次，避免 `auth_resolver` 高频调用时重复 `Regex::new`。
static AUTH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"--([^\s=]+)(?:=(?:"([^"]+)"|([^\s"]+)))?"#).unwrap());

fn auth_resolver(command_line: &str) -> Result<(String, String), String> {
    let mut params = HashMap::new();

    for cap in AUTH_REGEX.captures_iter(command_line) {
        let key = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let value = cap
            .get(2)
            .map(|m| m.as_str())
            .or_else(|| cap.get(3).map(|m| m.as_str()))
            .unwrap_or("");

        params.insert(key.to_string(), value.to_string());
    }

    let remoting_auth_token = params
        .get("remoting-auth-token")
        .ok_or("命令行中未找到remoting-auth-token参数")?;
    let app_port = params.get("app-port").ok_or("命令行中未找到app-port参数")?;

    if remoting_auth_token.is_empty() || app_port.is_empty() {
        return Err("命令行中未找到必要的认证参数".to_string());
    }

    Ok((remoting_auth_token.clone(), app_port.clone()))
}

/// 上次成功定位的 LeagueClientUx PID 缓存。
///
/// 多线程读写：HTTP 重试路径、game_state_monitor、WebSocket listener 等
/// 可能从不同线程并发调用 `get_auth()`。使用 `AtomicU32` 避免 `static mut`
/// 的数据竞争（Rust UB）。
static CUR_PID: AtomicU32 = AtomicU32::new(0);

/// 解析 lockfile 内容，返回 `(remoting-auth-token, app-port)`。
///
/// lockfile 由客户端写入，格式固定为 `LeagueClient:<pid>:<port>:<token>:<protocol>`，
/// 冒号分隔。token 即 `remoting-auth-token`，与命令行解析出的一致。
fn parse_lockfile(content: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = content.trim().split(':').collect();
    if parts.len() < 5 {
        return Err(format!("lockfile 格式异常（{} 段）", parts.len()));
    }
    let port = parts[2].to_string();
    let token = parts[3].to_string();
    if port.is_empty() || token.is_empty() {
        return Err("lockfile 缺少 port 或 token".to_string());
    }
    Ok((token, port))
}

/// 命令行读取失败时的兜底：通过进程可执行文件路径定位同目录 lockfile 并解析。
///
/// 仅当能读取到进程镜像路径（即非 [`AuthError::AccessDenied`]）时有意义；权限不足
/// 时连路径都拿不到，自然也取不到 lockfile。
fn lockfile_auth_for_pid(pid: u32) -> Result<(String, String), String> {
    let exe_path = platform::read_image_path(pid)?;
    let dir = std::path::Path::new(&exe_path)
        .parent()
        .ok_or("无法从客户端路径推导安装目录")?;
    let lockfile = dir.join("lockfile");
    let content = std::fs::read_to_string(&lockfile)
        .map_err(|e| format!("读取 lockfile {} 失败: {}", lockfile.display(), e))?;
    let auth = parse_lockfile(&content)?;
    // 标记走了兜底路径，便于在日志/遥测里看出命令行失效、是 lockfile 救回来的。
    // 不打印 token / 端口，避免凭据外传。
    log::info!("通过 lockfile 兜底获取认证成功 (pid {})", pid);
    Ok(auth)
}

/// 尝试从单个进程获取认证：优先命令行，失败再回退 lockfile。
fn try_auth_from_pid(pid: u32) -> Result<(String, String), AuthError> {
    match platform::read_command_line(pid) {
        Ok(cmd) if !cmd.is_empty() => auth_resolver(&cmd).or_else(|cmd_err| {
            // 命令行拿到了却没解析出 token，再试一次 lockfile。
            lockfile_auth_for_pid(pid).map_err(|lf| {
                AuthError::Other(format!("命令行解析失败({cmd_err}); lockfile: {lf}"))
            })
        }),
        // 命令行为空/读取失败：lockfile 兜底。
        Ok(_) => lockfile_auth_for_pid(pid).map_err(AuthError::Other),
        Err(platform::CmdError::Failed(e)) => lockfile_auth_for_pid(pid)
            .map_err(|lf| AuthError::Other(format!("命令行读取失败({e}); lockfile: {lf}"))),
        // 权限不足：lockfile 路径同样拿不到，直接归类，交由上层引导提权。
        Err(platform::CmdError::AccessDenied) => Err(AuthError::AccessDenied),
    }
}

/// 按进程名强制结束所有匹配进程（平台无关入口）。
///
/// 用于关闭游戏客户端的兜底路径（LCU 优雅退出不可用时，见
/// `command::launcher::close_league`）。具体实现随平台不同：
/// Windows 用 `OpenProcess` + `TerminateProcess`，macOS 用 `kill(SIGTERM)`。
///
/// # 参数
/// - `name`: 进程名（如 `LeagueClientUx`），不区分大小写的包含匹配
///
/// # 返回值
/// - `Ok(u32)`: 成功结束的进程数（未找到匹配进程时为 0）
/// - `Err(String)`: 进程枚举失败（Windows 创建进程快照失败等）
pub fn kill_processes_by_name(name: &str) -> Result<u32, String> {
    platform::kill_by_name(name)
}

/// 客户端检测失败的归类。
///
/// 上层据此给前端**精确**的处置建议——尤其要把"权限不足"和"游戏没开"分开：
/// 前者需要引导用户以管理员身份运行，后者只是正常等待态，不应弹任何警告。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// 未找到客户端进程——游戏多半没启动，属正常等待态。
    NotRunning,
    /// 找到了客户端进程，但无权读取它的信息。
    ///
    /// 典型成因：游戏以更高权限运行，而本工具是普通权限，读取被拒绝。解法是让
    /// 本工具也以相同权限运行。
    AccessDenied,
    /// 其他失败（命令行读取/解析、lockfile 读取等）。
    Other(String),
}

impl AuthError {
    /// 稳定的机器可读错误码，供前端按码分支与遥测聚合。
    pub fn code(&self) -> &'static str {
        match self {
            AuthError::NotRunning => "NOT_RUNNING",
            AuthError::AccessDenied => "ACCESS_DENIED",
            AuthError::Other(_) => "OTHER",
        }
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::NotRunning => write!(f, "未找到英雄联盟客户端进程"),
            AuthError::AccessDenied => write!(
                f,
                "检测到游戏客户端，但无权读取其信息。请以管理员身份运行本工具（或不要以管理员身份运行游戏）。"
            ),
            AuthError::Other(e) => write!(f, "{}", e),
        }
    }
}

/// 获取当前 LCU 认证信息，带失败归类。
///
/// 各平台流程一致：先枚举 `LeagueClientUx` 进程判断游戏是否运行（空 → `NotRunning`），
/// 再获取认证——优先平台 lockfile 快捷路径（macOS 固定安装位置），否则从进程命令行
/// 解析 `remoting-auth-token` 与 `app-port`，仍失败再回退读取进程同目录 lockfile。
/// 无法获取时返回 [`AuthError`]，区分 "游戏没开 / 权限不足 / 其他失败"。
pub fn get_auth_detailed() -> Result<(String, String), AuthError> {
    log::info!("开始查找英雄联盟客户端进程...");
    let pids = platform::find_pids_by_name("LeagueClientUx").map_err(AuthError::Other)?;

    log::info!("找到 {} 个进程", pids.len());
    if pids.is_empty() {
        return Err(AuthError::NotRunning);
    }

    // 进程确认存在后，优先用平台 lockfile 快捷路径取认证（macOS 固定安装位置；
    // Windows 无固定路径返回 None）。这不会绕过上面的进程存在性判断，lockfile
    // 仅作为凭证来源，与命令行解析同层级。
    if let Some(auth) = platform::read_lockfile_auth() {
        log::info!("通过平台 lockfile 快捷路径获取认证成功");
        return Ok(auth);
    }

    let cached_pid = CUR_PID.load(Ordering::Relaxed);
    let mut saw_access_denied = false;
    let mut last_other: Option<String> = None;

    // 先尝试非缓存的进程（缓存进程留作最后兜底，沿用历史行为）。
    for &pid in pids.iter().filter(|&&p| p != cached_pid) {
        log::info!("正在检查PID: {}", pid);
        match try_auth_from_pid(pid) {
            Ok(auth) => {
                CUR_PID.store(pid, Ordering::Relaxed);
                log::info!("找到有效进程，PID: {}", pid);
                return Ok(auth);
            }
            Err(AuthError::AccessDenied) => saw_access_denied = true,
            Err(AuthError::Other(e)) => {
                log::info!("获取进程 {} 的认证失败: {}", pid, e);
                last_other = Some(e);
            }
            Err(AuthError::NotRunning) => {}
        }
    }

    // 兜底：缓存 pid 仍在存活进程里时再试一次。
    if cached_pid > 0 && pids.contains(&cached_pid) {
        if let Ok(auth) = try_auth_from_pid(cached_pid) {
            log::info!("使用缓存 PID {} 命中", cached_pid);
            return Ok(auth);
        }
    }

    if saw_access_denied {
        log::warn!("检测到客户端进程但无权读取（疑似游戏以管理员身份运行）");
        Err(AuthError::AccessDenied)
    } else if let Some(e) = last_other {
        Err(AuthError::Other(e))
    } else {
        Err(AuthError::NotRunning)
    }
}

/// 获取当前 LCU 认证信息（字符串错误版，供既有 HTTP / WebSocket 调用方使用）。
///
/// 等价于 [`get_auth_detailed`]，仅把 [`AuthError`] 拍平为人类可读字符串。
pub fn get_auth() -> Result<(String, String), String> {
    get_auth_detailed().map_err(|e| e.to_string())
}

/// 从正在运行的 `LeagueClientUx` 反推游戏安装根目录。
///
/// 客户端进程位于 `<root>\LeagueClient\LeagueClientUx`，向上两级即安装根目录
/// （其下有 `Launcher\Client.exe` / `TCLS\Client.exe` 腾讯登录客户端，供免 WeGame
/// 一键启动）。仅在客户端运行时可用；游戏未启动时返回 `None`。
///
/// 供 [`crate::command::launcher`] 在"已连接"时记忆路径——之后即便游戏关闭，也能
/// 凭记忆的路径直接拉起登录客户端，无需读注册表。
pub fn get_client_install_root() -> Option<std::path::PathBuf> {
    let pids = platform::find_pids_by_name("LeagueClientUx").ok()?;
    for pid in pids {
        if let Ok(exe_path) = platform::read_image_path(pid) {
            if let Some(root) = std::path::Path::new(&exe_path)
                .parent() // <root>\LeagueClient
                .and_then(|p| p.parent())
            // <root>
            {
                return Some(root.to_path_buf());
            }
        }
    }
    None
}

/// 从运行中的 `LeagueClientUx` 命令行提取 **Riot Client** 本地 API 认证。
///
/// LCU 由 `RiotClientServices` 拉起，其命令行同时带 `--riotclient-auth-token` 与
/// `--riotclient-app-port`，指向 Riot Client 的本地 HTTP 服务（与 LCU 是**两个不同的
/// 本地服务**）。跨区 `name#TAG → puuid` 的 `player-account/aliases` 查询在 RC 端口、
/// 不在 LCU 端口，故全区搜索需要这份认证。返回 `(auth_token, app_port)`。
pub fn get_riot_client_auth() -> Result<(String, String), String> {
    let pids = platform::find_pids_by_name("LeagueClientUx")?;
    if pids.is_empty() {
        return Err("未找到英雄联盟客户端进程".to_string());
    }
    for pid in pids {
        let cmd = match platform::read_command_line(pid) {
            Ok(c) if !c.is_empty() => c,
            _ => continue,
        };
        let mut token: Option<String> = None;
        let mut port: Option<String> = None;
        for cap in AUTH_REGEX.captures_iter(&cmd) {
            let key = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let val = cap
                .get(2)
                .map(|m| m.as_str())
                .or_else(|| cap.get(3).map(|m| m.as_str()))
                .unwrap_or("");
            match key {
                "riotclient-auth-token" => token = Some(val.to_string()),
                "riotclient-app-port" => port = Some(val.to_string()),
                _ => {}
            }
        }
        if let (Some(t), Some(p)) = (token, port) {
            if !t.is_empty() && !p.is_empty() {
                return Ok((t, p));
            }
        }
    }
    Err("命令行中未找到 riotclient-auth-token / riotclient-app-port".to_string())
}

/// 平台差异实现（Windows / macOS）。
///
/// 对外暴露统一接口：`find_pids_by_name`、`read_command_line`、`read_image_path`、
/// `kill_by_name`、`read_lockfile_auth`。各平台子模块用 `#[cfg(target_os)]` 分别编译，
/// 其他平台不编译任何实现（上层逻辑返回明确的不支持错误）。
mod platform {
    /// 进程命令行读取的失败归类。
    ///
    /// 区分"无权访问"（Windows 下句柄都打不开，通常是游戏以管理员身份运行而本工具
    /// 没有；macOS 下被 `ptrace`/SIP 保护）与其他失败，便于上层 [`super::AuthError`]
    /// 给前端精确的处置建议。
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum CmdError {
        /// 无权限访问目标进程（`OpenProcess` 被拒 / macOS `sysctl` 被拒）。
        AccessDenied,
        /// 其他失败（句柄已打开但读取命令行失败等）。
        Failed(String),
    }

    #[cfg(target_os = "macos")]
    pub use macos::*;
    #[cfg(target_os = "windows")]
    pub use windows::*;

    /// Windows 平台实现。
    ///
    /// 通过 Toolhelp32 快照枚举进程、`NtQueryInformationProcess` 读取命令行、
    /// `QueryFullProcessImageNameW` 取镜像路径。
    #[cfg(target_os = "windows")]
    pub mod windows {
        use super::CmdError;
        // `ProcessCommandLineInformation` 是 ntapi 的 `ENUM!{enum PROCESSINFOCLASS}` 生成的
        // **常量**（值 60），不是类型；直接作为 NtQueryInformationProcess 的第二个参数传入。
        use ntapi::ntpsapi::{NtQueryInformationProcess, ProcessCommandLineInformation};
        use std::mem;
        use std::path::PathBuf;
        use winapi::shared::minwindef::FALSE;
        use winapi::shared::ntdef::UNICODE_STRING;
        use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
        use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
        use winapi::um::tlhelp32::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use winapi::um::winbase::QueryFullProcessImageNameW;
        use winapi::um::winnt::{HANDLE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};

        /// `Windows` `ERROR_ACCESS_DENIED`：`OpenProcess` 对更高完整性级别（如以管理员
        /// 身份运行的客户端）的进程会返回此错误。
        const ERROR_ACCESS_DENIED: i32 = 5;

        struct ProcessHandle(HANDLE);

        impl Drop for ProcessHandle {
            fn drop(&mut self) {
                if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                    unsafe { CloseHandle(self.0) };
                }
            }
        }

        /// 按进程名枚举 PID（不区分大小写的包含匹配）。
        pub fn find_pids_by_name(name: &str) -> Result<Vec<u32>, String> {
            let name_lower = name.to_lowercase();
            let mut pids = Vec::new();

            unsafe {
                let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                if snapshot == INVALID_HANDLE_VALUE {
                    return Err(format!(
                        "无法创建进程快照: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                let _snapshot_handle = ProcessHandle(snapshot);

                let mut entry: PROCESSENTRY32W = mem::zeroed();
                entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

                if Process32FirstW(snapshot, &mut entry) == FALSE {
                    return Err(format!(
                        "无法获取第一个进程: {}",
                        std::io::Error::last_os_error()
                    ));
                }

                loop {
                    let exe_file = &entry.szExeFile;
                    let exe_name = String::from_utf16_lossy(
                        &exe_file[..exe_file
                            .iter()
                            .position(|&x| x == 0)
                            .unwrap_or(exe_file.len())],
                    )
                    .to_lowercase();

                    if exe_name.contains(&name_lower) {
                        pids.push(entry.th32ProcessID);
                    }

                    if Process32NextW(snapshot, &mut entry) == FALSE {
                        break;
                    }
                }
            }

            Ok(pids)
        }

        /// 按进程名强制结束所有匹配进程。
        ///
        /// 单个进程失败只记日志、不影响其余进程。返回成功结束的进程数。
        pub fn kill_by_name(name: &str) -> Result<u32, String> {
            let pids = find_pids_by_name(name)?;
            let mut killed = 0u32;
            for pid in pids {
                unsafe {
                    let handle = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
                    if handle.is_null() {
                        log::warn!(
                            "无法打开进程 {}（{}）以结束: {}",
                            pid,
                            name,
                            std::io::Error::last_os_error()
                        );
                        continue;
                    }
                    let _handle_guard = ProcessHandle(handle);
                    if TerminateProcess(handle, 1) == FALSE {
                        log::warn!(
                            "结束进程 {}（{}）失败: {}",
                            pid,
                            name,
                            std::io::Error::last_os_error()
                        );
                    } else {
                        killed += 1;
                    }
                }
            }
            Ok(killed)
        }

        /// 读取单个进程命令行。
        pub fn read_command_line(pid: u32) -> Result<String, CmdError> {
            log::info!("尝试获取进程 {} 的命令行", pid);
            unsafe {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
                if handle.is_null() {
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() == Some(ERROR_ACCESS_DENIED) {
                        log::warn!("无权打开进程 {}（ACCESS_DENIED）: {}", pid, err);
                        return Err(CmdError::AccessDenied);
                    }
                    return Err(CmdError::Failed(format!("无法打开进程 {}: {}", pid, err)));
                }
                log::info!("成功打开进程句柄");
                let _process_handle = ProcessHandle(handle);

                let initial_size = 8192u32;
                let mut buffer: Vec<u8> = vec![0; initial_size as usize];
                let mut return_size: u32 = 0;

                let status = NtQueryInformationProcess(
                    handle,
                    ProcessCommandLineInformation,
                    buffer.as_mut_ptr() as *mut _,
                    initial_size,
                    &mut return_size,
                );

                if status != 0 {
                    if return_size > initial_size {
                        buffer.resize(return_size as usize, 0);
                        let status = NtQueryInformationProcess(
                            handle,
                            ProcessCommandLineInformation,
                            buffer.as_mut_ptr() as *mut _,
                            return_size,
                            &mut return_size,
                        );
                        if status != 0 {
                            return Err(CmdError::Failed(format!(
                                "NtQueryInformationProcess 失败，状态码: {:#x}",
                                status
                            )));
                        }
                    } else {
                        return Err(CmdError::Failed(format!(
                            "NtQueryInformationProcess 失败，状态码: {:#x}",
                            status
                        )));
                    }
                }

                if return_size == 0 {
                    return Err(CmdError::Failed("返回的缓冲区大小为0".to_string()));
                }

                buffer.truncate(return_size as usize);

                let ucs = &*(buffer.as_ptr() as *const UNICODE_STRING);
                if ucs.Buffer.is_null() || ucs.Length == 0 {
                    return Err(CmdError::Failed(format!(
                        "无效的命令行数据，Buffer: {:?}, Length: {}",
                        ucs.Buffer, ucs.Length
                    )));
                }

                let slice = std::slice::from_raw_parts(ucs.Buffer, (ucs.Length / 2) as usize);
                let cmd_line = String::from_utf16_lossy(slice);

                log::info!("成功获取命令行: {}", cmd_line);
                Ok(cmd_line)
            }
        }

        /// 读取进程可执行文件完整路径（用于定位同目录下的 lockfile）。
        pub fn read_image_path(pid: u32) -> Result<PathBuf, String> {
            let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
            if handle.is_null() {
                return Err(format!(
                    "为读取可执行路径打开进程 {} 失败: {}",
                    pid,
                    std::io::Error::last_os_error()
                ));
            }
            let _guard = ProcessHandle(handle);
            unsafe {
                // 客户端安装路径可能很长（含中文/嵌套目录），给足缓冲避免截断。
                let mut buf: Vec<u16> = vec![0; 1024];
                let mut size = buf.len() as u32;
                let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
                if ok == FALSE {
                    return Err(format!(
                        "QueryFullProcessImageNameW 失败: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                Ok(PathBuf::from(String::from_utf16_lossy(
                    &buf[..size as usize],
                )))
            }
        }

        /// Windows 无固定 lockfile 路径，返回 `None`，认证仍走进程查找逻辑。
        pub fn read_lockfile_auth() -> Option<(String, String)> {
            None
        }
    }

    /// macOS 平台实现。
    ///
    /// 进程枚举用 `proc_listallpids` + `proc_pidpath`；认证优先从固定安装位置的 lockfile
    /// 读取，命令行（`sysctl KERN_PROCARGS2`）与进程目录 lockfile 作为兜底。
    #[cfg(target_os = "macos")]
    pub mod macos {
        use super::CmdError;
        use std::mem;
        use std::path::PathBuf;

        /// macOS 上英雄联盟相关进程的可执行文件名（小写，无扩展名）。
        ///
        /// 覆盖客户端本体（`LeagueClientUx`）、LCU 父进程（`LeagueClient`）与对局进程
        /// （`League of Legends`）等形态。进程枚举时按此集合做包含匹配，判定是否属于
        /// LOL 客户端链路，比 Windows 单进程名更全面。
        const MACOS_LCU_NAMES: &[&str] = &["leagueclientux", "leagueclient", "league of legends"];

        /// 按进程名枚举 PID（不区分大小写的包含匹配）。
        ///
        /// macOS 上没有 `CreateToolhelp32Snapshot`，改用 `proc_listallpids` 枚举全部进程，
        /// 再经 `proc_pidpath` 取可执行路径匹配进程名（进程名可能被截断，取完整路径更可靠）。
        /// 匹配集合用 [`MACOS_LCU_NAMES`]，传入的 `name` 仅作兼容保留、不参与匹配——各
        /// 调用方（认证/安装根目录/Riot 认证）统一命中这组 LOL 相关进程即可。
        pub fn find_pids_by_name(_name: &str) -> Result<Vec<u32>, String> {
            let mut pids = Vec::new();
            unsafe {
                // `proc_listallpids` 返回写入的 PID 个数；其空查返回值不可靠，故直接用
                // 足够大的固定缓冲一次性枚举全部进程，避免缓冲过小被截断（LOL 进程
                // PID 通常较大，靠后才会被写入）。
                const MAX_PIDS: usize = 4096;
                let mut buf: Vec<u32> = vec![0; MAX_PIDS];
                let written = libc::proc_listallpids(
                    buf.as_mut_ptr() as *mut libc::c_void,
                    (MAX_PIDS * mem::size_of::<u32>()) as libc::c_int,
                );
                if written <= 0 {
                    return Err(format!(
                        "proc_listallpids 失败: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                // `written` 是写入的 PID 个数（非字节数），直接作为有效元素数遍历。
                let count = (written as usize).min(buf.len());
                for &pid in &buf[..count] {
                    if pid == 0 {
                        continue;
                    }
                    if let Ok(path) = image_path_of(pid) {
                        let file_name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if MACOS_LCU_NAMES.iter().any(|n| file_name.contains(n)) {
                            pids.push(pid);
                        }
                    }
                }
            }
            Ok(pids)
        }

        /// 读取进程可执行文件完整路径（`proc_pidpath`）。
        fn image_path_of(pid: u32) -> Result<PathBuf, String> {
            unsafe {
                let mut buf: Vec<libc::c_char> = vec![0; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
                let len = libc::proc_pidpath(
                    pid as libc::c_int,
                    buf.as_mut_ptr() as *mut libc::c_void,
                    buf.len() as u32,
                );
                if len <= 0 {
                    return Err(format!(
                        "proc_pidpath 失败 (pid {}): {}",
                        pid,
                        std::io::Error::last_os_error()
                    ));
                }
                let bytes: &[u8] =
                    std::slice::from_raw_parts(buf.as_ptr() as *const u8, len as usize);
                let path = String::from_utf8_lossy(bytes).into_owned();
                Ok(PathBuf::from(path))
            }
        }

        /// 读取进程可执行文件完整路径（公开给上层用于定位 lockfile）。
        pub fn read_image_path(pid: u32) -> Result<PathBuf, String> {
            image_path_of(pid)
        }

        /// 从固定的 lockfile 路径直接读取认证（macOS 客户端固定安装于此）。
        ///
        /// macOS 上国服/海外客户端都安装到 `/Applications/League of Legends.app`，
        /// lockfile 位于 `Contents/LoL/lockfile`，可直接读取，无需进程命令行解析。
        /// 客户端未运行或文件不存在时返回 `None`（交由上层走进程查找逻辑）。
        pub fn read_lockfile_auth() -> Option<(String, String)> {
            let lockfile =
                PathBuf::from("/Applications/League of Legends.app/Contents/LoL/lockfile");
            read_lockfile_at(&lockfile)
        }

        /// 读取并解析指定路径的 lockfile。
        pub fn read_lockfile_at(lockfile: &PathBuf) -> Option<(String, String)> {
            let content = std::fs::read_to_string(lockfile).ok()?;
            let parts: Vec<&str> = content.trim().split(':').collect();
            if parts.len() < 5 {
                return None;
            }
            let port = parts[2].to_string();
            let token = parts[3].to_string();
            if port.is_empty() || token.is_empty() {
                return None;
            }
            Some((token, port))
        }

        /// 读取单个进程命令行（`sysctl KERN_PROCARGS2`）。
        ///
        /// 与 Windows 类似，macOS 上读取他人进程的命令行也需要同用户权限；被
        /// `ptrace`/SIP 保护或权限不足时归类为 [`CmdError::AccessDenied`]。
        pub fn read_command_line(pid: u32) -> Result<String, CmdError> {
            log::info!("尝试获取进程 {} 的命令行", pid);
            unsafe {
                // KERN_ARGMAX 查询：`[CTL_KERN, KERN_ARGMAX]`，取系统单进程命令行长上限。
                let mut argmax: libc::c_int = 0;
                let mut argmax_len = mem::size_of::<libc::c_int>() as libc::size_t;
                let mut argmax_mib: [libc::c_int; 2] = [libc::CTL_KERN, libc::KERN_ARGMAX];
                if libc::sysctl(
                    argmax_mib.as_mut_ptr(),
                    2,
                    &mut argmax as *mut _ as *mut libc::c_void,
                    &mut argmax_len,
                    std::ptr::null_mut(),
                    0,
                ) != 0
                {
                    return Err(CmdError::Failed(format!(
                        "sysctl(KERN_ARGMAX) 失败: {}",
                        std::io::Error::last_os_error()
                    )));
                }

                // KERN_PROCARGS2 查询：`[CTL_KERN, KERN_PROCARGS2, pid]`，取该进程命令行。
                let mut buf: Vec<libc::c_char> = vec![0; argmax as usize];
                let mut buf_len = buf.len() as libc::size_t;
                let mut mib: [libc::c_int; 3] =
                    [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
                if libc::sysctl(
                    mib.as_mut_ptr(),
                    3,
                    buf.as_mut_ptr() as *mut libc::c_void,
                    &mut buf_len,
                    std::ptr::null_mut(),
                    0,
                ) != 0
                {
                    let err = std::io::Error::last_os_error();
                    // EPERM/EACCES/ESRCH（SIP/权限不足/进程已退出）归类为无权访问，
                    // 其余按普通失败。
                    let code = err.raw_os_error().unwrap_or(0);
                    if code == libc::EPERM || code == libc::EACCES || code == libc::ESRCH {
                        log::warn!("无权读取进程 {} 命令行（{}）: {}", pid, code, err);
                        return Err(CmdError::AccessDenied);
                    }
                    return Err(CmdError::Failed(format!(
                        "sysctl(KERN_PROCARGS2) 失败: {}",
                        err
                    )));
                }

                let bytes: &[u8] =
                    std::slice::from_raw_parts(buf.as_ptr() as *const u8, buf_len.min(buf.len()));
                // KERN_PROCARGS2 布局：`argc`（int）+ 0x0 填充 + exec 路径（NUL 结尾）+ 空字节
                // + 参数数组（NUL 分隔）。解析参数时跳过开头的 exec 路径前缀。
                //
                // 调试用：打印原始缓冲区（转义成可读形式，避免二进制/控制字符刷屏），
                // 便于核对 macOS 真实命令行布局是否与解析假设一致。
                log::info!(
                    "macOS 原始命令行缓冲区 (pid {}, {} 字节): {:?}",
                    pid,
                    bytes.len(),
                    escape_debug(bytes)
                );
                let raw = String::from_utf8_lossy(bytes);
                let cmd_line = parse_procargs2(raw.as_ref());
                log::info!("成功获取命令行: {}", cmd_line);
                Ok(cmd_line)
            }
        }

        /// 从 `KERN_PROCARGS2` 原始缓冲区中提取完整命令行（空格拼接）。
        ///
        /// 首部 4 字节为 argc，随后是 exec 路径字符串与若干 NUL 分隔的参数，末尾空串。
        /// 简单起见：去掉首部 argc 与 exec 路径（第一个 NUL 结束），把剩余 NUL 分隔的
        /// 参数以空格连接，供上层正则解析 `--key=value`。
        pub fn parse_procargs2(raw: &str) -> String {
            // 前两段可能被 argc 二进制干扰，通常表现为空/短二进制串；跳过它们。
            let segments: Vec<&str> = raw.split('\0').collect();
            let mut params: Vec<&str> = Vec::new();
            for seg in segments.into_iter().skip(2) {
                let trimmed = seg.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed.contains('=') || trimmed.starts_with("--") {
                    params.push(trimmed);
                }
            }
            params.join(" ")
        }

        /// 把原始字节转义成可读字符串（`\0` / `\xNN`），供调试日志打印二进制缓冲区。
        fn escape_debug(bytes: &[u8]) -> String {
            use std::fmt::Write;
            let mut out = String::with_capacity(bytes.len());
            for &b in bytes {
                match b {
                    0 => out.push_str("\\0"),
                    0x0a => out.push_str("\\n"),
                    0x0d => out.push_str("\\r"),
                    0x20..=0x7e => out.push(b as char),
                    _ => {
                        let _ = write!(out, "\\x{:02x}", b);
                    }
                }
            }
            out
        }

        /// 按进程名强制结束所有匹配进程（macOS 用 `kill`）。
        pub fn kill_by_name(name: &str) -> Result<u32, String> {
            let pids = find_pids_by_name(name)?;
            let mut killed = 0u32;
            for pid in pids {
                unsafe {
                    if libc::kill(pid as libc::pid_t, libc::SIGTERM) == 0 {
                        killed += 1;
                    } else {
                        log::warn!(
                            "结束进程 {}（{}）失败: {}",
                            pid,
                            name,
                            std::io::Error::last_os_error()
                        );
                    }
                }
            }
            Ok(killed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lockfile_extracts_port_and_token() {
        let (token, port) = parse_lockfile("LeagueClient:12345:53970:abcdToken:https").unwrap();
        assert_eq!(port, "53970");
        assert_eq!(token, "abcdToken");
    }

    #[test]
    fn parse_lockfile_tolerates_trailing_newline() {
        let (token, port) = parse_lockfile("LeagueClient:1:2:tok:https\n").unwrap();
        assert_eq!(port, "2");
        assert_eq!(token, "tok");
    }

    #[test]
    fn parse_lockfile_rejects_malformed() {
        assert!(parse_lockfile("LeagueClient:1:2").is_err());
        assert!(parse_lockfile("").is_err());
    }

    #[test]
    fn parse_lockfile_rejects_empty_fields() {
        assert!(parse_lockfile("LeagueClient:1::tok:https").is_err());
        assert!(parse_lockfile("LeagueClient:1:2::https").is_err());
    }

    #[test]
    fn auth_error_codes_are_stable() {
        assert_eq!(AuthError::NotRunning.code(), "NOT_RUNNING");
        assert_eq!(AuthError::AccessDenied.code(), "ACCESS_DENIED");
        assert_eq!(AuthError::Other("x".into()).code(), "OTHER");
    }

    #[test]
    fn access_denied_message_mentions_admin() {
        assert!(AuthError::AccessDenied.to_string().contains("管理员"));
    }

    #[cfg(target_os = "macos")]
    mod macos_tests {
        use super::*;

        #[test]
        fn procargs2_extracts_arguments() {
            // 模拟 KERN_PROCARGS2 布局：argc 区（被 UTF-8 损坏省略）+ exec 路径
            // + 空字节 + 参数。这里用字符串表示 exec 路径与后续参数段。
            let raw = "\0\0\0/Applications/League of Legends.app/Contents/LoL/LeagueClientUx\0--remoting-auth-token=abc\0--app-port=53970\0";
            let cmd = platform::parse_procargs2(raw);
            assert!(cmd.contains("--remoting-auth-token=abc"));
            assert!(cmd.contains("--app-port=53970"));
        }

        #[test]
        fn read_lockfile_at_parses_fixed_path() {
            // 用临时文件模拟固定路径的 lockfile 内容。
            use std::io::Write;
            let tmp = std::env::temp_dir().join("lol-lockfile-test");
            std::fs::File::create(&tmp)
                .unwrap()
                .write_all(b"LeagueClient:12345:53970:abcdToken:https")
                .unwrap();
            let auth = platform::read_lockfile_at(&tmp);
            std::fs::remove_file(&tmp).ok();
            assert_eq!(auth, Some(("abcdToken".to_string(), "53970".to_string())));
        }
    }
}
