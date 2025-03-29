package automation

import (
	"context"
	"lol-record-analysis/common/config"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

// 英雄选择自动化（如果有逻辑的话）

func startChampSelectAutomation(ctx context.Context) {
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
			if !config.Viper().GetBool("settings.auto.champSelectSwitch") {
				continue
			}
			if curPhase != constants.ChampSelect {
				continue
			}

			// 选择逻辑
			err = startSelectChampion()
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}

		}
	}
}
func startSelectChampion() error {
	selectSession, _ := api.GetChampSelectSession()
	myCellId := selectSession.LocalPlayerCellId
	myPickChampionIntSlice := config.Viper().GetIntSlice("settings.auto.pickChampionSlice")
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
	willSelectChampionId := 1
	if len(myPickChampionIntSlice) > 0 && myPickChampionIntSlice[0] == 0 {
		myPickChampionIntSlice = nil
		for _, champion := range constants.ChampionOptions {
			myPickChampionIntSlice = append(myPickChampionIntSlice, champion.Value)
		}
	}
	for _, championId := range myPickChampionIntSlice {
		if _, ok := notSelectChampionIdsMap[championId]; !ok {
			willSelectChampionId = championId
			break
		}
	}
	patchJsonMap := map[string]interface{}{}
	patchJsonMap["championId"] = willSelectChampionId
	patchJsonMap["type"] = "pick"
	actionId := 0
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId == myCellId && pick.ChampionId == 0 {
					actionId = pick.Id
					if pick.IsInProgress {
						patchJsonMap["completed"] = false
					}
					break
				}
			}
		}
	}
	err := api.PatchSessionAction(actionId, patchJsonMap)
	if err != nil {
		return err
	}
	return nil

}
