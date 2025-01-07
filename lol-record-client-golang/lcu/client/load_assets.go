package client

import (
	"lol-record-analysis/lcu/util"
)

var itemsMap = map[int]string{}

type Items []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

func GetItemBase64ById(id int) string {
	if len(itemsMap) == 0 {
		initItemMap()
	}
	return itemsMap[id]
}

func initItemMap() {
	var items Items

	err := util.Get("lol-game-data/assets/v1/items.json", &items)
	if err != nil {
		panic(err)
	}

	for _, item := range items {
		itemsMap[item.ID], _ = util.GetImgAsBase64(item.IconPath)
	}

}

func GetChampionBase64ById(id int) string {
	if len(championMap) == 0 {
		initChampionMap()
	}
	return championMap[id]
}

var championMap = map[int]string{}

type Champion []struct {
	ID                 int    `json:"id"`                 //
	SquarePortraitPath string `json:"squarePortraitPath"` //
}

func initChampionMap() {
	var champions Champion
	err := util.Get("lol-game-data/assets/v1/champion-summary.json", &champions)
	if err != nil {
	}
	for _, champion := range champions {
		championMap[champion.ID], _ = util.GetImgAsBase64(champion.SquarePortraitPath)

	}

}

type Spells []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

var spellMap = map[int]string{}

func initSpellMap() {
	var spells Spells
	err := util.Get("lol-game-data/assets/v1/summoner-spells.json", &spells)
	if err != nil {
		panic(err)
	}
	for _, spell := range spells {
		spellMap[spell.ID], _ = util.GetImgAsBase64(spell.IconPath)
	}

}
func GetSpellBase64ById(id int) string {
	if len(spellMap) == 0 {
		initSpellMap()
	}
	return spellMap[id]

}

type Perks []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

var perksMap = map[int]string{}

func initPerksMap() {
	var perks Perks
	err := util.Get("lol-game-data/assets/v1/perks.json", &perks)
	if err != nil {
		panic(err)
	}
	for _, perk := range perks {
		perksMap[perk.ID], _ = util.GetImgAsBase64(perk.IconPath)
	}
}
func GetPerkBase64ById(id int) string {
	if len(perksMap) == 0 {
		initPerksMap()
	}
	return perksMap[id]
}
