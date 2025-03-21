package api

import (
	"fmt"
	lru "github.com/hashicorp/golang-lru"
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
)

type GameDetail struct {
	EndOfGameResult       string `json:"endOfGameResult"`
	ParticipantIdentities []struct {
		Player struct {
			AccountId    int    `json:"accountId"`
			Puuid        string `json:"puuid"`
			PlatformId   string `json:"platformId"`
			SummonerName string `json:"summonerName"`
			GameName     string `json:"gameName"`
			TagLine      string `json:"tagLine"`
			SummonerId   int    `json:"summonerId"`
		} `json:"player"`
	} `json:"participantIdentities"`
	Participants []struct {
		ChampionKey   string `json:"championKey"`
		ParticipantId int    `json:"participantId"`
		TeamId        int    `json:"teamId"`
		ChampionId    int    `json:"championId"`
		Spell1Id      int    `json:"spell1Id"`
		Spell1Key     string `json:"spell1Key"`
		Spell2Id      int    `json:"spell2Id"`
		Spell2Key     string `json:"spell2Key"`
		Stats         struct {
			Win                 bool   `json:"win"`
			Item0               int    `json:"item0"`
			Item1               int    `json:"item1"`
			Item2               int    `json:"item2"`
			Item3               int    `json:"item3"`
			Item4               int    `json:"item4"`
			Item5               int    `json:"item5"`
			Item6               int    `json:"item6"`
			Item0Key            string `json:"item0Key"`
			Item1Key            string `json:"item1Key"`
			Item2Key            string `json:"item2Key"`
			Item3Key            string `json:"item3Key"`
			Item4Key            string `json:"item4Key"`
			Item5Key            string `json:"item5Key"`
			Item6Key            string `json:"item6Key"`
			PerkPrimaryStyle    int    `json:"perkPrimaryStyle"`
			PerkSubStyle        int    `json:"perkSubStyle"`
			PerkPrimaryStyleKey string `json:"perkPrimaryStyleKey"`
			PerkSubStyleKey     string `json:"perkSubStyleKey"`

			Kills   int `json:"kills"`
			Deaths  int `json:"deaths"`
			Assists int `json:"assists"`

			GoldEarned                  int `json:"goldEarned"`
			GoldSpent                   int `json:"goldSpent"`
			TotalDamageDealtToChampions int `json:"totalDamageDealtToChampions"` //对英雄伤害
			TotalDamageDealt            int `json:"totalDamageDealt"`
			TotalDamageTaken            int `json:"totalDamageTaken"` //承受伤害
			TotalHeal                   int `json:"totalHeal"`
			TotalMinionsKilled          int `json:"totalMinionsKilled"`
		} `json:"stats"`
	} `json:"participants"`
}

var (
	gameDetailCache *lru.Cache
)

// 初始化缓存（建议放在程序初始化处调用）
func init() {
	var err error
	gameDetailCache, err = lru.New(200)
	if err != nil {
		panic(fmt.Sprintf("Failed to create LRU cache: %v", err))
	}
}

func GetGameDetail(gameId int) (GameDetail, error) {
	// 尝试从缓存获取
	if cached, ok := gameDetailCache.Get(gameId); ok {
		if detail, ok := cached.(GameDetail); ok {
			init_log.AppLog.Info("GetGameDetail() cache hit, gameId: %v", gameId)
			return detail, nil
		}
	}
	// 缓存未命中，从接口获取
	uri := "lol-match-history/v1/games/%d"
	var gameDetail GameDetail
	err := util.Get(fmt.Sprintf(uri, gameId), &gameDetail)
	if err != nil {
		return GameDetail{}, err
	}

	// 存入缓存（仅在成功时缓存）
	gameDetailCache.Add(gameId, gameDetail)

	return gameDetail, nil
}
