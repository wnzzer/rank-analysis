package api

import "lol-record-analysis/lcu/util"

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
	MyTeam []OnePlayer `json:"myTeam"`
	//Actions []Action    `json:"actions"`
}

//type Action struct {
//	ActorCellId int    `json:"actorCellId"`
//	Id          int    `json:"id"`
//	Type        string `json:"type"`
//	Complete    bool   `json:"complete"`
//}

func GetChampSelectSession() (SelectSession, error) {
	var selectSession SelectSession
	uri := "lol-champ-select/v1/session"
	err := util.Get(uri, &selectSession)
	if err != nil {
		return SelectSession{}, err
	}
	return selectSession, err
}

//func PatchPickChampion(championId int) error {
//	uri := ""
//}
