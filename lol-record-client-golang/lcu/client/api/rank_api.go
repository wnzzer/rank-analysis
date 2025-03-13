package api

import (
	"fmt"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/lcu/util"
)

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
	rankInfo.QueueMap.RankedFlexSr.TierCn = constants.TierEnToCn[rankInfo.QueueMap.RankedFlexSr.Tier]
	rankInfo.QueueMap.RankedSolo5x5.TierCn = constants.TierEnToCn[rankInfo.QueueMap.RankedSolo5x5.Tier]
	rankInfo.QueueMap.RankedFlexSr.QueueTypeCn = constants.QueueTypeToCn[rankInfo.QueueMap.RankedFlexSr.QueueType]
	rankInfo.QueueMap.RankedSolo5x5.QueueType = constants.QueueTypeToCn[rankInfo.QueueMap.RankedSolo5x5.QueueType]
	return rankInfo, err
}
