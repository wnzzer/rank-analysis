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
	Rank           client.Rank         `json:"rank"`
}

var lastSessionChampionData SessionData
var lastSession client.Session = client.Session{}

func curSessionChampion() (SessionData, error) {
	phase, _ := client.GetPhase()
	if phase != client.ChampSelect && phase != client.InProgress && phase != client.PreEndOfGame && phase != client.EndOfGame {
		return SessionData{}, nil
	}
	session := client.Session{}
	var err error
	if phase == client.ChampSelect {
		selectSession, err := client.GetChampSelectSession()
		if err != nil {
			return SessionData{}, err
		}
		session.Phase = client.ChampSelect
		session.GameData.TeamOne = selectSession.MyTeam
	} else {
		session, err = client.GetSession()
	}

	var sessionData = SessionData{}
	if err != nil {
		return SessionData{}, nil
	}
	//一致则返回缓存
	if isOneGame(session, lastSession) {
		return lastSessionChampionData, nil
	}
	if lastSessionChampionData.Phase == session.Phase && lastSessionChampionData.Type == session.GameData.Queue.Type {
		return lastSessionChampionData, nil
	}
	lastSessionChampionData = sessionData
	lastSession = session
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
		rank, _ := client.GetRankByPuuid(summoner.Puuid)
		sessionData.TeamOne = append(sessionData.TeamOne,
			SessionSummoner{
				ChampionId:     summonerPlayer.ChampionId,
				ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
				Summoner:       summoner,
				MatchHistory:   *matchHistory,
				UserTag:        *userTag,
				Rank:           rank,
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
	lastSessionChampionData = sessionData
	return sessionData, nil

}
func isOneGame(session client.Session, lastSession client.Session) bool {
	if len(session.GameData.TeamOne) != len(lastSession.GameData.TeamOne) {
		return false
	}
	for i, _ := range session.GameData.TeamOne {
		if session.GameData.TeamOne[i].Puuid != lastSession.GameData.TeamOne[i].Puuid {
			return false

		}
	}
	if len(session.GameData.TeamTwo) != len(lastSession.GameData.TeamTwo) {
		return false
	}
	for i, _ := range session.GameData.TeamTwo {
		if session.GameData.TeamTwo[i].Puuid != lastSession.GameData.TeamTwo[i].Puuid {
			return false
		}
	}
	return true
}
