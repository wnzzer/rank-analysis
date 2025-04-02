package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/asset"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"sort"
	"strconv"
)

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
	ChampionId      int              `json:"championId"`
	ChampionKey     string           `json:"championKey"`
	Summoner        api.Summoner     `json:"summoner"`
	MatchHistory    api.MatchHistory `json:"matchHistory"`
	UserTag         UserTag          `json:"userTag"`
	Rank            api.Rank         `json:"rank"`
	MeetGamers      []OneGamePlayer  `json:"meetGames"`
	PreGroupMarkers PreGroupMaker    `json:"preGroupMarkers"`
}
type PreGroupMaker struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// 处理队伍的公共函数
func processTeam(team []api.OnePlayer, result *[]SessionSummoner, mode int) {
	for _, summonerPlayer := range team {
		var summoner api.Summoner
		var matchHistory api.MatchHistory
		var userTag *UserTag
		var rank api.Rank

		// 若没有 puuid，则跳过
		if summonerPlayer.Puuid == "" {
			continue
		}

		summoner, _ = getSummonerByNameOrPuuid("", summonerPlayer.Puuid)
		matchHistory, _ = api.GetMatchHistoryByPuuid(summoner.Puuid, 0, 8)
		matchHistory.EnrichImgKeys()
		userTag, _ = GetTagCore(summoner.Puuid, "", mode)
		rank, _ = api.GetRankByPuuid(summoner.Puuid)

		// 构造 SessionSummoner 数据
		summonerSummonerData := SessionSummoner{
			ChampionId:   summonerPlayer.ChampionId,
			ChampionKey:  string(asset.ChampionType) + strconv.Itoa(summonerPlayer.ChampionId),
			Summoner:     summoner,
			MatchHistory: matchHistory,
			UserTag:      *userTag,
			Rank:         rank,
		}

		// 添加到结果队伍
		*result = append(*result, summonerSummonerData)

	}
}

func curSessionChampion() (SessionData, error) {
	mySummoner, _ := api.GetCurSummoner()

	// 判断状态, 若没有在游戏中, 直接返回
	phase, _ := api.GetPhase()
	if phase != constants.ChampSelect && phase != constants.InProgress && phase != constants.PreEndOfGame && phase != constants.EndOfGame {
		return SessionData{}, nil
	}
	session, _ := api.GetSession()

	// 判断是否在选英雄阶段
	if phase == constants.ChampSelect {
		selectSession, err := api.GetChampSelectSession()
		if err != nil {
			return SessionData{}, err
		}
		session.GameData.TeamOne = selectSession.MyTeam
		session.GameData.TeamTwo = session.GameData.TeamTwo[:0]
	}

	var sessionData = SessionData{}
	sessionData.Phase = session.Phase
	sessionData.Type = session.GameData.Queue.Type
	sessionData.TypeCn = constants.QueueTypeToCn[session.GameData.Queue.Type]

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
	processTeam(session.GameData.TeamOne, &sessionData.TeamOne, session.GameData.Queue.Id)
	processTeam(session.GameData.TeamTwo, &sessionData.TeamTwo, session.GameData.Queue.Id)
	//标记队伍
	addPreGroupMarkers(&sessionData)
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
		sessionSummoner.UserTag.RecentData.OneGamePlayersMap = make(map[string][]OneGamePlayer)
	}
	for i, _ := range sessionData.TeamTwo {
		sessionSummoner := &sessionData.TeamTwo[i]
		sessionSummoner.UserTag.RecentData.OneGamePlayersMap = make(map[string][]OneGamePlayer)
	}

}
func insertMeetGamersRecord(sessionData *SessionData, myPuuid string) {
	// 获取自己的 SessionSummoner
	mySessionSummoner := func() *SessionSummoner {
		for _, sessionSummoner := range sessionData.TeamOne {
			if sessionSummoner.Summoner.Puuid == myPuuid {
				return &sessionSummoner
			}
		}
		return nil
	}()

	// 遍历并修改 TeamOne
	for i := range sessionData.TeamOne {
		sessionSummoner := &sessionData.TeamOne[i] // 取切片中元素的地址
		if sessionSummoner.Summoner.Puuid == myPuuid {
			continue
		}
		sessionSummoner.MeetGamers = mySessionSummoner.UserTag.RecentData.OneGamePlayersMap[sessionSummoner.Summoner.Puuid]
	}

	// 遍历并修改 TeamTwo
	for i := range sessionData.TeamTwo {
		sessionSummoner := &sessionData.TeamTwo[i] // 取切片中元素的地址
		if sessionSummoner.Summoner.Puuid == myPuuid {
			continue
		}
		sessionSummoner.MeetGamers = mySessionSummoner.UserTag.RecentData.OneGamePlayersMap[sessionSummoner.Summoner.Puuid]
	}
}
func deleteCurMeetGamersRecord(sessionData *SessionData, curGameId int) {
	for i := range sessionData.TeamOne {
		sessionSummoner := &sessionData.TeamOne[i] // 取切片中元素的地址
		if len(sessionSummoner.MeetGamers) > 0 && sessionSummoner.MeetGamers[0].GameId == curGameId {
			sessionSummoner.MeetGamers = sessionSummoner.MeetGamers[1:]
		}

	}

	// 遍历并修改 TeamTwo
	for i := range sessionData.TeamTwo {
		sessionSummoner := &sessionData.TeamTwo[i] // 取切片中元素的地址

		if len(sessionSummoner.MeetGamers) > 0 && sessionSummoner.MeetGamers[0].GameId == curGameId {
			sessionSummoner.MeetGamers = sessionSummoner.MeetGamers[1:]
		}

	}
}

func addPreGroupMarkers(sessionData *SessionData) {
	// 一起玩三次且是队友则判断为预组队队友
	friendThreshold := 3
	// 队伍的最少人数
	theTeamMinSum := 2
	var allMaybeTeams [][]string

	// 获取当前对局所有人的 PUUID
	currentGamePuuids := make(map[string]bool)
	var teamOnePuuids, teamTwoPuuids []string
	for _, summoner := range sessionData.TeamOne {
		teamOnePuuids = append(teamOnePuuids, summoner.Summoner.Puuid)
		currentGamePuuids[summoner.Summoner.Puuid] = true
	}
	for _, summoner := range sessionData.TeamTwo {
		teamTwoPuuids = append(teamTwoPuuids, summoner.Summoner.Puuid)
		currentGamePuuids[summoner.Summoner.Puuid] = true
	}

	// 统一处理 TeamOne 和 TeamTwo 的逻辑，把可能的队伍存入 allMaybeTeams
	processTeamForMarkers := func(team []SessionSummoner) {
		for _, sessionSummoner := range team {
			var theTeams []string
			for puuid, playRecordArr := range sessionSummoner.UserTag.RecentData.OneGamePlayersMap {

				// 如果不在当前对局中,跳过这个玩家的统计
				if !currentGamePuuids[puuid] {
					continue
				}

				teamCount := 0
				for _, playRecord := range playRecordArr {
					if playRecord.IsMyTeam {
						teamCount++
					}
				}
				if teamCount >= friendThreshold {
					theTeams = append(theTeams, puuid)
				}
			}
			allMaybeTeams = append(allMaybeTeams, theTeams)
		}
	}

	// 分别处理 TeamOne 和 TeamTwo
	processTeamForMarkers(sessionData.TeamOne)
	processTeamForMarkers(sessionData.TeamTwo)

	// 合并队伍
	var mergedTeams [][]string
	mergedTeams = removeSubsets(allMaybeTeams)

	// 标记预组队信息
	constIndex := 0
	preGroupMakerConsts := []PreGroupMaker{
		{Name: "队伍1", Type: "success"},
		{Name: "队伍2", Type: "warning"},
		{Name: "队伍3", Type: "error"},
		{Name: "队伍4", Type: "info"},
	}

	for _, team := range mergedTeams {
		marked := false
		intersectionTeamOne := intersection(team, teamOnePuuids)
		intersectionTeamTwo := intersection(team, teamTwoPuuids)
		if len(intersectionTeamOne) >= theTeamMinSum {
			for i := range sessionData.TeamOne {
				sessionSummoner := &sessionData.TeamOne[i]
				if oneInArr(sessionSummoner.Summoner.Puuid, intersectionTeamOne) && sessionSummoner.PreGroupMarkers.Name == "" {
					sessionSummoner.PreGroupMarkers = preGroupMakerConsts[constIndex]
					marked = true
				}
			}

		} else if len(intersectionTeamTwo) >= theTeamMinSum {
			for i := range sessionData.TeamTwo {
				sessionSummoner := &sessionData.TeamTwo[i]
				if oneInArr(sessionSummoner.Summoner.Puuid, intersectionTeamTwo) && sessionSummoner.PreGroupMarkers.Name == "" {
					sessionSummoner.PreGroupMarkers = preGroupMakerConsts[constIndex]
					marked = true
				}
			}
		}
		if marked {
			constIndex++
		}
	}
}

// 去重并保留最大范围的数组
func removeSubsets(arrays [][]string) [][]string {
	// 按数组长度排序，确保先处理较大的数组
	sort.Slice(arrays, func(i, j int) bool {
		return len(arrays[i]) > len(arrays[j])
	})

	// 存储去重后的结果
	var result [][]string
	for _, arr := range arrays {
		// 判断当前数组是否被其他数组包含
		isSubsetFlag := false
		for _, resArr := range result {
			if isSubset(arr, resArr) {
				isSubsetFlag = true
				break
			}
		}
		// 如果当前数组没有被包含，就加入结果
		if !isSubsetFlag {
			result = append(result, arr)
		}
	}
	return result
}
func isSubset(a, b []string) bool {
	// 如果a的长度大于b的长度，a肯定不可能是b的子集
	if len(a) >= len(b) {
		return false
	}
	// 使用map存储b中的元素，检查a的元素是否都在b中
	bMap := make(map[string]struct{}, len(b))
	for _, item := range b {
		bMap[item] = struct{}{}
	}
	for _, item := range a {
		if _, found := bMap[item]; !found {
			return false
		}
	}
	return true
}

// 取两个数组的交集
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
