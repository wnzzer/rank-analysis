package handlers

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/asset"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"math"
	"net/http"
	"strconv"
	"strings"
)

type RecentData struct {
	KDA                           float64                    `json:"kda"`
	Kills                         float64                    `json:"kills"`
	Deaths                        float64                    `json:"deaths"`
	Assists                       float64                    `json:"assists"`
	Wins                          int                        `json:"wins"`
	Losses                        int                        `json:"losses"`
	FlexWins                      int                        `json:"flexWins"`
	FlexLosses                    int                        `json:"flexLosses"`
	SelectMode                    int                        `json:"selectMode"`   //选择的模式
	SelectModeCn                  string                     `json:"selectModeCn"` //选择的名称
	SelectWins                    int                        `json:"selectWins"`
	SelectLosses                  int                        `json:"selectLosses"`
	GroupRate                     int                        `json:"groupRate"`
	AverageGold                   int                        `json:"averageGold"`
	GoldRate                      int                        `json:"goldRate"`
	AverageDamageDealtToChampions int                        `json:"averageDamageDealtToChampions"`
	DamageDealtToChampionsRate    int                        `json:"damageDealtToChampionsRate"`
	OneGamePlayersMap             map[string][]OneGamePlayer `json:"oneGamePlayers"` // 遇到用户的 puuid
	FriendAndDispute              struct {
		FriendsRate     int                     `json:"friendsRate"`
		FriendsSummoner []OneGamePlayerSummoner `json:"friendsSummoner"`
		DisputeRate     int                     `json:"disputeRate"`
		DisputeSummoner []OneGamePlayerSummoner `json:"disputeSummoner"`
	} `json:"friendAndDispute"`
}

// OneGamePlayer 玩家信息
type OneGamePlayer struct {
	Index         int    `json:"index"` //用于标记第几页,第几个
	GameCreatedAt string `json:"gameCreatedAt"`
	GameId        int    `json:"gameId"`
	Puuid         string `json:"puuid"`
	GameName      string `json:"gameName"`
	QueueIdCn     string `json:"queueIdCn"`
	TagLine       string `json:"tagLine"`
	ChampionId    int    `json:"championId"`
	ChampionKey   string `json:"championKey"`
	Win           bool   `json:"win"`
	Kills         int    `json:"kills"`
	Deaths        int    `json:"deaths"`
	Assists       int    `json:"assists"`
	IsMyTeam      bool   `json:"isMyTeam"`
}
type OneGamePlayerSummoner struct {
	WinRate       int `json:"winRate"`
	Wins          int `json:"wins"`
	Losses        int `json:"losses"`
	Summoner      api.Summoner
	OneGamePlayer []OneGamePlayer
}

// RankTag 玩家标签
type RankTag struct {
	Good    bool   `json:"good"`
	TagName string `json:"tagName"`
	TagDesc string `json:"tagDesc"`
}

type UserTag struct {
	RecentData RecentData `json:"recentData"`
	Tag        []RankTag  `json:"tag"`
}

func GetTag(c *gin.Context) {
	puuid := c.DefaultQuery("puuid", "")
	name := c.DefaultQuery("name", "")
	mode := c.DefaultQuery("mode", "0")
	modeInt, err := strconv.Atoi(mode)
	userTag, err := GetTagCore(puuid, name, modeInt)
	userTag.RecentData.OneGamePlayersMap = nil
	if err != nil {
		init_log.AppLog.Error("GetTagCore() failed,%v", err)
		c.JSON(http.StatusOK, gin.H{
			"error": err.Error(),
		})
	} else {
		c.JSON(http.StatusOK, userTag)
	}

}

func GetTagCore(puuid string, name string, mode int) (*UserTag, error) {

	if name != "" {
		summoner, _ := api.GetSummonerByName(name)
		puuid = summoner.Puuid
	}

	if puuid == "" {
		summoner, _ := api.GetCurSummoner()
		puuid = summoner.Puuid
	}

	if puuid == "" {
		return nil, errors.New("puuid or name is empty")
	} else {
		matchHistory, _ := api.GetMatchHistoryByPuuid(puuid, 0, 19)
		matchHistory.EnrichGameDetails()

		var tags []RankTag
		//判断是否是连胜
		streakTag := isStreakTag(&matchHistory)
		if streakTag.TagName != "" {
			tags = append(tags, streakTag)
		}
		//判断是否连败
		losingTag := isLosingTag(&matchHistory)
		if losingTag.TagName != "" {
			tags = append(tags, losingTag)
		}
		//判断是否是娱乐玩家
		casualTag := isCasualTag(&matchHistory)
		if casualTag.TagName != "" {
			tags = append(tags, casualTag)
		}
		//判断是否是特殊玩家
		specialPlayerTag := isSpecialPlayerTag(&matchHistory)
		if len(specialPlayerTag) > 0 {
			tags = append(tags, specialPlayerTag...)
		}

		//获取该玩家局内的所有玩家
		var oneGamePlayerMap map[string][]OneGamePlayer
		oneGamePlayerMap = getOneGamePlayers(&matchHistory)

		//计算 kda,胜率,参团率,伤害转换率
		kills, death, assists := countKda(&matchHistory, mode)
		kda := (kills + assists) / death
		kda = math.Trunc(kda*10) / 10
		kills = math.Trunc(kills*10) / 10
		death = math.Trunc(death*10) / 10
		assists = math.Trunc(assists*10) / 10

		wins, losses, flexWins, flexLosses, selectWins, selectLosses := countWinAndLoss(&matchHistory, mode)
		groupRate, averageGold, goldRate, averageDamageDealtToChampions, DamageDealtToChampionsRate := countGoldAndGroupAndDamageDealtToChampions(&matchHistory, mode)
		userTag := UserTag{
			RecentData: RecentData{
				KDA:                           kda,
				Kills:                         kills,
				Deaths:                        death,
				Assists:                       assists,
				Wins:                          wins,
				Losses:                        losses,
				FlexWins:                      flexWins,
				FlexLosses:                    flexLosses,
				SelectMode:                    mode,
				SelectModeCn:                  constants.QueueIdToCn[mode],
				SelectWins:                    selectWins,
				SelectLosses:                  selectLosses,
				GroupRate:                     groupRate,
				AverageGold:                   averageGold,
				GoldRate:                      goldRate,
				AverageDamageDealtToChampions: averageDamageDealtToChampions,
				DamageDealtToChampionsRate:    DamageDealtToChampionsRate,
				OneGamePlayersMap:             oneGamePlayerMap,
			},
			Tag: tags,
		}
		//计算朋友组队胜率和冤家组队胜率
		countFriendAndDispute(oneGamePlayerMap, &userTag.RecentData, puuid)
		return &userTag, nil
	}
}

func getOneGamePlayers(matchHistory *api.MatchHistory) map[string][]OneGamePlayer {
	oneGamePlayerMap := make(map[string][]OneGamePlayer)
	for index, games := range matchHistory.Games.Games {
		myTeamId := games.Participants[0].TeamId
		for i := 0; i < len(games.GameDetail.ParticipantIdentities); i++ {
			//跳过机器人和没有puuid的玩家
			if games.GameDetail.ParticipantIdentities[i].Player.Puuid == "" || games.GameDetail.ParticipantIdentities[i].Player.Puuid == constants.RobotPuuid {
				continue
			}
			oneGamePlayerMap[games.GameDetail.ParticipantIdentities[i].Player.Puuid] = append(oneGamePlayerMap[games.GameDetail.ParticipantIdentities[i].Player.Puuid], OneGamePlayer{
				Index:         index,
				GameId:        games.GameId,
				Puuid:         games.GameDetail.ParticipantIdentities[i].Player.Puuid,
				GameCreatedAt: games.GameCreationDate,
				IsMyTeam:      myTeamId == games.GameDetail.Participants[i].TeamId,
				GameName:      games.GameDetail.ParticipantIdentities[i].Player.SummonerName,
				TagLine:       games.GameDetail.ParticipantIdentities[i].Player.TagLine,
				ChampionId:    games.GameDetail.Participants[i].ChampionId,
				ChampionKey:   string(asset.ChampionType) + strconv.Itoa(games.GameDetail.Participants[i].ChampionId),
				Kills:         games.GameDetail.Participants[i].Stats.Kills,
				Deaths:        games.GameDetail.Participants[i].Stats.Deaths,
				Assists:       games.GameDetail.Participants[i].Stats.Assists,
				Win:           games.GameDetail.Participants[i].Stats.Win,
				QueueIdCn:     constants.QueueIdToCn[games.QueueId],
			})
		}
	}
	return oneGamePlayerMap
}
func countFriendAndDispute(oneGamePlayersMap map[string][]OneGamePlayer, recentData *RecentData, myPuuid string) {
	friendsArr := make([][]OneGamePlayer, 0)
	disputeArr := make([][]OneGamePlayer, 0)
	friendOrDisputeLimit := 3
	for _, value := range oneGamePlayersMap {
		if len(value) < friendOrDisputeLimit || value[0].Puuid == myPuuid {
			continue
		}
		isMyFriend := true
		for _, oneGamePlayer := range value {
			if !oneGamePlayer.IsMyTeam {
				isMyFriend = false
				break
			}
		}
		if isMyFriend {
			friendsArr = append(friendsArr, value)
		} else {
			disputeArr = append(disputeArr, value)
		}
	}
	//计算朋友组队胜率
	var friendsSummoner []OneGamePlayerSummoner
	friendsWins := 0
	friendsLoss := 0
	for _, value := range friendsArr {
		summoner, _ := api.GetSummonerByPuuid(value[0].Puuid)
		summoner.EnrichImgKeys()
		wins := 0
		losses := 0
		for _, oneGamePlayer := range value {
			if oneGamePlayer.Win {
				wins++
				friendsWins++
			} else {
				losses++
				friendsLoss++
			}
		}
		oneGamePlayerSummoner := OneGamePlayerSummoner{
			WinRate:       int(float64(wins) / float64(wins+losses) * 100),
			Wins:          wins,
			Losses:        losses,
			Summoner:      summoner,
			OneGamePlayer: value,
		}
		friendsSummoner = append(friendsSummoner, oneGamePlayerSummoner)
	}
	friendsRate := int(float64(friendsWins) / float64(friendsWins+friendsLoss+1) * 100)
	//计算冤家组队胜率
	var disputeSummoner []OneGamePlayerSummoner
	disputeWins := 0
	disputeLoss := 0
	for _, value := range disputeArr {
		summoner, _ := api.GetSummonerByPuuid(value[0].Puuid)
		summoner.EnrichImgKeys()
		wins := 0
		losses := 0
		for _, oneGamePlayer := range value {
			//跳过是队友的对局
			if oneGamePlayer.IsMyTeam {
				continue
			}
			if oneGamePlayer.Win {
				wins++
				disputeWins++
			} else {
				losses++
				disputeLoss++
			}
		}
		oneGamePlayerSummoner := OneGamePlayerSummoner{
			WinRate:       int(float64(wins) / float64(wins+losses) * 100),
			Wins:          wins,
			Losses:        losses,
			Summoner:      summoner,
			OneGamePlayer: value,
		}
		disputeSummoner = append(disputeSummoner, oneGamePlayerSummoner)
	}
	disputeRate := int(float64(disputeWins) / float64(disputeWins+disputeLoss+1) * 100)
	recentData.FriendAndDispute.FriendsRate = friendsRate
	recentData.FriendAndDispute.DisputeRate = disputeRate

	//只取前5个,前端无法展示太多
	if len(friendsSummoner) > 5 {
		recentData.FriendAndDispute.FriendsSummoner = friendsSummoner[:5]
	} else {
		recentData.FriendAndDispute.FriendsSummoner = friendsSummoner
	}
	if len(disputeSummoner) > 5 {
		recentData.FriendAndDispute.DisputeSummoner = disputeSummoner[:5]
	} else {
		recentData.FriendAndDispute.DisputeSummoner = disputeSummoner
	}

}

func countGoldAndGroupAndDamageDealtToChampions(matchHistory *api.MatchHistory, mode int) (int, int, int, int, int) {
	count := 1
	myGold := 0
	allGold := 1
	myKA := 0
	allK := 1
	myDamageDealtToChampions := 0
	allDamageDealtToChampions := 1
	for _, games := range matchHistory.Games.Games {
		if mode != 0 && games.QueueId != mode {
			continue
		}
		for _, participant0 := range games.Participants {
			myGold += participant0.Stats.GoldEarned
			myKA += participant0.Stats.Kills
			myKA += participant0.Stats.Assists
			myDamageDealtToChampions += participant0.Stats.TotalDamageDealtToChampions
			for _, participant := range games.GameDetail.Participants {
				if participant0.TeamId == participant.TeamId {
					allGold += participant.Stats.GoldEarned
					allK += participant.Stats.Kills
					allDamageDealtToChampions += participant.Stats.TotalDamageDealtToChampions
				}
			}
		}
		count++
	}
	groupRate := math.Trunc(float64(myKA) / float64(allK) * 100)
	averageGold := math.Trunc(float64(myGold) / float64(count))
	goldRate := math.Trunc(float64(myGold) / float64(allGold) * 100)
	averageDamageDealtToChampions := math.Trunc(float64(myDamageDealtToChampions) / float64(count))
	damageDealtToChampionsRate := math.Trunc(float64(myDamageDealtToChampions) / float64(allDamageDealtToChampions) * 100)
	return int(groupRate), int(averageGold), int(goldRate), int(averageDamageDealtToChampions), int(damageDealtToChampionsRate)
}
func countWinAndLoss(matchHistory *api.MatchHistory, mode int) (int, int, int, int, int, int) {
	wins := 0
	losses := 0
	flexWins := 0
	flexLosses := 0
	selectWins := 0
	selectLosses := 0
	for _, games := range matchHistory.Games.Games {

		if games.QueueId == constants.QueueSolo5x5 {
			if games.Participants[0].Stats.Win == true {
				wins++
			} else {
				losses++
			}
		}
		if games.QueueId == constants.QueueFlex {
			if games.Participants[0].Stats.Win == true {
				flexWins++
			} else {
				flexLosses++

			}
		}
		if mode != 0 {
			if games.QueueId == mode {
				if games.Participants[0].Stats.Win {
					selectWins++
				} else {
					selectLosses++
				}
			}
		} else {
			if games.Participants[0].Stats.Win {
				selectWins++
			} else {
				selectLosses++
			}
		}

	}
	return wins, losses, flexWins, flexLosses, selectWins, selectLosses

}
func countKda(matchHistory *api.MatchHistory, mode int) (float64, float64, float64) {
	count := 1
	kills := 0
	deaths := 1
	assists := 0
	for _, games := range matchHistory.Games.Games {
		if mode != 0 && games.QueueId != mode {
			continue
		}
		count++
		kills += games.Participants[0].Stats.Kills
		deaths += games.Participants[0].Stats.Deaths
		assists += games.Participants[0].Stats.Assists
	}
	return float64(float32(kills) / float32(count)), float64(float32(deaths) / float32(count)), float64(float32(assists) / float32(count))
}

func isStreakTag(matchHistory *api.MatchHistory) RankTag {
	des := "最近胜率较高的大腿玩家哦"

	i := 0
	for _, games := range matchHistory.Games.Games {
		//不是排位不算
		if games.QueueId != constants.QueueSolo5x5 && games.QueueId != constants.QueueFlex {
			continue
		}
		if games.Participants[0].Stats.Win == false {
			break
		}
		i++
	}
	if i >= 3 {
		tag := fmt.Sprintf("%s连胜", numberToChinese(i))
		return RankTag{Good: true, TagName: tag, TagDesc: des}
	} else {
		return RankTag{}
	}

}
func isLosingTag(matchHistory *api.MatchHistory) RankTag {
	desc := "最近连败的玩家哦"

	i := 0
	for _, games := range matchHistory.Games.Games {
		if games.QueueId != constants.QueueSolo5x5 && games.QueueId != constants.QueueFlex {
			continue
		}
		if games.Participants[0].Stats.Win == true {
			break
		}
		i++
	}
	if i >= 3 {
		tag := fmt.Sprintf("%s连败", numberToChinese(i))
		return RankTag{Good: false, TagName: tag, TagDesc: desc}
	} else {
		return RankTag{}
	}

}
func isCasualTag(matchHistory *api.MatchHistory) RankTag {
	desc := "排位比例较少的玩家哦,请宽容一点"
	i := 0
	for _, games := range matchHistory.Games.Games {
		if games.QueueId != constants.QueueSolo5x5 && games.QueueId != constants.QueueFlex {
			i++
		}
	}
	if i > 10 {
		tag := "娱乐"
		return RankTag{Good: false, TagName: tag, TagDesc: desc}
	} else {
		return RankTag{}
	}
}
func isSpecialPlayerTag(matchHistory *api.MatchHistory) []RankTag {
	var tags []RankTag
	var BadSpecialChampion = map[int]string{
		901: "小火龙",
		141: "凯隐",
		10:  "天使",
	}
	desc := "该玩家使用上述英雄比例较高(由于英雄特殊定位,风评相对糟糕的英雄玩家)"
	//糟糕英雄标签选取

	var badSpecialChampionSelectMap = map[string]int{}
	for _, games := range matchHistory.Games.Games {
		if games.QueueId != constants.QueueSolo5x5 && games.QueueId != constants.QueueFlex {
			continue
		}
		championName, _ := BadSpecialChampion[games.Participants[0].ChampionId]
		if championName != "" {
			if _, ok := badSpecialChampionSelectMap[championName]; ok {
				badSpecialChampionSelectMap[championName]++
			} else {
				badSpecialChampionSelectMap[championName] = 1
			}
		}
	}
	for tagName, useCount := range badSpecialChampionSelectMap {
		if useCount >= 5 {
			tags = append(tags, RankTag{Good: false, TagName: tagName, TagDesc: desc})
		}
	}
	return tags
}

// 将数字转换为中文
func numberToChinese(num int) string {
	var chineseDigits = []string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}
	var chineseUnits = []string{"", "十", "百", "千", "万", "亿"}
	if num == 0 {
		return chineseDigits[0]
	}

	var result []string
	unitPos := 0
	zeroFlag := false

	for num > 0 {
		// 获取当前数字的个位数
		digit := num % 10
		if digit == 0 {
			if !zeroFlag && len(result) > 0 {
				result = append(result, chineseDigits[0])
			}
			zeroFlag = true
		} else {
			result = append(result, chineseDigits[digit]+chineseUnits[unitPos])
			zeroFlag = false
		}
		num /= 10
		unitPos++
	}

	// 处理"一十" -> "十"
	if len(result) > 1 && result[len(result)-1] == chineseUnits[1] {
		result = result[:len(result)-1]
	}

	// 反转结果并拼接
	for i := len(result)/2 - 1; i >= 0; i-- {
		opp := len(result) - 1 - i
		result[i], result[opp] = result[opp], result[i]
	}

	return strings.Join(result, "")
}
