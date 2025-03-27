package automation

import (
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

func Automation() {
	for {
		curPhase, err := api.GetPhase()
		if err != nil {
			init_log.AppLog.Error(err.Error())
		}
		switch curPhase {
		case constants.Lobby:
			if config.Viper().GetBool("settings.auto.startMatchSwitch") {
				api.PostMatchSearch()
				time.Sleep(10 * time.Second)
			}
		case constants.ReadyCheck:
			if config.Viper().GetBool("settings.auto.acceptMatchSwitch") {
				api.PostAcceptMatch()
				time.Sleep(10 * time.Second)
			}
		}
		time.Sleep(1 * time.Second)

	}

}
