package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client"
	"lol-record-analysis/util/init_log"
)

func GetSessionData(c *gin.Context) {
	getSessionData, err := curSessionChampion()
	if err != nil {
		init_log.AppLog.Error("GetSessionData() failed", err)
		c.JSON(500, gin.H{})
	}
	c.JSON(200, getSessionData)
}

type SessionData struct {
	Phase   string            `json:"phase"`
	Type    string            `json:"type"`
	TypeCn  string            `json:"typeCn"`
	TeamOne []SessionSummoner `json:"teamOne"`
	TeamTwo []SessionSummoner `json:"teamTwo"`
}

type SessionSummoner struct {
	ChampionId     int                 `json:"championId"`
	ChampionBase64 string              `json:"championBase64"`
	Summoner       client.Summoner     `json:"summoner"`
	MatchHistory   client.MatchHistory `json:"matchHistory"`
	UserTag        UserTag             `json:"userTag"`
}

func curSessionChampion() (SessionData, error) {
	phase, _ := client.GetPhase()
	if phase != client.ChampSelect && phase != client.InProgress && phase != client.PreEndOfGame {
		return SessionData{}, nil
	}
	session, err := client.GetSession()

	var sessionData = SessionData{}
	if err != nil {
		return SessionData{}, nil
	}
	sessionData.Phase = session.Phase
	sessionData.Type = session.GameData.Queue.Type
	sessionData.TypeCn = client.QueueTypeToCn[session.GameData.Queue.Type]
	for _, summonerPlayer := range session.GameData.TeamOne {
		if summonerPlayer.Puuid == "" {
			continue
		}
		summoner, _ := getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ := GetMatchHistoryCore(MatchHistoryParams{
			Puuid:    summoner.Puuid,
			BegIndex: 0,
			EndIndex: 2,
		}, false)
		userTag, _ := GetTagCore(summoner.Puuid, "")
		sessionData.TeamOne = append(sessionData.TeamOne,
			SessionSummoner{
				ChampionId:     summonerPlayer.ChampionId,
				ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
				Summoner:       summoner,
				MatchHistory:   *matchHistory,
				UserTag:        *userTag,
			},
		)
	}
	for _, summonerPlayer := range session.GameData.TeamTwo {
		if summonerPlayer.Puuid == "" {
			continue
		}
		summoner, _ := getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ := GetMatchHistoryCore(MatchHistoryParams{
			Puuid:    summoner.Puuid,
			BegIndex: 0,
			EndIndex: 2,
		}, false)
		userTag, _ := GetTagCore(summoner.Puuid, "")
		sessionData.TeamTwo = append(sessionData.TeamTwo,
			SessionSummoner{
				ChampionId:     summonerPlayer.ChampionId,
				ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
				Summoner:       summoner,
				MatchHistory:   *matchHistory,
				UserTag:        *userTag,
			},
		)
	}
	return sessionData, nil

}
