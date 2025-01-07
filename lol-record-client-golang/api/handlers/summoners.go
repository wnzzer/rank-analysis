package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client"
	"lol-record-analysis/util/init_log"
	"net/http"
)

type SummonerInfo struct {
	Summoner client.Summoner `json:"summoner"`
	Rank     client.Rank     `json:"rank"`
}

func GetSummoner(c *gin.Context) {
	summoner := getSummoner(c)
	c.JSON(http.StatusOK, summoner)
}
func GetSummonerAndRank(c *gin.Context) {
	var err error
	summoner := getSummoner(c)
	var rank client.Rank
	// 获取排位信息
	rank, err = client.GetRankByPuuid(summoner.Puuid)
	if err != nil {
		init_log.AppLog.Error("GetRankByPuuid() failed: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 返回结果
	summonerInfo := SummonerInfo{
		Summoner: summoner,
		Rank:     rank,
	}
	c.JSON(http.StatusOK, summonerInfo)
}
func getSummoner(c *gin.Context) client.Summoner {
	var summoner client.Summoner
	var err error
	name := c.DefaultQuery("name", "")
	puuid := c.DefaultQuery("puuid", "")

	// 如果没有信息，就获取自己的信息
	if puuid == "" && name == "" {
		summoner, err = client.GetCurSummoner()
		if err != nil {
			init_log.AppLog.Error("GetCurSummoner() failed: " + err.Error())
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return client.Summoner{}
		}
	} else {
		if name != "" {
			summoner, err = client.GetSummonerByName(name)
		} else {
			summoner, err = client.GetSummonerByPuuid(puuid)
		}
		if err != nil {
			init_log.AppLog.Error("GetSummonerById() failed: " + err.Error())
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return client.Summoner{}
		}
	}
	match, _ := client.GetMatchHistoryByPuuid(summoner.Puuid, 0, 0)
	summoner.PlatformIdCn = client.SGPServerIdToName[match.Games.Games[0].PlatformId]
	//获取头像
	if summoner.ProfileIconId != 0 {
		summoner.ProfileIconBase64, _ = client.GetProfileIconByIconId(summoner.ProfileIconId)
	}
	return summoner

}
