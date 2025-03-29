package automation

import (
	"context"
	"fmt"
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

// 英雄选择自动化（如果有逻辑的话）

func startChampSelectAutomation(ctx context.Context) {
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
			if !config.Viper().GetBool("settings.auto.champSelectSwitch") {
				continue
			}
			if curPhase != constants.ChampSelect {
				continue
			}

			// 选择逻辑
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}

		}
	}
}
func startSelectChampion() []constants.ChampionOption {
	selectSession, _ := api.GetChampSelectSession()
	myCellId := selectSession.LocalPlayerCellId
	myPickChampionSliceInterface := config.Viper().Get("settings.auto.pickChampionSlice")
	myPickChampionSlice := myPickChampionSliceInterface.([]interface{})
	fmt.Println(myPickChampionSlice)
	notSelectChampionIdsMap := make(map[int]bool)
	//获取ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId != myCellId && ban.Complete {
					notSelectChampionIdsMap[ban.ChampionId] = true
				}
			}

		}
	}
	//获取选中的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId != myCellId && pick.ChampionId != 0 {
					notSelectChampionIdsMap[pick.ChampionId] = true
				}
			}
		}
	}
	//willSelectChampionId := 1
	//for _, championId := range myPickChampionSlice {
	//
	//}
	return nil

}
