package api

import (
	"fmt"
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
	"sync"
	"time"
)

type SelectSession struct {
	MyTeam            []OnePlayer `json:"myTeam"`
	Actions           [][]Action  `json:"actions"`
	Timer             Timer       `json:"timer"`
	LocalPlayerCellId int         `json:"localPlayerCellId"`
}

type Action struct {
	ActorCellId  int    `json:"actorCellId"`
	Id           int    `json:"id"`
	ChampionId   int    `json:"championId"`
	Completed    bool   `json:"completed"`
	IsAllyAction bool   `json:"isAllyAction"`
	IsInProgress bool   `json:"isInProgress"`
	Type         string `json:"type"`
}
type Timer struct {
	AdjustedTimeLeftInPhase float64 `json:"adjustedTimeLeftInPhase"`
	InternalNowInPhase      float64 `json:"internalNowInPhase"`
	IsInfinite              bool    `json:"isInfinite"`
	Phase                   string  `json:"phase"`
	TotalTimeInPhase        float64 `json:"totalTimeInPhase"`
}
type SelectSessionCache struct {
	mu            sync.Mutex
	lastSession   SelectSession
	lastFetchTime time.Time
}

var selectCache = &SelectSessionCache{}

func GetChampSelectSession() (SelectSession, error) {
	selectCache.mu.Lock()
	defer selectCache.mu.Unlock()
	// 检查缓存是否在1秒内
	currentTime := time.Now()
	if !selectCache.lastFetchTime.IsZero() &&
		currentTime.Sub(selectCache.lastFetchTime) <= 1*time.Second {
		return selectCache.lastSession, nil
	}

	var selectSession SelectSession
	uri := "lol-champ-select/v1/session"
	err := util.Get(uri, &selectSession)
	if err != nil {
		return SelectSession{}, err
	}
	// 更新缓存
	selectCache.lastSession = selectSession
	return selectSession, err
}

func PostAcceptMatch() {
	uri := "lol-matchmaking/v1/ready-check/accept"
	err := util.Post(uri, nil, nil)
	if err != nil {
		init_log.AppLog.Error(err.Error())
	}
}
func PatchSessionAction(actionId, patchData interface{}) error {
	uri := "lol-champ-select/v1/session/actions/%d"

	err := util.Patch(fmt.Sprintf(uri, actionId), patchData, nil)
	if err != nil {
		return err
	}
	return nil
}
