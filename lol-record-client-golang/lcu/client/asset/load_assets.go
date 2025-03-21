package asset

import (
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
	"path/filepath"
	"strconv"
	"sync"
)

type Items []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

type Champion []struct {
	ID                 int    `json:"id"`                 //
	SquarePortraitPath string `json:"squarePortraitPath"` //
}

type Spells []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

type Perks []struct {
	ID       int    `json:"id"`       //
	IconPath string `json:"iconPath"` //
}

// ResourceType 重构二进制数据

type ResourceType string

const (
	ItemType     ResourceType = "item"
	ChampionType ResourceType = "champion"
	SpellType    ResourceType = "spell"
	PerkType     ResourceType = "perk"
	Profile      ResourceType = "profile"
)

type ResourceEntry struct {
	FileName     string       `json:"fileName"`
	FileType     string       `json:"fileType"`
	ResourceType ResourceType `json:"resourceType"`
	BinaryData   []byte       `json:"binaryData"`
}

var (
	resourceEntryMap = make(map[string]ResourceEntry)
)

var mutex sync.Mutex

func StoreEntry(key string, value ResourceEntry) {
	if _, exists := resourceEntryMap[key]; !exists {
		mutex.Lock()
		resourceEntryMap[key] = value
		mutex.Unlock()
	}
}
func IsExist(key string) bool {
	if _, exists := resourceEntryMap[key]; !exists {
		return exists
	}
	return false
}

func GetAsset(key string) ResourceEntry {
	// 使用 sync.Once 确保 initAllAssets 只执行一次
	if len(resourceEntryMap) < 100 {
		mutex.Lock()
		initAllAssets()
		mutex.Unlock()
	}
	return resourceEntryMap[key]
}
func init() {
	GetAsset(string(Profile) + "0")
}

func initAllAssets() {
	initItems()
	initChampions()
	initSpells()
	//initPerks()

}

// 物品资源初始化
func initItems() {
	type Item struct {
		ID       int    `json:"id"`
		IconPath string `json:"iconPath"`
	}
	var items []Item
	err := util.Get("lol-game-data/assets/v1/items.json", &items)
	if err != nil {
		init_log.AppLog.Error("Error getting image: " + err.Error())
	}
	for _, item := range items {
		bytes, headers, err := util.GetImgAsBinary(item.IconPath)
		if err != nil {
			init_log.AppLog.Error("Error getting image: " + err.Error())
		}
		contentType := headers.Get("Content-Type")
		fileName := filepath.Base(item.IconPath)
		key := string(ItemType) + strconv.Itoa(item.ID)
		resourceEntryMap[key] = ResourceEntry{
			BinaryData:   bytes,
			FileType:     contentType,
			FileName:     fileName,
			ResourceType: ItemType,
		}
	}
}

// 英雄资源初始化
func initChampions() {
	type Champion struct {
		ID                 int    `json:"id"`
		SquarePortraitPath string `json:"squarePortraitPath"`
	}
	var champions []Champion
	err := util.Get("lol-game-data/assets/v1/champion-summary.json", &champions)
	if err != nil {
		init_log.AppLog.Error("Error getting image json: " + err.Error())
	}
	for _, champion := range champions {
		bytes, headers, err := util.GetImgAsBinary(champion.SquarePortraitPath)
		if err != nil {
			init_log.AppLog.Error("Error getting image: " + err.Error())
		}
		contentType := headers.Get("Content-Type")
		fileName := filepath.Base(champion.SquarePortraitPath)
		key := string(ChampionType) + strconv.Itoa(champion.ID)
		resourceEntryMap[key] = ResourceEntry{
			BinaryData:   bytes,
			FileType:     contentType,
			FileName:     fileName,
			ResourceType: ChampionType,
		}
	}
}

// 召唤师技能初始化
func initSpells() {
	type Spell struct {
		ID       int    `json:"id"`
		IconPath string `json:"iconPath"`
	}
	var spells []Spell
	err := util.Get("lol-game-data/assets/v1/summoner-spells.json", &spells)
	if err != nil {
		init_log.AppLog.Error("Error getting image json: " + err.Error())
	}
	for _, spell := range spells {
		bytes, headers, err := util.GetImgAsBinary(spell.IconPath)
		if err != nil {
			init_log.AppLog.Error("Error getting image: " + err.Error())
		}
		contentType := headers.Get("Content-Type")
		fileName := filepath.Base(spell.IconPath)
		key := string(SpellType) + strconv.Itoa(spell.ID)
		resourceEntryMap[key] = ResourceEntry{
			BinaryData:   bytes,
			FileType:     contentType,
			FileName:     fileName,
			ResourceType: SpellType,
		}
	}
}

// 符文资源初始化
func initPerks() {
	type Perk struct {
		ID       int    `json:"id"`
		IconPath string `json:"iconPath"`
	}
	var perks []Perk
	err := util.Get("lol-game-data/assets/v1/perks.json", &perks)
	if err != nil {
		init_log.AppLog.Error("Error getting image json: " + err.Error())
	}
	for _, perk := range perks {
		bytes, headers, err := util.GetImgAsBinary(perk.IconPath)
		if err != nil {
			init_log.AppLog.Error("Error getting image: " + err.Error())
		}
		contentType := headers.Get("Content-Type")
		fileName := filepath.Base(perk.IconPath)
		key := string(PerkType) + strconv.Itoa(perk.ID)
		resourceEntryMap[key] = ResourceEntry{
			BinaryData:   bytes,
			FileType:     contentType,
			FileName:     fileName,
			ResourceType: PerkType,
		}
	}
}
