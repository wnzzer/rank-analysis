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
	init_log.AppLog.Info("Starting champion select automation")
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case <-ctx.Done():
			init_log.AppLog.Info("Champion select automation stopped")
			return
		default:
			init_log.AppLog.Info("Starting  champion select automation tick")

			curPhase, err := api.GetPhase()
			if err != nil {
				init_log.AppLog.Error("Failed to get current phase: " + err.Error())
				continue
			}

			if curPhase != constants.ChampSelect {
				init_log.AppLog.Info("Not in champion select phase")
				continue
			}

			init_log.AppLog.Info("In champion select phase, starting champion selection")
			err = startSelectChampion()
			if err != nil {
				init_log.AppLog.Error("Failed to select champion: " + err.Error())
				continue
			}

		}
	}
}

func startSelectChampion() error {
	selectSession, err := api.GetChampSelectSession()
	if err != nil {
		init_log.AppLog.Error("Failed to get champion select session: " + err.Error())
		return err
	}

	myCellId := selectSession.LocalPlayerCellId
	init_log.AppLog.Info("Current player cell ID: ", myCellId)

	myPickChampionIntSlice := config.Get[[]int]("settings.auto.pickChampionSlice")
	init_log.AppLog.Info("Configured champion selection list: ", myPickChampionIntSlice)

	notSelectChampionIdsMap := make(map[int]bool)

	// 获取ban的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "ban" {
			for _, ban := range action {
				if ban.ActorCellId != myCellId && ban.Completed {
					notSelectChampionIdsMap[ban.ChampionId] = true
					init_log.AppLog.Debug("Champion banned by others: ", ban.ChampionId)
				}
			}

		}
	}
	// 获取队友选择的英雄
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId != myCellId && pick.ChampionId != 0 {
					notSelectChampionIdsMap[pick.ChampionId] = true
					init_log.AppLog.Debug("Champion picked by teammates: ", pick.ChampionId)
				}
			}
		}
	}
	willSelectChampionId := 1

	// 如果是全部选择的选项,即又一项为 0,默认选择所有英雄
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

	if willSelectChampionId != 1 {
		init_log.AppLog.Info("Will select champion ID: ", willSelectChampionId)
	} else {
		init_log.AppLog.Warn("No available champion to select, using default ID: 1")
	}

	patchJsonMap := map[string]interface{}{}
	patchJsonMap["championId"] = willSelectChampionId
	patchJsonMap["type"] = "pick"
	actionId := -1
	isInProgress := false
	myPickedChampionId := -1
	completed := false
	for _, action := range selectSession.Actions {
		if len(action) >= 1 && action[0].Type == "pick" {
			for _, pick := range action {
				if pick.ActorCellId == myCellId {
					completed = pick.Completed
					myPickedChampionId = pick.ChampionId
					actionId = pick.Id
					if pick.IsInProgress {
						isInProgress = true
					}
					break
				}
			}
		}
	}
	if actionId != -1 {
		if isInProgress && !completed {
			patchJsonMap["completed"] = true
			err = api.PatchSessionAction(actionId, patchJsonMap)
		} else if myPickedChampionId == 0 && !completed && !isInProgress {
			err = api.PatchSessionAction(actionId, patchJsonMap)
		}
	}
	if err != nil {
		init_log.AppLog.Error("Failed to patch session action: " + err.Error())
		return err
	}
	return nil
}
