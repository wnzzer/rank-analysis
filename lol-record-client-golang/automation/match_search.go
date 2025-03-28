package automation

import (
	"context"
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

// 自动搜索匹配
func startMatchAutomation(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case <-ctx.Done():
			return
		default:
			if config.Viper().GetBool("settings.auto.startMatchSwitch") {
				curPhase, err := api.GetPhase()
				if err != nil {
					init_log.AppLog.Error(err.Error())
					continue
				}
				if curPhase == constants.Lobby {
					api.PostMatchSearch()
				}
			}
		}
	}
}
