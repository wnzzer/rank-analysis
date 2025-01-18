package handlers

import (
	"github.com/gin-gonic/gin"
	lru "github.com/hashicorp/golang-lru"
	"lol-record-analysis/lcu/client"
	"lol-record-analysis/util/init_log"
	"time"
)

var (
	// 设置缓存最大容量为 10，过期时间为 1分钟
	cache *lru.Cache
)

type CacheItem struct {
	Data      SessionSummoner
	ExpiresAt time.Time
}

func init() {
	var err error
	// 初始化 LRU 缓存，最大容量为 10
	cache, err = lru.New(10)
	if err != nil {
		init_log.AppLog.Fatal("Failed to create session LRU cache:", err)
	}
}

func GetSessionData(c *gin.Context) {
	getSessionData, err := curSessionChampion()
	if err != nil {
		init_log.AppLog.Error("GetSessionData() failed", err)
		c.JSON(500, gin.H{})
		return
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

func curSessionChampion() (SessionData, error) {
	// 判断状态,若没有在游戏中,直接返回
	phase, _ := client.GetPhase()
	if phase != client.ChampSelect && phase != client.InProgress && phase != client.PreEndOfGame && phase != client.EndOfGame {
		return SessionData{}, nil
	}
	session, _ := client.GetSession()
	// 判断是否在选英雄阶段
	if phase == client.ChampSelect {
		selectSession, err := client.GetChampSelectSession()
		if err != nil {
			return SessionData{}, err
		}
		session.GameData.TeamOne = selectSession.MyTeam
		session.GameData.TeamTwo = session.GameData.TeamTwo[:0]

	}

	var sessionData = SessionData{}
	sessionData.Phase = session.Phase
	sessionData.Type = session.GameData.Queue.Type
	sessionData.TypeCn = client.QueueTypeToCn[session.GameData.Queue.Type]

	// 反转自己到队伍1
	needSwap := true
	for _, playerSummoner := range session.GameData.TeamOne {
		mySummoner, _ := client.GetCurSummoner()
		if playerSummoner.Puuid == mySummoner.Puuid {
			needSwap = false
		}
	}
	if needSwap {

		session.GameData.TeamOne, session.GameData.TeamTwo = session.GameData.TeamTwo, session.GameData.TeamOne
	}

	// 处理队伍一
	for _, summonerPlayer := range session.GameData.TeamOne {
		var summoner client.Summoner
		var matchHistory *client.MatchHistory
		var userTag *UserTag
		var rank client.Rank
		// 若没有puuid,则跳过
		if summonerPlayer.Puuid == "" {
			continue
		}
		// 检查缓存
		if cachedSummonerPlayer, found := cache.Get(summonerPlayer.Puuid); found {
			cacheItem := cachedSummonerPlayer.(*CacheItem)
			if time.Now().Before(cacheItem.ExpiresAt) {
				cacheItem.Data.ChampionId = summonerPlayer.ChampionId
				cacheItem.Data.ChampionBase64 = client.GetChampionBase64ById(summonerPlayer.ChampionId)
				sessionData.TeamOne = append(sessionData.TeamOne, cacheItem.Data)
				continue
			}
		}
		// 缓存未命中，重新请求数据
		summoner, _ = getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ = GetMatchHistoryCore(MatchHistoryParams{
			Puuid:    summoner.Puuid,
			BegIndex: 0,
			EndIndex: 2,
		}, false)
		userTag, _ = GetTagCore(summoner.Puuid, "")
		rank, _ = client.GetRankByPuuid(summoner.Puuid)

		summonerSummonerData := SessionSummoner{
			ChampionId:     summonerPlayer.ChampionId,
			ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
			Summoner:       summoner,
			MatchHistory:   *matchHistory,
			UserTag:        *userTag,
			Rank:           rank,
		}

		// 添加到队伍中
		sessionData.TeamOne = append(sessionData.TeamOne, summonerSummonerData)

		// 缓存数据
		cache.Add(summonerPlayer.Puuid, &CacheItem{
			Data:      summonerSummonerData,
			ExpiresAt: time.Now().Add(1 * time.Minute), // 缓存1分钟
		})
	}

	// 处理队伍二
	for _, summonerPlayer := range session.GameData.TeamTwo {
		var summoner client.Summoner
		var matchHistory *client.MatchHistory
		var userTag *UserTag
		// 若没有puuid,则跳过
		if summonerPlayer.Puuid == "" {
			continue
		}
		// 检查缓存
		if cachedSummonerPlayer, found := cache.Get(summonerPlayer.Puuid); found {
			cacheItem := cachedSummonerPlayer.(*CacheItem)
			cacheItem.Data.ChampionId = summonerPlayer.ChampionId
			cacheItem.Data.ChampionBase64 = client.GetChampionBase64ById(summonerPlayer.ChampionId)
			if time.Now().Before(cacheItem.ExpiresAt) {
				sessionData.TeamTwo = append(sessionData.TeamTwo, cacheItem.Data)
				continue
			}
		}
		// 缓存未命中，重新请求数据
		summoner, _ = getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ = GetMatchHistoryCore(MatchHistoryParams{
			Puuid:    summoner.Puuid,
			BegIndex: 0,
			EndIndex: 2,
		}, false)
		userTag, _ = GetTagCore(summoner.Puuid, "")

		summonerSummonerData := SessionSummoner{
			ChampionId:     summonerPlayer.ChampionId,
			ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
			Summoner:       summoner,
			MatchHistory:   *matchHistory,
			UserTag:        *userTag,
		}

		// 添加到队伍中
		sessionData.TeamTwo = append(sessionData.TeamTwo, summonerSummonerData)

		// 缓存数据
		cache.Add(summonerPlayer.Puuid, &CacheItem{
			Data:      summonerSummonerData,
			ExpiresAt: time.Now().Add(1 * time.Minute), // 缓存1分钟
		})
	}

	return sessionData, nil
}
