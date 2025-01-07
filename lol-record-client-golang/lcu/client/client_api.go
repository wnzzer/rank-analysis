package client

import (
	"fmt"
	"lol-record-analysis/lcu/util"
	"net/url"
)

type Summoner struct {
	GameName          string `json:"gameName"`
	TagLine           string `json:"tagLine"`
	SummonerLevel     int    `json:"summonerLevel"`
	ProfileIconId     int    `json:"profileIconId"`
	ProfileIconBase64 string `json:"profileIconBase64"`
	Puuid             string `json:"puuid"`
	PlatformIdCn      string `json:"platformIdCn"`
}

func GetCurSummoner() (Summoner, error) {
	var summoner Summoner
	err := util.Get("lol-summoner/v1/current-summoner", &summoner)
	if err != nil {
		return Summoner{}, err
	}
	return summoner, nil
}
func GetSummonerByName(name string) (Summoner, error) {
	var summoner Summoner
	uri := "lol-summoner/v1/summoners/?%s"
	params := url.Values{}
	params.Add("name", name)
	err := util.Get(fmt.Sprintf(uri, params.Encode()), &summoner)
	if err != nil {
		return Summoner{}, err
	}
	return summoner, nil
}
func GetSummonerByPuuid(puuid string) (Summoner, error) {
	var summoner Summoner

	uri := "lol-summoner/v2/summoners/puuid/%s"
	err := util.Get(fmt.Sprintf(uri, puuid), &summoner)

	if err != nil {
		return Summoner{}, err
	}

	return summoner, nil
}

func GetProfileIconByIconId(id int) (string, error) {
	uri := "lol-game-data/assets/v1/profile-icons/%d.jpg"
	return util.GetImgAsBase64(fmt.Sprintf(uri, id))
}

// QueueInfo 表示一个玩家在特定队列中的信息。
type QueueInfo struct {
	// QueueType 表示队列类型，例如 "RANKED_SOLO_5x5"。
	QueueType   string `json:"queueType"`
	QueueTypeCn string `json:"queueTypeCn"`

	// Division 表示玩家当前段位的分段，例如 "I"、"II"。
	Division string `json:"division"`
	Tier     string `json:"tier"`
	TierCn   string `json:"tierCn"`

	// HighestDivision 表示玩家历史最高的分段。
	HighestDivision string `json:"highestDivision"`

	// HighestTier 表示玩家历史最高的段位，例如 "Diamond"、"Master"。
	HighestTier string `json:"highestTier"`

	// IsProvisional 表示该队列是否处于定级赛阶段。
	IsProvisional bool `json:"isProvisional"`

	// LeaguePoints 表示玩家当前的段位点数（LP）。
	LeaguePoints int `json:"leaguePoints"`

	// Losses 表示玩家在该队列的失败场次。
	Losses int `json:"losses"`

	// Wins 表示玩家在该队列的胜利场次。
	Wins int `json:"wins"`
}

type QueueMap struct {
	RankedSolo5x5 QueueInfo `json:"RANKED_SOLO_5x5"`
	RankedFlexSr  QueueInfo `json:"RANKED_FLEX_SR"`
}
type Rank struct {
	QueueMap QueueMap `json:"queueMap"`
}

func GetRankByPuuid(puuid string) (Rank, error) {
	uri := "lol-ranked/v1/ranked-stats/%s"
	var rankInfo Rank

	err := util.Get(fmt.Sprintf(uri, puuid), &rankInfo)
	if err != nil {
		return Rank{}, err
	}

	//进行映射中文
	rankInfo.QueueMap.RankedFlexSr.TierCn = TierEnToCn[rankInfo.QueueMap.RankedFlexSr.Tier]
	rankInfo.QueueMap.RankedSolo5x5.TierCn = TierEnToCn[rankInfo.QueueMap.RankedSolo5x5.Tier]
	rankInfo.QueueMap.RankedFlexSr.QueueTypeCn = QueueTypeToCn[rankInfo.QueueMap.RankedFlexSr.QueueType]
	rankInfo.QueueMap.RankedSolo5x5.QueueType = QueueTypeToCn[rankInfo.QueueMap.RankedSolo5x5.QueueType]
	return rankInfo, err
}

type MatchHistory struct {
	PlatformId string `json:"platformId"`
	Games      struct {
		Games []struct {
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

type GameDetail struct {
	EndOfGameResult       string `json:"endOfGameResult"`
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
