package api

import (
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
)

type Lobby struct {
	CanStartActivity      bool       `json:"canStartActivity"`
	GameConfig            GameConfig `json:"gameConfig"`
	Invitations           []any      `json:"invitations"`
	LocalMember           Member     `json:"localMember"`
	Members               []Member   `json:"members"`
	MucJwtDto             MucJwtDto  `json:"mucJwtDto"`
	MultiUserChatID       string     `json:"multiUserChatId"`
	MultiUserChatPassword string     `json:"multiUserChatPassword"`
	PartyID               string     `json:"partyId"`
	PartyType             string     `json:"partyType"`
	PopularChampions      []any      `json:"popularChampions"`
	Restrictions          any        `json:"restrictions"`
	ScarcePositions       []any      `json:"scarcePositions"`
	Warnings              any        `json:"warnings"`
}

type GameConfig struct {
	AllowablePremadeSizes              []any    `json:"allowablePremadeSizes"`
	CustomLobbyName                    string   `json:"customLobbyName"`
	CustomMutatorName                  string   `json:"customMutatorName"`
	CustomRewardsDisabledReasons       []any    `json:"customRewardsDisabledReasons"`
	CustomSpectatorPolicy              string   `json:"customSpectatorPolicy"`
	CustomSpectators                   []any    `json:"customSpectators"`
	CustomTeam100                      []Member `json:"customTeam100"`
	CustomTeam200                      []Member `json:"customTeam200"`
	GameMode                           string   `json:"gameMode"`
	IsCustom                           bool     `json:"isCustom"`
	IsLobbyFull                        bool     `json:"isLobbyFull"`
	IsTeamBuilderManaged               bool     `json:"isTeamBuilderManaged"`
	MapID                              int      `json:"mapId"`
	MaxHumanPlayers                    int      `json:"maxHumanPlayers"`
	MaxLobbySize                       int      `json:"maxLobbySize"`
	MaxTeamSize                        int      `json:"maxTeamSize"`
	PickType                           string   `json:"pickType"`
	PremadeSizeAllowed                 bool     `json:"premadeSizeAllowed"`
	QueueID                            int      `json:"queueId"`
	ShouldForceScarcePositionSelection bool     `json:"shouldForceScarcePositionSelection"`
	ShowPositionSelector               bool     `json:"showPositionSelector"`
	ShowQuickPlaySlotSelection         bool     `json:"showQuickPlaySlotSelection"`
}

type PlayerSlot struct {
	ChampionId         int    `json:"championId"`
	Perks              string `json:"perks"`
	PositionPreference string `json:"positionPreference"`
	SkinId             int    `json:"skinId"`
	Spell1             int    `json:"spell1"`
	Spell2             int    `json:"spell2"`
}

type Member struct {
	AllowedChangeActivity         bool         `json:"allowedChangeActivity"`
	AllowedInviteOthers           bool         `json:"allowedInviteOthers"`
	AllowedKickOthers             bool         `json:"allowedKickOthers"`
	AllowedStartActivity          bool         `json:"allowedStartActivity"`
	AllowedToggleInvite           bool         `json:"allowedToggleInvite"`
	AutoFillEligible              bool         `json:"autoFillEligible"`
	AutoFillProtectedForPromos    bool         `json:"autoFillProtectedForPromos"`
	AutoFillProtectedForRemedy    bool         `json:"autoFillProtectedForRemedy"`
	AutoFillProtectedForSoloing   bool         `json:"autoFillProtectedForSoloing"`
	AutoFillProtectedForStreaking bool         `json:"autoFillProtectedForStreaking"`
	BotChampionID                 int          `json:"botChampionId"`
	BotDifficulty                 string       `json:"botDifficulty"`
	BotID                         string       `json:"botId"`
	BotPosition                   string       `json:"botPosition"`
	BotUUID                       string       `json:"botUuid"`
	FirstPositionPreference       string       `json:"firstPositionPreference"`
	IntraSubteamPosition          any          `json:"intraSubteamPosition"`
	IsBot                         bool         `json:"isBot"`
	IsLeader                      bool         `json:"isLeader"`
	IsSpectator                   bool         `json:"isSpectator"`
	MemberData                    any          `json:"memberData"`
	PlayerSlots                   []PlayerSlot `json:"playerSlots"`
	Puuid                         string       `json:"puuid"`
	Ready                         bool         `json:"ready"`
	SecondPositionPreference      string       `json:"secondPositionPreference"`
	ShowGhostedBanner             bool         `json:"showGhostedBanner"`
	StrawberryMapID               any          `json:"strawberryMapId"`
	SubteamIndex                  any          `json:"subteamIndex"`
	SummonerIconID                int          `json:"summonerIconId"`
	SummonerID                    int64        `json:"summonerId"`
	SummonerInternalName          string       `json:"summonerInternalName"`
	SummonerLevel                 int          `json:"summonerLevel"`
	SummonerName                  string       `json:"summonerName"`
	TeamID                        int          `json:"teamId"`
}

type MucJwtDto struct {
	ChannelClaim string `json:"channelClaim"`
	Domain       string `json:"domain"`
	JWT          string `json:"jwt"`
	TargetRegion string `json:"targetRegion"`
}

func GetLobby() (Lobby, error) {
	// 尝试从缓存获取

	// 缓存未命中，从接口获取
	uri := "lol-lobby/v2/lobby"
	var lobby Lobby
	err := util.Get(uri, &lobby)
	if err != nil {
		return Lobby{}, err
	}

	return lobby, nil
}
func GetMember() (Member, error) {
	uri := "lol-lobby/v2/lobby/members"
	var member Member
	err := util.Get(uri, &member)
	if err != nil {
		init_log.AppLog.Error(err.Error())
		return Member{}, err
	}
	return member, nil
}
func PostMatchSearch() {
	uri := "lol-lobby/v2/lobby/matchmaking/search"
	err := util.Post(uri, nil, nil)
	if err != nil {
		init_log.AppLog.Error(err.Error())
	}
}
