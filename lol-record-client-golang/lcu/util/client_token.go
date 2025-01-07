package util

import (
	"fmt"
	"golang.org/x/sys/windows"
	"lol-record-analysis/util/init_log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"unsafe"
)

func getProcessPidByName(name string) ([]int, error) {
	cmd := exec.Command("wmic", "process", "where", fmt.Sprintf("name like '%%%s%%'", name), "get", "processid")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, err
	}

	// 将输出按行分割
	lines := strings.Split(string(output), "\n")
	var pids []int

	// 处理每行输出
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if len(trimmed) > 0 {
			// 转换为数字并添加到结果中
			pid, err := strconv.Atoi(trimmed)
			if err == nil {
				pids = append(pids, pid)
			}
		}
	}

	return pids, nil
}

const (
	ProcessCommandLineInformation     = 60
	PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
)

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
	// Open the process with PROCESS_QUERY_LIMITED_INFORMATION
	handle, err := windows.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", fmt.Errorf("failed to open process: %v", err)
	}
	defer windows.CloseHandle(handle)

	// Query the buffer length for the command line information
	var bufLen uint32
	r1, _, err := procNtQueryInformationProcess.Call(
		uintptr(handle),
		uintptr(ProcessCommandLineInformation),
		0,
		0,
		uintptr(unsafe.Pointer(&bufLen)),
	)

	// Allocate buffer to hold command line information
	buffer := make([]byte, bufLen)
	r1, _, err = procNtQueryInformationProcess.Call(
		uintptr(handle),
		uintptr(ProcessCommandLineInformation),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(bufLen),
		uintptr(unsafe.Pointer(&bufLen)),
	)
	if r1 != 0 {
		return "", fmt.Errorf("NtQueryInformationProcess failed, error code: %v", err)
	}

	// Check if the buffer length is valid and non-zero
	if bufLen == 0 {
		return "", fmt.Errorf("No command line found for process %d", pid)
	}

	// Parse the buffer into a UNICODE_STRING
	ucs := (*UNICODE_STRING)(unsafe.Pointer(&buffer[0]))
	cmdLine := windows.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(ucs.Buffer))[:ucs.Length/2])

	return cmdLine, nil
}

func authResolver(commandLine string) (string, string, error) {

	re := regexp.MustCompile(`--([\w\-]+)(?:=(?:"([^"]+)"|([^\s"]+)))?`)

	// 查找所有匹配项
	matches := re.FindAllStringSubmatch(commandLine, -1)

	// 定义存储结果的map
	params := map[string]string{}

	// 遍历匹配结果并存储到map中
	for _, match := range matches {
		key := "--" + match[1]
		value := match[2]
		if value == "" {
			value = match[3]
		}
		params[key] = value
	}

	// 提取指定的参数值
	remotingAuthToken := params["--remoting-auth-token"]
	appPort := params["--app-port"]

	return remotingAuthToken, appPort, nil

}

var (
	curPid = 0
)

func GetAuth() (string, string, error) {
	pids, _ := getProcessPidByName("LeagueClientUx.exe")
	var err error
	var cmdLine string
	for _, pid := range pids {
		if pid == curPid {
			continue
		}
		cmdLine, err = GetProcessCommandLine(uint32(pid))
	}
	if err != nil || cmdLine == "" {
		init_log.AppLog.Warn("No command line found")
		cmdLine, err = GetProcessCommandLine(uint32(curPid))

	}

	return authResolver(cmdLine)

}
