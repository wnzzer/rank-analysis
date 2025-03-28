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
func acceptMatchAutomation(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
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

// 英雄选择自动化（如果有逻辑的话）
func champSelectAutomation(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case <-ctx.Done():
			return
		default:
			curPhase, err := api.GetPhase()
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}
			if curPhase == constants.ChampSelect {
				// 选英雄逻辑
			}
		}
	}
}

// 启动所有定时任务
func StartAutomation() {
	ctx, cancel := context.WithCancel(context.Background())

	// 启动多个定时任务
	go startMatchAutomation(ctx)
	go acceptMatchAutomation(ctx)
	go champSelectAutomation(ctx)

	// 运行 60 秒后停止所有任务
	time.Sleep(60 * time.Second)
	cancel()
}
