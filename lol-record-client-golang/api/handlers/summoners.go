package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"net/http"
)

type SummonerInfo struct {
	Summoner api.Summoner `json:"summoner"`
	Rank     api.Rank     `json:"rank"`
}

// GetSummoner 获取召唤师信息
func GetSummoner(c *gin.Context) {
	summoner, err := getSummoner(c)
	if err != nil {
		init_log.AppLog.Error("getSummoner() failed", err)
		// 错误响应已经在 getSummoner 中处理
		return
	}
	c.JSON(http.StatusOK, summoner)
}

// GetSummonerAndRank 获取召唤师信息和排位信息
func GetSummonerAndRank(c *gin.Context) {
	summoner, err := getSummoner(c)
	if err != nil {
		// 错误响应已经在 getSummoner 中处理
		return
	}

	rank, err := api.GetRankByPuuid(summoner.Puuid)
	if err != nil {
		handleError(c, "GetRankByPuuid() failed", err)
		return
	}

	// 返回召唤师信息和排位信息
	summonerInfo := SummonerInfo{
		Summoner: summoner,
		Rank:     rank,
	}
	c.JSON(http.StatusOK, summonerInfo)
}

// getSummoner 获取召唤师信息，支持通过name或puuid获取，默认获取当前召唤师信息
func getSummoner(c *gin.Context) (api.Summoner, error) {
	name := c.DefaultQuery("name", "")
	puuid := c.DefaultQuery("puuid", "")

	var summoner api.Summoner
	var err error

	if puuid == "" && name == "" {
		summoner, err = api.GetCurSummoner()
		if err != nil {
			handleError(c, "GetCurSummoner() failed", err)
			return api.Summoner{}, err
		}
	} else {
		summoner, err = getSummonerByNameOrPuuid(name, puuid)
		if err != nil {
			handleError(c, "GetSummonerByNameOrPuuid() failed", err)
			return api.Summoner{}, err
		}
	}

	// 设置召唤师平台ID和头像
	if err := enrichSummonerData(&summoner); err != nil {
		handleError(c, "enrichSummonerData() failed", err)
		return api.Summoner{}, err
	}

	return summoner, nil
}

// getSummonerByNameOrPuuid 根据召唤师名称或puuid获取召唤师信息
func getSummonerByNameOrPuuid(name, puuid string) (api.Summoner, error) {
	var summoner api.Summoner
	var err error

	if name != "" {
		summoner, err = api.GetSummonerByName(name)
	} else {
		summoner, err = api.GetSummonerByPuuid(puuid)
	}

	if err != nil {
		init_log.AppLog.Error("GetSummonerByNameOrPuuid() failed: " + err.Error())
	}
	return summoner, err
}

// enrichSummonerData 丰富召唤师信息，获取平台Id和头像
func enrichSummonerData(summoner *api.Summoner) error {
	match, err := api.GetMatchHistoryByPuuid(summoner.Puuid, 0, 0)
	if err != nil {
		return err
	}
	platformId := ""
	if len(match.Games.Games) > 0 {
		platformId = match.Games.Games[0].PlatformId
	}

	summoner.PlatformIdCn = constants.SGPServerIdToName[platformId]

	// 获取头像
	if summoner.ProfileIconId != 0 {
		key := api.StoreProfileIcon(summoner.ProfileIconId)
		summoner.ProfileIconKey = key
	}
	return err
}

// handleError 统一处理错误，记录日志并返回错误响应
func handleError(c *gin.Context, message string, err error) {
	init_log.AppLog.Error(message + ": " + err.Error())
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}
