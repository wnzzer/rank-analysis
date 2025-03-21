package api

import (
	"fmt"
	"lol-record-analysis/lcu/client/asset"
	"lol-record-analysis/lcu/util"
	"path/filepath"
	"strconv"
)

func GetProfileIconByIconId(id int) (string, error) {
	uri := "lol-game-data/assets/v1/profile-icons/%d.jpg"
	return util.GetImgAsBase64(fmt.Sprintf(uri, id))
}
func StoreProfileIcon(id int) string {
	key := string(asset.Profile) + strconv.Itoa(id)
	if asset.IsExist(key) {
		return string(asset.Profile) + strconv.Itoa(id)
	}
	uri := "lol-game-data/assets/v1/profile-icons/%d.jpg"
	url := fmt.Sprintf(uri, id)
	bytes, headers, _ := util.GetImgAsBinary(url)
	fileName := filepath.Base(url)
	fileType := headers.Get("Content-Type")
	resourceEntry := asset.ResourceEntry{
		FileName:     fileName,
		FileType:     fileType,
		BinaryData:   bytes,
		ResourceType: asset.Profile,
	}
	asset.StoreEntry(key, resourceEntry)
	return key
}
