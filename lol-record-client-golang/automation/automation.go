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

var (
	startMatchCtx, starMatchCancel              = context.WithCancel(context.Background())
	startAcceptMatchCtx, startAcceptCancel      = context.WithCancel(context.Background())
	startChampSelectCtx, startChampSelectCancel = context.WithCancel(context.Background())
	startChampBanCtx, startChampBanCancel       = context.WithCancel(context.Background())
)

func StartAutomation() {

	initRunAutomation()

	config.RegisterOnChangeCallback(func(key string, newValue interface{}) {
		switch key {
		case "settings.auto.startMatchSwitch":
			if newValue.(bool) {
				init_log.AppLog.Info("Starting match automation")
				startChampBanCtx, startChampBanCancel = context.WithCancel(context.Background())
				go startMatchAutomation(startMatchCtx)
			} else {
				init_log.AppLog.Info("Stopping match automation")
				starMatchCancel()
			}

		case "settings.auto.acceptMatchSwitch":
			if newValue.(bool) {
				startAcceptMatchCtx, startAcceptCancel = context.WithCancel(context.Background())
				init_log.AppLog.Info("Starting accept match automation")
				go startAcceptMatchAutomation(startAcceptMatchCtx)
			} else {
				init_log.AppLog.Info("Stopping accept match automation")
				startAcceptCancel()
			}
		case "settings.auto.pickChampionSwitch":
			if newValue.(bool) {
				startChampSelectCtx, startChampSelectCancel = context.WithCancel(context.Background())
				init_log.AppLog.Info("Starting champion select automation")
				go startChampSelectAutomation(startChampSelectCtx)
			} else {
				init_log.AppLog.Info("Stopping champion select automation")
				startChampSelectCancel()
			}
		case "settings.auto.banChampionSwitch":
			if newValue.(bool) {
				startChampBanCtx, startChampBanCancel = context.WithCancel(context.Background())
				init_log.AppLog.Info("Starting champion ban automation")
				go startChampBanAutomation(startChampBanCtx)
			} else {
				init_log.AppLog.Info("Stopping champion ban automation")
				startChampBanCancel()
			}
		}
	})

}
func initRunAutomation() {
	if config.Get[bool]("settings.auto.startMatchSwitch") {
		startMatchCtx, startAcceptCancel = context.WithCancel(context.Background())
		go startMatchAutomation(startMatchCtx)
	}
	if config.Get[bool]("settings.auto.acceptMatchSwitch") {
		startAcceptMatchCtx, startAcceptCancel = context.WithCancel(context.Background())
		go startAcceptMatchAutomation(startAcceptMatchCtx)
	}
	if config.Get[bool]("settings.auto.banChampionSwitch") {
		startChampBanCtx, startChampBanCancel = context.WithCancel(context.Background())
		go startChampBanAutomation(startChampBanCtx)
	}
	if config.Get[bool]("settings.auto.pickChampionSwitch") {
		startChampSelectCtx, startChampSelectCancel = context.WithCancel(context.Background())
		go startChampSelectAutomation(startChampSelectCtx)
	}
}
