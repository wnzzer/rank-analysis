package api

import (
	"fmt"
	lru "github.com/hashicorp/golang-lru"
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
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

var (
	summonerCache *lru.Cache
)

func init() {
	var err error
	summonerCache, err = lru.New(20)
	if err != nil {
		panic(fmt.Sprintf("Failed to create LRU cache: %v", err))
	}
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
	if cached, ok := summonerCache.Get(puuid); ok {
		init_log.AppLog.Info("GetSummonerByPuuid() cache hit, puuid:", puuid)
		if summoner, ok := cached.(Summoner); ok {
			return summoner, nil
		}
	}

	uri := "lol-summoner/v2/summoners/puuid/%s"
	err := util.Get(fmt.Sprintf(uri, puuid), &summoner)

	if err != nil {
		return Summoner{}, err
	}
	summonerCache.Add(puuid, summoner)

	return summoner, nil
}
func (summoner *Summoner) EnrichImgKeys() {
	key := StoreProfileIcon(summoner.ProfileIconId)
	summoner.ProfileIconKey = key
}
