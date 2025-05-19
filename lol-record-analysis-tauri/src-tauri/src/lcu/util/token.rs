// Cargo.toml dependencies
use ntapi::ntpsapi::{NtQueryInformationProcess, PROCESS_COMMAND_LINE_INFORMATION};
use regex::Regex;
use std::collections::HashMap;
use std::mem;
use winapi::shared::minwindef::{DWORD, FALSE};
use winapi::shared::ntdef::UNICODE_STRING;
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::OpenProcess;
use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use winapi::um::winnt::{HANDLE, PROCESS_QUERY_LIMITED_INFORMATION};

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
            return Err(format!("无法创建进程快照: {}", std::io::Error::last_os_error()));
        }
        let _snapshot_handle = ProcessHandle(snapshot);

        let mut entry: PROCESSENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) == FALSE {
            return Err(format!("无法获取第一个进程: {}", std::io::Error::last_os_error()));
        }

        loop {
            let exe_file = &entry.szExeFile;
            let exe_name = String::from_utf16_lossy(
                &exe_file[..exe_file.iter().position(|&x| x == 0).unwrap_or(exe_file.len())]
            ).to_lowercase();

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

fn get_process_command_line(pid: DWORD) -> Result<String, String> {
    println!("尝试获取进程 {} 的命令行", pid);
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if handle.is_null() {
            return Err(format!("无法打开进程 {}: {}", pid, std::io::Error::last_os_error()));
        }
        println!("成功打开进程句柄");
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
                    return Err(format!("NtQueryInformationProcess 失败，状态码: {:#x}", status));
                }
            } else {
                return Err(format!("NtQueryInformationProcess 失败，状态码: {:#x}", status));
            }
        }

        if return_size == 0 {
            return Err("返回的缓冲区大小为0".to_string());
        }

        buffer.truncate(return_size as usize);

        let ucs = &*(buffer.as_ptr() as *const UNICODE_STRING);
        if ucs.Buffer.is_null() || ucs.Length == 0 {
            return Err(format!("无效的命令行数据，Buffer: {:?}, Length: {}", ucs.Buffer, ucs.Length));
        }

        let slice = std::slice::from_raw_parts(ucs.Buffer, (ucs.Length / 2) as usize);
        let cmd_line = String::from_utf16_lossy(slice);

        println!("成功获取命令行: {}", cmd_line);
        Ok(cmd_line)
    }
}

fn auth_resolver(command_line: &str) -> Result<(String, String), String> {
    let re = Regex::new(r#"--([^\s=]+)(?:=(?:"([^"]+)"|([^\s"]+)))?"#).unwrap();
    let mut params = HashMap::new();

    for cap in re.captures_iter(command_line) {
        let key = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let value = cap.get(2).map(|m| m.as_str())
            .or_else(|| cap.get(3).map(|m| m.as_str()))
            .unwrap_or("");

        params.insert(key.to_string(), value.to_string());
    }

    let remoting_auth_token = params.get("remoting-auth-token")
        .ok_or("命令行中未找到remoting-auth-token参数")?;
    let app_port = params.get("app-port")
        .ok_or("命令行中未找到app-port参数")?;

    if remoting_auth_token.is_empty() || app_port.is_empty() {
        return Err("命令行中未找到必要的认证参数".to_string());
    }

    Ok((remoting_auth_token.clone(), app_port.clone()))
}

static mut CUR_PID: DWORD = 0;

pub fn get_auth() -> Result<(String, String), String> {
    println!("开始查找英雄联盟客户端进程...");
    let pids = get_process_pid_by_name("LeagueClientUx.exe")?;

    println!("找到 {} 个进程", pids.len());
    if pids.is_empty() {
        return Err("未找到英雄联盟客户端进程".to_string());
    }

    let mut cmd_line = String::new();
    let mut found_valid_process = false;

    for &pid in &pids {
        unsafe {
            if pid == CUR_PID {
                println!("跳过当前PID: {}", pid);
                continue;
            }

            println!("正在检查PID: {}", pid);
            match get_process_command_line(pid) {
                Ok(temp_cmd_line) if !temp_cmd_line.is_empty() => {
                    cmd_line = temp_cmd_line;
                    CUR_PID = pid;
                    found_valid_process = true;
                    println!("找到有效进程，PID: {}", pid);
                    break;
                }
                Err(e) => println!("获取进程 {} 的命令行失败: {}", pid, e),
                _ => println!("进程 {} 的命令行为空", pid),
            }
        }
    }

    if !found_valid_process {
        println!("未找到有效的命令行，尝试使用当前PID: {}", unsafe { CUR_PID });
        unsafe {
            if CUR_PID > 0 {
                cmd_line = get_process_command_line(CUR_PID)?;
            } else {
                return Err("未找到有效的英雄联盟客户端进程".to_string());
            }
        }
    }

    auth_resolver(&cmd_line)
}
