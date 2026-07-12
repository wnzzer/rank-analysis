//! # LCU 认证获取（Windows）
//!
//! 通过查找 `LeagueClientUx.exe` 进程并读取其命令行参数，解析出
//! `remoting-auth-token` 与 `app-port`，用于后续 LCU HTTP 请求的认证。

// Cargo.toml dependencies
use ntapi::ntpsapi::{NtQueryInformationProcess, PROCESS_COMMAND_LINE_INFORMATION};
use regex::Regex;
use std::collections::HashMap;
use std::mem;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;
use winapi::shared::minwindef::{DWORD, FALSE};
use winapi::shared::ntdef::UNICODE_STRING;
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use winapi::um::winbase::QueryFullProcessImageNameW;
use winapi::um::winnt::{HANDLE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};

/// `Windows` `ERROR_ACCESS_DENIED`：`OpenProcess` 对更高完整性级别（如以管理员
/// 身份运行的客户端）的进程会返回此错误。
const ERROR_ACCESS_DENIED: i32 = 5;

/// 读取单个进程命令行的失败归类。
///
/// 区分"无权访问"（句柄都打不开，通常是游戏以管理员身份运行而本工具没有）与
/// 其他失败，便于上层 [`get_auth_detailed`] 给前端精确的处置建议。
enum CmdError {
    /// `OpenProcess` 被拒绝（`ERROR_ACCESS_DENIED`）。
    AccessDenied,
    /// 其他失败（句柄已打开但读取命令行失败等）。
    Failed(String),
}

mod ntapi {
    pub mod ntpsapi {
        use winapi::shared::ntdef::NTSTATUS;
        use winapi::um::winnt::HANDLE;

        pub const PROCESS_COMMAND_LINE_INFORMATION: i32 = 60;

        #[link(name = "ntdll")]
        unsafe extern "system" {
            pub fn NtQueryInformationProcess(
                process_handle: HANDLE,
                process_information_class: i32,
                process_information: *mut ::std::ffi::c_void,
                process_information_length: u32,
                return_length: *mut u32,
            ) -> NTSTATUS;
        }
    }
}

struct ProcessHandle(HANDLE);

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

fn get_process_pid_by_name(name: &str) -> Result<Vec<DWORD>, String> {
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
/// 用于关闭游戏客户端的兜底路径（LCU 优雅退出不可用时，见
/// `command::launcher::close_league`）。逐个 `OpenProcess(PROCESS_TERMINATE)` +
/// `TerminateProcess`；单个进程失败只记日志、不影响其余进程。
///
/// # 参数
/// - `name`: 进程名（如 `LeagueClientUx.exe`），匹配规则与
///   [`get_process_pid_by_name`] 一致（不区分大小写的包含匹配）
///
/// # 返回值
/// - `Ok(u32)`: 成功结束的进程数（未找到匹配进程时为 0）
/// - `Err(String)`: 创建进程快照失败
pub fn kill_processes_by_name(name: &str) -> Result<u32, String> {
    let pids = get_process_pid_by_name(name)?;
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

fn get_process_command_line(pid: DWORD) -> Result<String, CmdError> {
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
            PROCESS_COMMAND_LINE_INFORMATION,
            buffer.as_mut_ptr() as *mut _,
            initial_size,
            &mut return_size,
        );

        if status != 0 {
            if return_size > initial_size {
                buffer.resize(return_size as usize, 0);
                let status = NtQueryInformationProcess(
                    handle,
                    PROCESS_COMMAND_LINE_INFORMATION,
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

/// 上次成功定位的 LeagueClientUx.exe PID 缓存。
///
/// 多线程读写：HTTP 重试路径、game_state_monitor、WebSocket listener 等
/// 可能从不同线程并发调用 `get_auth()`。使用 `AtomicU32` 避免 `static mut`
/// 的数据竞争（Rust UB）。
static CUR_PID: AtomicU32 = AtomicU32::new(0);

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
    /// 典型成因：游戏（或 WeGame）以管理员身份运行，而本工具是普通权限，
    /// `OpenProcess` 被 `ERROR_ACCESS_DENIED` 拒绝。解法是让本工具也提权运行。
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

/// 通过已打开的进程句柄获取其可执行文件完整路径（用于定位同目录下的 lockfile）。
fn get_process_image_path(handle: HANDLE) -> Result<String, String> {
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
        Ok(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

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
/// 仅当 `OpenProcess` 能成功（即非 [`AuthError::AccessDenied`]）时有意义；
/// 权限不足时连句柄都打不开，自然也拿不到镜像路径。
fn lockfile_auth_for_pid(pid: DWORD) -> Result<(String, String), String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
    if handle.is_null() {
        return Err(format!(
            "为读取 lockfile 打开进程 {} 失败: {}",
            pid,
            std::io::Error::last_os_error()
        ));
    }
    let _guard = ProcessHandle(handle);
    let exe_path = get_process_image_path(handle)?;
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
fn try_auth_from_pid(pid: DWORD) -> Result<(String, String), AuthError> {
    match get_process_command_line(pid) {
        Ok(cmd) if !cmd.is_empty() => auth_resolver(&cmd).or_else(|cmd_err| {
            // 命令行拿到了却没解析出 token，再试一次 lockfile。
            lockfile_auth_for_pid(pid).map_err(|lf| {
                AuthError::Other(format!("命令行解析失败({cmd_err}); lockfile: {lf}"))
            })
        }),
        // 句柄能开但命令行为空/读取失败：lockfile 兜底。
        Ok(_) => lockfile_auth_for_pid(pid).map_err(AuthError::Other),
        Err(CmdError::Failed(e)) => lockfile_auth_for_pid(pid)
            .map_err(|lf| AuthError::Other(format!("命令行读取失败({e}); lockfile: {lf}"))),
        // 权限不足：lockfile 路径同样拿不到，直接归类，交由上层引导提权。
        Err(CmdError::AccessDenied) => Err(AuthError::AccessDenied),
    }
}

/// 获取当前 LCU 认证信息，带失败归类。
///
/// 查找 `LeagueClientUx.exe` 进程，优先从命令行解析 `remoting-auth-token` 与
/// `app-port`，失败时回退读取 lockfile。无法获取时返回 [`AuthError`]，区分
/// "游戏没开 / 权限不足 / 其他失败"。
pub fn get_auth_detailed() -> Result<(String, String), AuthError> {
    log::info!("开始查找英雄联盟客户端进程...");
    let pids = get_process_pid_by_name("LeagueClientUx.exe").map_err(AuthError::Other)?;

    log::info!("找到 {} 个进程", pids.len());
    if pids.is_empty() {
        return Err(AuthError::NotRunning);
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

/// 从正在运行的 `LeagueClientUx.exe` 反推游戏安装根目录。
///
/// 客户端进程位于 `<root>\LeagueClient\LeagueClientUx.exe`，向上两级即安装根目录
/// （其下有 `Launcher\Client.exe` / `TCLS\Client.exe` 腾讯登录客户端，供免 WeGame
/// 一键启动）。仅在客户端运行时可用；游戏未启动时返回 `None`。
///
/// 供 [`crate::command::launcher`] 在"已连接"时记忆路径——之后即便游戏关闭，也能
/// 凭记忆的路径直接拉起登录客户端，无需读注册表。
pub fn get_client_install_root() -> Option<std::path::PathBuf> {
    let pids = get_process_pid_by_name("LeagueClientUx.exe").ok()?;
    for pid in pids {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
        if handle.is_null() {
            continue;
        }
        let _guard = ProcessHandle(handle);
        if let Ok(exe_path) = get_process_image_path(handle) {
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

/// 从运行中的 `LeagueClientUx.exe` 命令行提取 **Riot Client** 本地 API 认证。
///
/// LCU 由 `RiotClientServices` 拉起，其命令行同时带 `--riotclient-auth-token` 与
/// `--riotclient-app-port`，指向 Riot Client 的本地 HTTP 服务（与 LCU 是**两个不同的
/// 本地服务**）。跨区 `name#TAG → puuid` 的 `player-account/aliases` 查询在 RC 端口、
/// 不在 LCU 端口，故全区搜索需要这份认证。返回 `(auth_token, app_port)`。
pub fn get_riot_client_auth() -> Result<(String, String), String> {
    let pids = get_process_pid_by_name("LeagueClientUx.exe")?;
    if pids.is_empty() {
        return Err("未找到英雄联盟客户端进程".to_string());
    }
    for pid in pids {
        let cmd = match get_process_command_line(pid) {
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
}
