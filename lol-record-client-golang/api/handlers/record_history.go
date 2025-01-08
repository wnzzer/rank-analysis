package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client"
	"net/http"
	"strconv"
)

type MatchHistoryParams struct {
	Puuid    string
	Name     string
	BegIndex int
	EndIndex int
}

func GetMatchHistory(c *gin.Context) {
	// 提取参数
	params, err := extractParamsFromGin(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 调用核心逻辑
	matchHistory, err := GetMatchHistoryCore(params)
	if err != nil {
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

	return MatchHistoryParams{
		Puuid:    c.DefaultQuery("puuid", ""),
		Name:     c.DefaultQuery("name", ""),
		BegIndex: begIndex,
		EndIndex: endIndex,
	}, nil
}

// GetMatchHistoryCore 核心业务逻辑
func GetMatchHistoryCore(params MatchHistoryParams) (*client.MatchHistory, error) {
	// 如果通过召唤师名称获取 puuid
	if params.Name != "" {
		summoner, err := client.GetSummonerByName(params.Name)
		if err != nil {
			return nil, err
		}
		params.Puuid = summoner.Puuid
	}

	// 如果没有 puuid，则尝试获取当前召唤师的 puuid
	if params.Puuid == "" {
		summoner, err := client.GetCurSummoner()
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
	matchHistory, err := client.GetMatchHistoryByPuuid(params.Puuid, params.BegIndex, params.EndIndex)
	if err != nil {
		return nil, err
	}

	// 处理装备、天赋、头像等为 base64
	processMatchHistory(&matchHistory)

	// 计算 MVP 或 SVP
	calculateMvpOrSvp(&matchHistory)

	return &matchHistory, nil
}

// processMatchHistory 处理比赛历史的图标和数据转换
func processMatchHistory(matchHistory *client.MatchHistory) {
	for i, games := range matchHistory.Games.Games {
		matchHistory.Games.Games[i].QueueName = client.QueueIdToCn[games.QueueId]
		matchHistory.Games.Games[i].GameDetail, _ = client.GetGameDetail(games.GameId)
		for index := range matchHistory.Games.Games[i].GameDetail.Participants {
			participant := &matchHistory.Games.Games[i].GameDetail.Participants[index]
			participant.ChampionBase64 = client.GetChampionBase64ById(participant.ChampionId)
		}
		for index := range matchHistory.Games.Games[i].Participants {
			participant := &games.Participants[index]
			participant.Spell1Base64 = client.GetSpellBase64ById(participant.Spell1Id)
			participant.Spell2Base64 = client.GetSpellBase64ById(participant.Spell2Id)
			participant.ChampionBase64 = client.GetChampionBase64ById(participant.ChampionId)
			participant.Stats.Item0Base64 = client.GetItemBase64ById(participant.Stats.Item0)
			participant.Stats.Item1Base64 = client.GetItemBase64ById(participant.Stats.Item1)
			participant.Stats.Item2Base64 = client.GetItemBase64ById(participant.Stats.Item2)
			participant.Stats.Item3Base64 = client.GetItemBase64ById(participant.Stats.Item3)
			participant.Stats.Item4Base64 = client.GetItemBase64ById(participant.Stats.Item4)
			participant.Stats.Item5Base64 = client.GetItemBase64ById(participant.Stats.Item5)
			participant.Stats.Item6Base64 = client.GetItemBase64ById(participant.Stats.Item6)
			participant.Stats.PerkPrimaryStyleBase64 = client.GetPerkBase64ById(participant.Stats.PerkPrimaryStyle)
			participant.Stats.PerkSubStyleBase64 = client.GetPerkBase64ById(participant.Stats.PerkSubStyle)
		}
	}
}

// calculateMvpOrSvp 计算 MVP 或 SVP
func calculateMvpOrSvp(matchHistory *client.MatchHistory) {
	for i := range matchHistory.Games.Games {
		games := &matchHistory.Games.Games[i]
		mvpTag := ""
		myTeamId := games.Participants[0].TeamId
		isWin := games.Participants[0].Stats.Win
		deaths := 1
		if games.Participants[0].Stats.Deaths != 0 {
			deaths = games.Participants[0].Stats.Deaths
		}
		myKda := (games.Participants[0].Stats.Kills*2 + games.Participants[0].Stats.Assists) / deaths
		if isWin {
			mvpTag = "MVP"
		} else {
			mvpTag = "SVP"
		}

		for _, participant := range games.GameDetail.Participants {
			deaths := 1
			if participant.Stats.Deaths != 0 {
				deaths = participant.Stats.Deaths
			}
			if participant.TeamId == myTeamId && (participant.Stats.Kills*2+participant.Stats.Assists)/deaths > myKda {
				mvpTag = ""
				break
			}
		}
		if mvpTag != "" {
			games.Mvp = mvpTag
		}
	}
}
