package init_log

import (
	"lol-record-analysis/common/logger"
	"sync"
)

var (
	AppLog = GetLogger()
	appLog *logger.Logger
	once   sync.Once
)

// GetLogger 返回全局唯一的日志实例
func GetLogger() *logger.Logger {
	once.Do(func() {
		var err error
		appLog, err = logger.NewLogger(logger.INFO, true, true, "app.log", 1<<25)
		if err != nil {
			panic(err)
		}
	})
	return appLog
}
