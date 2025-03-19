package api

import (
	"fmt"
	"lol-record-analysis/lcu/client/asset"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/lcu/util"
	"net/url"
	"strconv"
	"sync"
)

type MatchHistory struct {
	PlatformId string `json:"platformId"`
	BeginIndex int    `json:"beginIndex"`
	EndIndex   int    `json:"endIndex"`
	Games      struct {
		Games []struct {
			Mvp                   string     `json:"mvp"` //计算信息
			GameDetail            GameDetail `json:"gameDetail"`
			GameId                int        `json:"gameId"`
			GameCreationDate      string     `json:"gameCreationDate"`
			GameDuration          int        `json:"gameDuration"`
			GameMode              string     `json:"gameMode"`
			GameType              string     `json:"gameType"`
			MapId                 int        `json:"mapId"`
			QueueId               int        `json:"queueId"`
			QueueName             string     `json:"queueName"`
			PlatformId            string     `json:"platformId"`
			ParticipantIdentities []struct {
				Player struct {
					AccountId    int    `json:"accountId"`
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

					GoldEarned                  int `json:"goldEarned"` //金钱
					GoldSpent                   int `json:"goldSpent"`
					TotalDamageDealtToChampions int `json:"totalDamageDealtToChampions"` //对英雄伤害
					TotalDamageDealt            int `json:"totalDamageDealt"`            //总伤害
					TotalDamageTaken            int `json:"totalDamageTaken"`            //承受伤害
					TotalHeal                   int `json:"totalHeal"`                   //治疗量
					TotalMinionsKilled          int `json:"totalMinionsKilled"`

					//计算数据
					GroupRate                  int `json:"groupRate"`
					GoldEarnedRate             int `json:"goldEarnedRate"`
					DamageDealtToChampionsRate int `json:"damageDealtToChampionsRate"`
					DamageTakenRate            int `json:"damageTakenRate"`
					HealRate                   int `json:"healRate"`
				} `json:"stats"`
			} `json:"participants"`
		} `json:"games"`
	} `json:"games"`
}

func GetMatchHistoryByPuuid(puuid string, begIndex int, endIndex int) (MatchHistory, error) {
	uri := "lol-match-history/v1/products/lol/%s/matches?%s"
	parms := url.Values{}
	var matchHistory MatchHistory

	parms.Add("begIndex", fmt.Sprintf("%d", begIndex))
	parms.Add("endIndex", fmt.Sprintf("%d", endIndex))

	err := util.Get(fmt.Sprintf(uri, puuid, parms.Encode()), &matchHistory)
	if err != nil {
		return MatchHistory{}, err
	}

	return matchHistory, err

}

func (matchHistory *MatchHistory) EnrichGameDetails() {
	var wg sync.WaitGroup
	for i, games := range matchHistory.Games.Games {

		wg.Add(1)
		go func(i int, gameId int) {
			defer wg.Done()
			// 获取游戏详情
			gameDetail, err := GetGameDetail(gameId)
			if err != nil {
				// 错误处理：你可以在此记录错误日志或采取其他措施
				return
			}

			matchHistory.Games.Games[i].GameDetail = gameDetail
		}(i, games.GameId)
	}
	wg.Wait()

}

// EnrichImgKeys 处理比赛历史的图标和数据转换
func (matchHistory *MatchHistory) EnrichImgKeys() {
	if matchHistory.Games.Games == nil {
		return
	}

	for i, game := range matchHistory.Games.Games {
		matchHistory.Games.Games[i].QueueName = constants.QueueIdToCn[game.QueueId]
		matchHistory.Games.Games[i].Participants[0].ChampionKey = string(asset.ChampionType) + strconv.Itoa(game.Participants[0].ChampionId)
	}
	for i, games := range matchHistory.Games.Games {
		for index := range matchHistory.Games.Games[i].Participants {
			participant := &games.Participants[index]
			participant.Spell1Key = string(asset.SpellType) + strconv.Itoa(participant.Spell1Id)
			participant.Spell2Key = string(asset.SpellType) + strconv.Itoa(participant.Spell2Id)
			participant.Stats.Item0Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item0)
			participant.Stats.Item1Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item1)
			participant.Stats.Item2Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item2)
			participant.Stats.Item3Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item3)
			participant.Stats.Item4Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item4)
			participant.Stats.Item5Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item5)
			participant.Stats.Item6Key = string(asset.ItemType) + strconv.Itoa(participant.Stats.Item6)
			participant.Stats.PerkPrimaryStyleKey = string(asset.PerkType) + strconv.Itoa(participant.Stats.PerkPrimaryStyle)
			participant.Stats.PerkSubStyleKey = string(asset.PerkType) + strconv.Itoa(participant.Stats.PerkSubStyle)
		}
	}
}

// CalculateMvpOrSvp 计算 MVP 或 SVP
func (matchHistory *MatchHistory) CalculateMvpOrSvp() {
	for i := range matchHistory.Games.Games {
		games := &matchHistory.Games.Games[i]
		matchHistory.Games.Games[i].GameDetail, _ = GetGameDetail(games.GameId)

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
			for index := range matchHistory.Games.Games[i].GameDetail.Participants {
				participant1 := &matchHistory.Games.Games[i].GameDetail.Participants[index]
				participant1.ChampionKey = string(asset.ChampionType) + strconv.Itoa(participant1.ChampionId)
			}
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
