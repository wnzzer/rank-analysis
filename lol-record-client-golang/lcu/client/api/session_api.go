package api

import (
	"lol-record-analysis/lcu/util"
)

type Session struct {
	GameData struct {
		GameId       int  `json:"gameId"`
		IsCustomGame bool `json:"isCustomGame"`
		Queue        struct {
			Type string `json:"type"`
			Id   int    `json:"id"`
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
