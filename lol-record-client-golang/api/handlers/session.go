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
func getCache(puuid string) (*SessionSummoner, bool) {
	if cachedSummonerPlayer, found := cache.Get(puuid); found {
		cacheItem := cachedSummonerPlayer.(*CacheItem)
		// 检查是否过期
		if time.Now().Before(cacheItem.ExpiresAt) {
			return &cacheItem.Data, true
		}
	}
	return nil, false
}

// 缓存写入方法
func setCache(puuid string, data SessionSummoner, duration time.Duration) {
	cache.Add(puuid, &CacheItem{
		Data:      data,
		ExpiresAt: time.Now().Add(duration),
	})
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
	ChampionId      int                 `json:"championId"`
	ChampionBase64  string              `json:"championBase64"`
	Summoner        client.Summoner     `json:"summoner"`
	MatchHistory    client.MatchHistory `json:"matchHistory"`
	UserTag         UserTag             `json:"userTag"`
	Rank            client.Rank         `json:"rank"`
	MeetGamers      []OneGamePlayer     `json:"meetGames"`
	PreGroupMarkers PreGroupMaker       `json:"preGroupMarkers"`
}
type PreGroupMaker struct {
	Name  string
	Color string
}

// 处理队伍的公共函数
func processTeam(team []client.OnePlayer, result *[]SessionSummoner) {
	for _, summonerPlayer := range team {
		var summoner client.Summoner
		var matchHistory *client.MatchHistory
		var userTag *UserTag
		var rank client.Rank

		// 若没有 puuid，则跳过
		if summonerPlayer.Puuid == "" {
			continue
		}

		// 从缓存中读取
		if cachedData, found := getCache(summonerPlayer.Puuid); found {
			// 更新 champion 数据
			cachedData.ChampionId = summonerPlayer.ChampionId
			cachedData.ChampionBase64 = client.GetChampionBase64ById(summonerPlayer.ChampionId)
			*result = append(*result, *cachedData)
			continue
		}

		// 缓存未命中，重新请求数据
		summoner, _ = getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ = GetMatchHistoryCore(MatchHistoryParams{
			Puuid:    summoner.Puuid,
			BegIndex: 0,
			EndIndex: 2,
		}, false)
		userTag, _ = GetTagCore(summoner.Puuid, "", true)
		rank, _ = client.GetRankByPuuid(summoner.Puuid)

		// 构造 SessionSummoner 数据
		summonerSummonerData := SessionSummoner{
			ChampionId:     summonerPlayer.ChampionId,
			ChampionBase64: client.GetChampionBase64ById(summonerPlayer.ChampionId),
			Summoner:       summoner,
			MatchHistory:   *matchHistory,
			UserTag:        *userTag,
			Rank:           rank,
		}

		// 添加到结果队伍
		*result = append(*result, summonerSummonerData)

		// 写入缓存
		setCache(summonerPlayer.Puuid, summonerSummonerData, 1*time.Minute)
	}
}

func curSessionChampion() (SessionData, error) {
	mySummoner, _ := client.GetCurSummoner()

	// 判断状态, 若没有在游戏中, 直接返回
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

	// 确保自己在队伍1
	needSwap := true
	for _, playerSummoner := range session.GameData.TeamOne {
		if playerSummoner.Puuid == mySummoner.Puuid {
			needSwap = false
		}
	}
	if needSwap {
		session.GameData.TeamOne, session.GameData.TeamTwo = session.GameData.TeamTwo, session.GameData.TeamOne
	}

	// 处理队伍一和队伍二
	processTeam(session.GameData.TeamOne, &sessionData.TeamOne)
	processTeam(session.GameData.TeamTwo, &sessionData.TeamTwo)
	//标记队伍
	//addPreGroupMarkers(&sessionData)
	//处理遇到过标签
	insertMeetGamersRecord(&sessionData, mySummoner.Puuid)

	//删除Tag标记
	deleteMeetGamersRecord(&sessionData)

	return sessionData, nil
}

// 这部分图标较多,用完删掉
func deleteMeetGamersRecord(sessionData *SessionData) {
	for i, _ := range sessionData.TeamOne {
		sessionSummoner := &sessionData.TeamOne[i]
		sessionSummoner.UserTag.RecentData.OneGamePlayers = make(map[string][]OneGamePlayer)
	}
	for i, _ := range sessionData.TeamTwo {
		sessionSummoner := &sessionData.TeamTwo[i]
		sessionSummoner.UserTag.RecentData.OneGamePlayers = make(map[string][]OneGamePlayer)
	}

}
func insertMeetGamersRecord(sessionData *SessionData, myPuuid string) {
	mySessionSummoner, _ := getCache(myPuuid)

	for _, sessionSummoner := range sessionData.TeamOne {
		if sessionSummoner.Summoner.Puuid == myPuuid {
			continue
		}
		sessionSummoner.MeetGamers = mySessionSummoner.UserTag.RecentData.OneGamePlayers[sessionSummoner.Summoner.Puuid]
	}
	for _, sessionSummoner := range sessionData.TeamTwo {
		if sessionSummoner.Summoner.Puuid == myPuuid {
			continue
		}
		sessionSummoner.MeetGamers = mySessionSummoner.UserTag.RecentData.OneGamePlayers[sessionSummoner.Summoner.Puuid]
	}
}
func addPreGroupMarkers(sessionData *SessionData) {
	// 查找历史的组队记录
	// 一起玩三次且是队友则判断为预组队队友
	myTeamThreshold := 3
	var allMaybeTeams [][]string

	// 处理 TeamOne 的记录
	for _, sessionSummoner := range sessionData.TeamOne {
		var theTeams []string
		for _, playRecordArr := range sessionSummoner.UserTag.RecentData.OneGamePlayers {
			myTeamCount := 0
			for _, playRecord := range playRecordArr {
				if playRecord.IsMyTeam {
					myTeamCount++
				}
			}
			if myTeamCount >= myTeamThreshold {
				theTeams = append(theTeams, playRecordArr[0].Puuid)
			}
		}
		allMaybeTeams = append(allMaybeTeams, theTeams)
	}

	// 处理 TeamTwo 的记录
	for _, sessionSummoner := range sessionData.TeamTwo {
		var theTeams []string
		for _, playRecordArr := range sessionSummoner.UserTag.RecentData.OneGamePlayers {
			myTeamCount := 0
			for _, playRecord := range playRecordArr {
				if playRecord.IsMyTeam {
					myTeamCount++
				}
			}
			if myTeamCount >= myTeamThreshold {
				theTeams = append(theTeams, playRecordArr[0].Puuid)
			}
		}
		allMaybeTeams = append(allMaybeTeams, theTeams)
	}

	var currentGamePuuids map[string]bool
	var teamOnePuuids []string
	var teamTwoPuuids []string
	for _, summoner := range sessionData.TeamOne {
		teamOnePuuids = append(teamOnePuuids, summoner.Summoner.Puuid)
		currentGamePuuids[summoner.Summoner.Puuid] = true
	}
	for _, summoner := range sessionData.TeamTwo {
		teamTwoPuuids = append(teamTwoPuuids, summoner.Summoner.Puuid)
		currentGamePuuids[summoner.Summoner.Puuid] = true
	}
	var mergedTeams [][]string
	for _, team := range allMaybeTeams {
		// 过滤掉不属于当前游戏的 PUUUID
		var filteredTeam []string
		for _, puuid := range team {
			if currentGamePuuids[puuid] {
				filteredTeam = append(filteredTeam, puuid)
			}
		}

		// 如果过滤后的队伍非空，继续进行合并检查
		if len(filteredTeam) > 0 {
			isSubset := false
			for _, mergedTeam := range mergedTeams {
				if isSubsetOf(filteredTeam, mergedTeam) {
					isSubset = true
					break
				}
			}
			if !isSubset {
				mergedTeams = append(mergedTeams, filteredTeam)
			}
		}
	}

	constIndex := 0
	for _, team := range mergedTeams {
		//预先标记的队伍名和颜色
		var preGroupMakerConsts = []PreGroupMaker{
			{Name: "队伍1", Color: "#A1DDB8"},
			{Name: "队伍2", Color: "#4BC9ED"},
			{Name: "队伍3", Color: "#D68582"},
			{Name: "队伍4", Color: "#D68784"},
		}
		// 如果存在两个成员
		intersectionTeamOne := intersection(team, teamOnePuuids)
		intersectionTeamTwo := intersection(team, teamTwoPuuids)
		if len(intersectionTeamOne) >= 2 {
			constIndex++
			for i, _ := range sessionData.TeamOne {
				sessionSummoner := &sessionData.TeamOne[i]
				if oneInArr(sessionSummoner.Summoner.Puuid, intersectionTeamOne) {
					sessionSummoner.PreGroupMarkers = preGroupMakerConsts[constIndex]
				}
			}
		} else if len(intersectionTeamTwo) >= 2 {
			for i, _ := range sessionData.TeamTwo {
				sessionSummoner := &sessionData.TeamOne[i]
				if oneInArr(sessionSummoner.Summoner.Puuid, intersectionTeamTwo) {
					sessionSummoner.PreGroupMarkers = preGroupMakerConsts[constIndex]
				}
			}
		}

	}
}

// 判断是否是子集
func isSubsetOf(smaller, larger []string) bool {
	set := make(map[string]bool)
	for _, elem := range larger {
		set[elem] = true
	}
	for _, elem := range smaller {
		if !set[elem] {
			return false
		}
	}
	return true
}
func intersection(arr1, arr2 []string) []string {
	// 使用 map 存储 arr1 的元素
	set := make(map[string]bool)
	for _, s := range arr1 {
		set[s] = true
	}

	// 遍历 arr2，检查是否在 set 中
	var result []string
	for _, s := range arr2 {
		if set[s] {
			result = append(result, s)
		}
	}

	return result
}

func oneInArr(e string, arr []string) bool {
	for _, elem := range arr {
		if elem == e {
			return true
		}
	}
	return false

}
