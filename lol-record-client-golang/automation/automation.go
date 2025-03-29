package automation

import (
	"context"
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

// 自动接受匹配
func startAcceptMatchAutomation(ctx context.Context) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case <-ctx.Done():
			return
		default:
			if config.Viper().GetBool("settings.auto.acceptMatchSwitch") {
				curPhase, err := api.GetPhase()
				if err != nil {
					init_log.AppLog.Error(err.Error())
					continue
				}
				if curPhase == constants.ReadyCheck {
					api.PostAcceptMatch()
				}
			}
		}
	}
}

func StartAutomation() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // 确保在函数返回时调用 cancel

	// 启动多个定时任务
	go startMatchAutomation(ctx)
	go startAcceptMatchAutomation(ctx)
	go startChampSelectAutomation(ctx)
	go startChampBanAutomation(ctx)
	select {}

}
