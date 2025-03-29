package automation

import (
	"context"
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

func startChampBanAutomation(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
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
			if !config.Viper().GetBool("settings.auto.champBanSwitch") {
				continue
			}
			if curPhase != constants.ChampSelect {
				continue
			}

			// ban逻辑
			err = startBanChampion()
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}

		}
	}
}
func startBanChampion() error {
	selectSession, _ := api.GetChampSelectSession()
	myCellId := selectSession.LocalPlayerCellId
	myBanChampionIntSlice := config.Viper().GetIntSlice("settings.auto.banChampionSlice")
	notBanChampionIdsMap := make(map[int]bool)
	//获取ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId != myCellId && ban.Complete {
					notBanChampionIdsMap[ban.ChampionId] = true
				}
			}

		}
	}
	//队友已经预选的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId != myCellId && pick.Complete {
					notBanChampionIdsMap[pick.ChampionId] = true
				}
			}
		}
	}
	//去除已经ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ChampionId != 0 && ban.Complete {
					notBanChampionIdsMap[ban.ChampionId] = true
				}
			}
		}
	}
	patchJsonMap := make(map[string]interface{})
	patchJsonMap["championId"] = 1
	actionId := 0
	isInProgress := false
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId == myCellId && ban.IsInProgress {
					actionId = ban.Id
					isInProgress = true
					break
				}
			}
		}
	}
	for _, championId := range myBanChampionIntSlice {
		if _, ok := notBanChampionIdsMap[championId]; !ok {
			patchJsonMap["championId"] = championId
			break
		}
	}
	if isInProgress {
		patchJsonMap["completed"] = true
		err := api.PatchSessionAction(actionId, patchJsonMap)
		if err != nil {
			return err
		}
	}
	return nil

}
