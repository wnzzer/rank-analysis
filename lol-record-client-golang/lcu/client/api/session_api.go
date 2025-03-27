package api

import (
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
)

func GetPhase() (string, error) {
	uri := "lol-gameflow/v1/gameflow-phase"
	var phase string
	err := util.Get(uri, &phase)
	if err != nil {
		return "", err
	}
	return phase, nil
}

type Session struct {
	GameData struct {
		GameId int `json:"gameId"`
		Queue  struct {
			Type string `json:"type"`
		} `json:"queue"`
		TeamOne []OnePlayer `json:"teamOne"`
		TeamTwo []OnePlayer `json:"teamTwo"`
	} `json:"gameData"`
	Phase string `json:"phase"`
}
type OnePlayer struct {
	ChampionId int    `json:"championId"`
	Puuid      string `json:"puuid"`
}

func GetSession() (Session, error) {
	var session Session
	uri := "lol-gameflow/v1/session"
	err := util.Get(uri, &session)
	if err != nil {
		return Session{}, err
	}
	return session, err
}

type SelectSession struct {
	MyTeam  []OnePlayer `json:"myTeam"`
	Actions [][]Action  `json:"actions"`
	Timer   Timer       `json:"timer"`
}

type Action struct {
	ActorCellId int    `json:"actorCellId"`
	Id          int    `json:"id"`
	Type        string `json:"type"`
	Complete    bool   `json:"complete"`
}
type Timer struct {
	AdjustedTimeLeftInPhase float64 `json:"adjustedTimeLeftInPhase"`
	InternalNowInPhase      float64 `json:"internalNowInPhase"`
	IsInfinite              bool    `json:"isInfinite"`
	Phase                   string  `json:"phase"`
	TotalTimeInPhase        float64 `json:"totalTimeInPhase"`
}

func GetChampSelectSession() (SelectSession, error) {
	var selectSession SelectSession
	uri := "lol-champ-select/v1/session"
	err := util.Get(uri, &selectSession)
	if err != nil {
		return SelectSession{}, err
	}
	return selectSession, err
}

func PostMatchSearch() {
	uri := "lol-lobby/v2/lobby/matchmaking/search"
	err := util.Post(uri, nil, nil)
	if err != nil {
		init_log.AppLog.Error(err.Error())
	}
}
func PostAcceptMatch() {
	uri := "lol-matchmaking/v1/ready-check/accept"
	err := util.Post(uri, nil, nil)
	if err != nil {
		init_log.AppLog.Error(err.Error())
	}
}
func PatchPickChampion(championId int) {
	//uri := ""
}
