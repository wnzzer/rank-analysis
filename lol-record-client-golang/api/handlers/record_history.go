package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/util/init_log"
	"net/http"
	"strconv"
)

type MatchHistoryParams struct {
	Puuid         string
	Name          string
	BegIndex      int
	EndIndex      int
	filterQueueId int
	filterChampId int
}

func GetMatchHistory(c *gin.Context) {
	// 提取参数
	params, err := extractParamsFromGin(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		init_log.AppLog.Error("extractParamsFromGin() failed", err)
		return
	}

	// 调用核心逻辑
	matchHistory, err := GetMatchHistoryCore(params)
	if err != nil {
		init_log.AppLog.Error("GetMatchHistoryCore() failed", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 返回结果
	c.JSON(http.StatusOK, matchHistory)
}

// extractParamsFromGin 从 Gin Context 提取参数
func extractParamsFromGin(c *gin.Context) (MatchHistoryParams, error) {
	begIndex, err := strconv.Atoi(c.DefaultQuery("begIndex", "0"))
	if err != nil {
		return MatchHistoryParams{}, errors.New("invalid begIndex")
	}

	endIndex, err := strconv.Atoi(c.DefaultQuery("endIndex", "0"))
	if err != nil {
		return MatchHistoryParams{}, errors.New("invalid endIndex")
	}

	filterQueueId, err := strconv.Atoi(c.DefaultQuery("filterQueueId", "0"))
	filterChampId, err := strconv.Atoi(c.DefaultQuery("filterChampionId", "0"))

	return MatchHistoryParams{
		Puuid:         c.DefaultQuery("puuid", ""),
		Name:          c.DefaultQuery("name", ""),
		BegIndex:      begIndex,
		EndIndex:      endIndex,
		filterQueueId: filterQueueId,
		filterChampId: filterChampId,
	}, nil
}

// GetMatchHistoryCore 核心业务逻辑
func GetMatchHistoryCore(params MatchHistoryParams) (*api.MatchHistory, error) {
	// 如果通过召唤师名称获取 puuid
	if params.Name != "" {
		summoner, err := api.GetSummonerByName(params.Name)
		if err != nil {
			return nil, err
		}
		params.Puuid = summoner.Puuid
	}

	// 如果没有 puuid，则尝试获取当前召唤师的 puuid
	if params.Puuid == "" {
		summoner, err := api.GetCurSummoner()
		if err != nil {
			return nil, err
		}
		params.Puuid = summoner.Puuid
	}

	// 如果仍然没有 puuid，返回错误
	if params.Puuid == "" {
		return nil, errors.New("no puuid provided")
	}

	// 获取比赛历史
	var matchHistory api.MatchHistory
	var err error
	beginIndex := params.BegIndex
	endIndex := params.EndIndex
	//如果正常无筛选
	if params.filterChampId == 0 && params.filterQueueId == 0 {
		matchHistory, err = api.GetMatchHistoryByPuuid(params.Puuid, params.BegIndex, params.EndIndex)
	}
	if err != nil {
		return nil, err
	}
	//如果筛选
	if params.filterChampId != 0 || params.filterQueueId != 0 {
		matchHistory, beginIndex, endIndex, err = getFilterMatchHistory(params)

	}
	matchHistory.BeginIndex = beginIndex
	matchHistory.EndIndex = endIndex

	// 处理装备、天赋、头像等为 base64

	matchHistory.EnrichImgKeys()

	//计算 MVP
	matchHistory.CalculateMvpOrSvp()

	//计算各种占比
	calculateRate(&matchHistory)
	return &matchHistory, nil
}
func getFilterMatchHistory(params MatchHistoryParams) (api.MatchHistory, int, int, error) {
	filterQueueId := params.filterQueueId
	filterChampId := params.filterChampId
	matchHistory := api.MatchHistory{}
	maxGames := 10 // 设定最大筛选结果数，防止无限循环

	begIndex, endIndex := params.BegIndex, params.BegIndex+49
	for ; begIndex < params.EndIndex; begIndex, endIndex = begIndex+50, endIndex+50 {
		haveData := false
		tempMatchHistory, err := api.GetMatchHistoryByPuuid(params.Puuid, begIndex, endIndex)
		if err != nil {
			return matchHistory, begIndex, endIndex, err
		}

		for j, game := range tempMatchHistory.Games.Games {
			// 进行筛选：如果 filterChampId 和 filterQueueId 都匹配，才添加
			if (filterChampId == 0 || game.Participants[0].ChampionId == filterChampId) &&
				(filterQueueId == 0 || game.QueueId == filterQueueId) {
				matchHistory.Games.Games = append(matchHistory.Games.Games, game)
				haveData = true
			}

			// 如果筛选的比赛数量超出 maxGames，则提前返回
			if len(matchHistory.Games.Games) >= maxGames {
				return matchHistory, begIndex, begIndex + j, err
			}
		}
		if !haveData {
			return matchHistory, begIndex, endIndex, err
		}
	}

	return matchHistory, begIndex, endIndex, nil
}
func calculateRate(matchHistory *api.MatchHistory) {
	for i, _ := range matchHistory.Games.Games {
		game := &matchHistory.Games.Games[i]
		teamId := game.Participants[0].TeamId
		totalGoldEarned := 1
		totalDamageDealtToChampions := 1
		totalDamageTaken := 1
		totalHeal := 1
		myGoldEarned := game.Participants[0].Stats.GoldEarned
		myDamageDealtToChampions := game.Participants[0].Stats.TotalDamageDealtToChampions
		myDamageTaken := game.Participants[0].Stats.TotalDamageTaken
		myHeal := game.Participants[0].Stats.TotalHeal
		for _, participant := range game.GameDetail.Participants {
			if participant.TeamId == teamId {
				totalGoldEarned += participant.Stats.GoldEarned
				totalDamageDealtToChampions += participant.Stats.TotalDamageDealtToChampions
				totalDamageTaken += participant.Stats.TotalDamageTaken
				totalHeal += participant.Stats.TotalHeal
			}
		}
		game.Participants[0].Stats.GoldEarnedRate = int(float64(myGoldEarned) / float64(totalGoldEarned) * 100)
		game.Participants[0].Stats.DamageDealtToChampionsRate = int(float64(myDamageDealtToChampions) / float64(totalDamageDealtToChampions) * 100)
		game.Participants[0].Stats.DamageTakenRate = int(float64(myDamageTaken) / float64(totalDamageTaken) * 100)
		game.Participants[0].Stats.HealRate = int(float64(myHeal) / float64(totalHeal) * 100)

	}
}
