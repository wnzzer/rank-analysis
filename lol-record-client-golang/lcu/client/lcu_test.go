package client

import (
	"fmt"
	"net/url"
	"testing"
)

func TestSummoner(t *testing.T) {
	sum, _ := GetCurSummoner()
	fmt.Println(sum)
}
func TestGetICon(t *testing.T) {
	fmt.Println(GetProfileIconByIconId(1116))
}
func TestGetSummonerByPuuid(t *testing.T) {
	sum, _ := GetSummonerByPuuid("70d5f089-2985-58e6-9882-eb930aa2bb04")
	fmt.Println(sum)
}

func Test(t *testing.T) {
	params := url.Values{}
	params.Add("name", "IwgMqe#daw")
	fmt.Println(params.Encode())
}
func TestGetRankById(t *testing.T) {
	GetRankByPuuid("70d5f089-2985-58e6-9882-eb930aa2bb04")
}
func TestGetRankByPuuid(t *testing.T) {
	fmt.Println(GetMatchHistoryByPuuid("70d5f089-2985-58e6-9882-eb930aa2bb04", 0, 0))

}
func TestGetGameDetail(t *testing.T) {
	match, err := GetGameDetail(300320941905)
	if err != nil {
		fmt.Println(err)
	}
	fmt.Println(match)

}
