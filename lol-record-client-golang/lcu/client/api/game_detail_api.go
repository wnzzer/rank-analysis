package api

import (
	"fmt"
	"lol-record-analysis/lcu/util"
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
		ChampionBase64 string `json:"championBase64"`
		ParticipantId  int    `json:"participantId"`
		TeamId         int    `json:"teamId"`
		ChampionId     int    `json:"championId"`
		Spell1Id       int    `json:"spell1Id"`
		Spell1Base64   string `json:"spell1Base64"`
		Spell2Id       int    `json:"spell2Id"`
		Spell2Base64   string `json:"spell2Base64"`
		Stats          struct {
			Win                    bool   `json:"win"`
			Item0                  int    `json:"item0"`
			Item1                  int    `json:"item1"`
			Item2                  int    `json:"item2"`
			Item3                  int    `json:"item3"`
			Item4                  int    `json:"item4"`
			Item5                  int    `json:"item5"`
			Item6                  int    `json:"item6"`
			Item0Base64            string `json:"item0Base64"`
			Item1Base64            string `json:"item1Base64"`
			Item2Base64            string `json:"item2Base64"`
			Item3Base64            string `json:"item3Base64"`
			Item4Base64            string `json:"item4Base64"`
			Item5Base64            string `json:"item5Base64"`
			Item6Base64            string `json:"item6Base64"`
			PerkPrimaryStyle       int    `json:"perkPrimaryStyle"`
			PerkSubStyle           int    `json:"perkSubStyle"`
			PerkPrimaryStyleBase64 string `json:"perkPrimaryStyleBase64"`
			PerkSubStyleBase64     string `json:"perkSubStyleBase64"`

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

func GetGameDetail(gameId int) (GameDetail, error) {
	uri := "lol-match-history/v1/games/%d"
	var gameDetail GameDetail
	err := util.Get(fmt.Sprintf(uri, gameId), &gameDetail)
	if err != nil {
		return GameDetail{}, err
	}
	return gameDetail, err
}
