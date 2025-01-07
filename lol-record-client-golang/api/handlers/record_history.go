package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client"
	"net/http"
	"strconv"
)

func GetMatchHistory(c *gin.Context) {
	puuid := c.DefaultQuery("puuid", "")
	name := c.DefaultQuery("name", "")
	if name != "" {
		summoner, _ := client.GetSummonerByName(name)
		puuid = summoner.Puuid
	}

	begIndex, _ := strconv.Atoi(c.DefaultQuery("begIndex", "0"))
	endIndex, _ := strconv.Atoi(c.DefaultQuery("endIndex", "0"))
	if puuid == "" {
		summoner, _ := client.GetCurSummoner()
		puuid = summoner.Puuid
	}
	if puuid == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": errors.New("no puuid")})
	} else {

		matchHistory, _ := client.GetMatchHistoryByPuuid(puuid, begIndex, endIndex)
		//处理装备，天赋，头像 为 base 64
		for i, games := range matchHistory.Games.Games {
			matchHistory.Games.Games[i].QueueName = client.QueueIdToCn[games.QueueId]
			matchHistory.Games.Games[i].GameDetail, _ = client.GetGameDetail(games.GameId)
			for index := range matchHistory.Games.Games[i].GameDetail.Participants {
				participant := &matchHistory.Games.Games[i].GameDetail.Participants[index] // 获取指针
				participant.ChampionBase64 = client.GetChampionBase64ById(participant.ChampionId)

			}
			for index := range matchHistory.Games.Games[i].Participants {
				participant := &games.Participants[index] // 获取指针
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

		c.JSON(http.StatusOK, matchHistory)
	}
}
