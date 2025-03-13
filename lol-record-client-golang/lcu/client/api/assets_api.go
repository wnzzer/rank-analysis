package api

import (
	"fmt"
	"lol-record-analysis/lcu/util"
)

func GetProfileIconByIconId(id int) (string, error) {
	uri := "lol-game-data/assets/v1/profile-icons/%d.jpg"
	return util.GetImgAsBase64(fmt.Sprintf(uri, id))
}
