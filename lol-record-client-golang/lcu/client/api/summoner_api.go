package api

import (
	"fmt"
	"lol-record-analysis/lcu/util"
	"net/url"
)

type Summoner struct {
	GameName       string `json:"gameName"`
	TagLine        string `json:"tagLine"`
	SummonerLevel  int    `json:"summonerLevel"`
	ProfileIconId  int    `json:"profileIconId"`
	ProfileIconKey string `json:"profileIconKey"`
	Puuid          string `json:"puuid"`
	PlatformIdCn   string `json:"platformIdCn"`
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
func (summoner *Summoner) EnrichImgKeys() {
	key := StoreProfileIcon(summoner.ProfileIconId)
	summoner.ProfileIconKey = key
}
