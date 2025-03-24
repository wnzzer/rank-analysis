package util

import (
	"fmt"
	"golang.org/x/sys/windows"
	"lol-record-analysis/util/init_log"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

var (
	modkernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	modpsapi                     = windows.NewLazySystemDLL("psapi.dll")
	procCreateToolhelp32Snapshot = modkernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32First           = modkernel32.NewProc("Process32FirstW")
	procProcess32Next            = modkernel32.NewProc("Process32NextW")
	procCloseHandle              = modkernel32.NewProc("CloseHandle")
)

const (
	ProcessCommandLineInformation     = 60
	PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	TH32CS_SNAPPROCESS                = 0x00000002
	MAX_PATH                          = 260
)

// PROCESSENTRY32 结构体用于存储进程信息
type PROCESSENTRY32 struct {
	Size              uint32
	Usage             uint32
	ProcessID         uint32
	DefaultHeapID     uintptr
	ModuleID          uint32
	Threads           uint32
	ParentProcessID   uint32
	PriorityClassBase int32
	Flags             uint32
	ExeFile           [MAX_PATH]uint16
}

// getProcessPidByName 使用Windows API获取指定名称的进程ID
func getProcessPidByName(name string) ([]int, error) {
	// 创建系统进程快照
	handle, _, err := procCreateToolhelp32Snapshot.Call(
		TH32CS_SNAPPROCESS,
		0,
	)
	if handle == uintptr(windows.InvalidHandle) {
		return nil, fmt.Errorf("无法创建进程快照: %v", err)
	}
	defer procCloseHandle.Call(handle)

	// 准备接收第一个进程的信息
	var entry PROCESSENTRY32
	entry.Size = uint32(unsafe.Sizeof(entry))

	// 获取第一个进程
	ret, _, err := procProcess32First.Call(
		handle,
		uintptr(unsafe.Pointer(&entry)),
	)
	if ret == 0 {
		return nil, fmt.Errorf("无法获取第一个进程: %v", err)
	}

	var pids []int
	nameLower := strings.ToLower(name)

	// 遍历所有进程
	for {
		exeName := syscall.UTF16ToString(entry.ExeFile[:])
		if strings.Contains(strings.ToLower(exeName), nameLower) {
			pids = append(pids, int(entry.ProcessID))
		}

		// 获取下一个进程
		ret, _, err = procProcess32Next.Call(
			handle,
			uintptr(unsafe.Pointer(&entry)),
		)

		// 如果没有更多进程，退出循环
		if ret == 0 {
			break
		}
	}

	return pids, nil
}

// 声明NtQueryInformationProcess
var (
	modntdll                      = windows.NewLazySystemDLL("ntdll.dll")
	procNtQueryInformationProcess = modntdll.NewProc("NtQueryInformationProcess")
)

type UNICODE_STRING struct {
	Length        uint16
	MaximumLength uint16
	Buffer        *uint16
}

func GetProcessCommandLine(pid uint32) (string, error) {
	// 打开进程以获取PROCESS_QUERY_LIMITED_INFORMATION权限
	handle, err := windows.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", fmt.Errorf("无法打开进程: %v", err)
	}
	defer windows.CloseHandle(handle)

	// 查询命令行信息所需的缓冲区长度
	var bufLen uint32
	r1, _, err := procNtQueryInformationProcess.Call(
		uintptr(handle),
		uintptr(ProcessCommandLineInformation),
		0,
		0,
		uintptr(unsafe.Pointer(&bufLen)),
	)

	// 分配缓冲区来存放命令行信息
	buffer := make([]byte, bufLen)
	r1, _, err = procNtQueryInformationProcess.Call(
		uintptr(handle),
		uintptr(ProcessCommandLineInformation),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(bufLen),
		uintptr(unsafe.Pointer(&bufLen)),
	)
	if r1 != 0 {
		return "", fmt.Errorf("NtQueryInformationProcess失败，错误代码: %v", err)
	}

	// 检查缓冲区长度是否有效且非零
	if bufLen == 0 {
		return "", fmt.Errorf("找不到进程 %d 的命令行", pid)
	}

	// 将缓冲区解析为UNICODE_STRING
	ucs := (*UNICODE_STRING)(unsafe.Pointer(&buffer[0]))
	cmdLine := windows.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(ucs.Buffer))[:ucs.Length/2])

	return cmdLine, nil
}

func authResolver(commandLine string) (string, string, error) {
	re := regexp.MustCompile(`--([^\s=]+)(?:=(?:"([^"]+)"|([^\s"]+)))?`)

	// 查找所有匹配项
	matches := re.FindAllStringSubmatch(commandLine, -1)

	// 定义存储结果的map
	params := map[string]string{}

	// 遍历匹配结果并存储到map中
	for _, match := range matches {
		key := match[1]
		value := ""

		if len(match) > 2 {
			if match[2] != "" {
				value = match[2] // 带引号的值
			} else if len(match) > 3 {
				value = match[3] // 不带引号的值
			}
		}

		params[key] = value
	}

	// 提取指定的参数值
	remotingAuthToken := params["remoting-auth-token"]
	appPort := params["app-port"]

	if remotingAuthToken == "" || appPort == "" {
		return "", "", fmt.Errorf("命令行中未找到必要的认证参数")
	}

	return remotingAuthToken, appPort, nil
}

var (
	curPid = 0
)

func GetAuth() (string, string, error) {
	pids, err := getProcessPidByName("LeagueClientUx.exe")
	if err != nil {
		return "", "", fmt.Errorf("无法获取进程ID: %v", err)
	}

	if len(pids) == 0 {
		return "", "", fmt.Errorf("未找到英雄联盟客户端进程")
	}

	var cmdLine string
	foundValidProcess := false

	for _, pid := range pids {
		if pid == curPid {
			continue
		}

		tempCmdLine, err := GetProcessCommandLine(uint32(pid))
		if err == nil && tempCmdLine != "" {
			cmdLine = tempCmdLine
			curPid = pid // 更新当前处理的PID
			foundValidProcess = true
			break // 找到一个有效的进程后立即退出循环
		}
	}

	if !foundValidProcess {
		init_log.AppLog.Warn("未找到有效的命令行，尝试使用当前PID")
		if curPid > 0 {
			cmdLine, err = GetProcessCommandLine(uint32(curPid))
			if err != nil || cmdLine == "" {
				return "", "", fmt.Errorf("无法获取命令行: %v", err)
			}
		} else {
			return "", "", fmt.Errorf("未找到有效的英雄联盟客户端进程")
		}
	}

	return authResolver(cmdLine)
}
