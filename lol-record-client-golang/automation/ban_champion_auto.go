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
		init_log.AppLog.Info("ChampBanAutomation ticker ticked")
		select {
		case <-ctx.Done():
			init_log.AppLog.Info("ChampBanAutomation context done")
			return
		default:
			curPhase, err := api.GetPhase()
			if err != nil {
				init_log.AppLog.Error("Error getting phase: ", err)
				continue
			}
			init_log.AppLog.Info("Current phase: %s", curPhase)

			if curPhase != constants.ChampSelect {
				init_log.AppLog.Info("Current phase is not ChampSelect: %s", curPhase)
				continue
			}

			// ban逻辑
			err = startBanChampion()
			if err != nil {
				init_log.AppLog.Error("Error in startBanChampion: ", err)
				continue
			}
		}
	}
}

func startBanChampion() error {
	selectSession, err := api.GetChampSelectSession()
	if err != nil {
		init_log.AppLog.Error("Error getting ChampSelectSession: ", err)
		return err
	}

	init_log.AppLog.Info("ChampSelectSession: %+v", selectSession)

	myCellId := selectSession.LocalPlayerCellId
	init_log.AppLog.Info("My Cell ID: %d", myCellId)

	myBanChampionIntSlice := config.Get[[]int]("settings.auto.banChampionSlice")
	init_log.AppLog.Info("Ban Champion Slice: %+v", myBanChampionIntSlice)

	notBanChampionIdsMap := make(map[int]bool)

	haveBanId := false

	// 检查是否已经ban了,ban 了则不需要再ban
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId == myCellId {
					if ban.Completed {
						return nil
					}
					haveBanId = true
				}
			}
		}
	}
	if !haveBanId {
		init_log.AppLog.Info("Ban action Not Found")
		return nil
	}

	//获取ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId != myCellId && ban.Completed {
					notBanChampionIdsMap[ban.ChampionId] = true
				}
			}
		}
	}
	init_log.AppLog.Info("Not Ban Champion IDs Map: %+v", notBanChampionIdsMap)

	//队友已经预选的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId != myCellId && pick.Completed {
					notBanChampionIdsMap[pick.ChampionId] = true
				}
			}
		}
	}
	init_log.AppLog.Info("Updated Not Ban Champion IDs Map: %+v", notBanChampionIdsMap)

	//去除已经ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ChampionId != 0 && ban.Completed {
					notBanChampionIdsMap[ban.ChampionId] = true
				}
			}
		}
	}
	init_log.AppLog.Info("Final Not Ban Champion IDs Map: %+v", notBanChampionIdsMap)

	patchJsonMap := make(map[string]interface{})
	patchJsonMap["championId"] = 1
	actionId := -1
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
	init_log.AppLog.Info("Action ID: %d, Is In Progress: %t", actionId, isInProgress)

	for _, championId := range myBanChampionIntSlice {
		if _, ok := notBanChampionIdsMap[championId]; !ok {
			patchJsonMap["championId"] = championId
			break
		}
	}
	init_log.AppLog.Info("Patch JSON Map: %+v", patchJsonMap)

	if actionId != -1 && isInProgress {
		patchJsonMap["completed"] = true
		err := api.PatchSessionAction(actionId, patchJsonMap)
		if err != nil {
			init_log.AppLog.Error("Error patching session action: ", err)
			return err
		}
	}
	return nil
}
