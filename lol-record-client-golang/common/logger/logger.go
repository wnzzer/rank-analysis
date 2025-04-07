package logger

import (
	"fmt"
	"os"
	"runtime"
	"time"
)

type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
	FATAL
)

var logLevelStrings = []string{
	"DEBUG",
	"INFO",
	"WARN",
	"ERROR",
	"FATAL",
}

// ANSI 颜色代码
const (
	Reset   = "\033[0m"
	Red     = "\033[31m"
	Yellow  = "\033[33m"
	Blue    = "\033[34m"
	Green   = "\033[32m"
	Magenta = "\033[35m"
	Cyan    = "\033[36m"
	White   = "\033[37m"
)

// 获取日志级别对应的颜色
func (l LogLevel) Color() string {
	switch l {
	case DEBUG:
		return Cyan
	case INFO:
		return Green
	case WARN:
		return Yellow
	case ERROR:
		return Red
	case FATAL:
		return Magenta
	default:
		return White
	}
}

func (l LogLevel) String() string {
	if l < DEBUG || l > FATAL {
		return "UNKNOWN"
	}
	return logLevelStrings[l]
}

type Logger struct {
	level       LogLevel
	file        *os.File
	logToFile   bool
	logToStdout bool
	logFilePath string
	maxFileSize int64 // 日志文件最大大小（字节）
	currentSize int64 // 当前日志文件大小
}

// NewLogger 创建一个新的日志记录器
func NewLogger(level LogLevel, logToFile bool, logToStdout bool, logFilePath string, maxFileSize int64) (*Logger, error) {
	logger := &Logger{
		level:       level,
		logToFile:   logToFile,
		logToStdout: logToStdout,
		logFilePath: logFilePath,
		maxFileSize: maxFileSize,
	}

	if logToFile {
		file, err := os.OpenFile(logFilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return nil, err
		}
		logger.file = file

		// 获取当前文件大小
		fileInfo, err := file.Stat()
		if err != nil {
			return nil, err
		}
		logger.currentSize = fileInfo.Size()
	}

	return logger, nil
}

// getCallerInfo 获取调用者的文件名和行号
func getCallerInfo() string {
	_, file, line, ok := runtime.Caller(3) // 调整堆栈深度获取日志调用位置
	if !ok {
		return "unknown:0"
	}
	return fmt.Sprintf("%s:%d", file, line)
}

// rotateLog 轮转日志文件
func (l *Logger) rotateLog() error {
	if l.currentSize < l.maxFileSize {
		return nil
	}

	// 关闭当前日志文件
	if l.file != nil {
		l.file.Close()
	}

	// 重命名当前日志文件（例如，添加时间戳）
	backupFilePath := fmt.Sprintf("%s.%s", l.logFilePath, time.Now().Format("20060102-150405"))
	err := os.Rename(l.logFilePath, backupFilePath)
	if err != nil {
		return err
	}

	// 创建新的日志文件
	file, err := os.OpenFile(l.logFilePath, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	l.file = file
	l.currentSize = 0

	return nil
}

// log 输出日志
func (l *Logger) log(level LogLevel, format string, args ...interface{}) {
	if level < l.level {
		return
	}

	// 获取调用者信息
	callerInfo := getCallerInfo()

	// 格式化日志消息
	logMessage := fmt.Sprintf("[%s] %s [%s]: %s", time.Now().Format(time.RFC3339), level, callerInfo, fmt.Sprintf(format, args...))

	// 输出到控制台（带颜色）
	if l.logToStdout {
		coloredMessage := fmt.Sprintf("%s%s%s", level.Color(), logMessage, Reset)
		fmt.Println(coloredMessage)
	}

	// 输出到文件（无颜色）
	if l.logToFile && l.file != nil {
		// 检查文件大小并轮转日志
		if err := l.rotateLog(); err != nil {
			fmt.Println("Failed to rotate log file:", err)
		}

		// 写入日志
		_, err := l.file.WriteString(logMessage + "\n")
		if err != nil {
			fmt.Println("Failed to write to logger file:", err)
		} else {
			// 更新当前文件大小
			l.currentSize += int64(len(logMessage) + 1) // +1 是换行符
		}
	}
}

// Debug 打印 DEBUG 级别的日志
func (l *Logger) Debug(format string, args ...interface{}) {
	l.log(DEBUG, format, args...)
}

// Info 打印 INFO 级别的日志
func (l *Logger) Info(format string, args ...interface{}) {
	l.log(INFO, format, args...)
}

// Warn 打印 WARN 级别的日志
func (l *Logger) Warn(format string, args ...interface{}) {
	l.log(WARN, format, args...)
}

// Error 打印 ERROR 级别的日志
func (l *Logger) Error(format string, args ...interface{}) {
	l.log(ERROR, format, args...)
}

// Fatal 打印 FATAL 级别的日志并终止程序
func (l *Logger) Fatal(format string, args ...interface{}) {
	l.log(FATAL, format, args...)
	os.Exit(1)
}

// Close 关闭日志文件
func (l *Logger) Close() {
	if l.file != nil {
		l.file.Close()
	}
}
