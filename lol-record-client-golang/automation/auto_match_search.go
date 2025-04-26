package automation

import (
	"context"
	"lol-record-analysis/lcu/client/api"
	"lol-record-analysis/lcu/client/constants"
	"lol-record-analysis/util/init_log"
	"time"
)

// 添加一个标志位来控制是否自动匹配
var autoMatchEnabled = true

// 添加一个变量来存储上一次的匹配状态
var lastSearchState string

func startMatchAutomation(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case <-ctx.Done():
			return
		default:
			// 获取当前匹配状态
			curState, err := api.GetPhase()
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}

			// 如果状态没变，跳过本次循环
			if lastSearchState == curState {
				continue
			}

			// 从匹配状态变回大厅状态，说明取消了匹配
			if lastSearchState == constants.Matchmaking && curState == constants.Lobby {
				autoMatchEnabled = false
				lastSearchState = curState
				continue
			}
			// 恢复自动匹配状态
			if !autoMatchEnabled && (curState != constants.Lobby) {
				autoMatchEnabled = true
				continue
			}
			// 检查是否开启自动匹配
			if !autoMatchEnabled {
				lastSearchState = curState
				continue
			}

			lastSearchState = curState

			// 检查当前游戏阶段
			if curState != constants.Lobby {
				continue
			}

			// 获取房间信息
			lobby, err := api.GetLobby()
			if err != nil {
				init_log.AppLog.Error(err.Error())
				continue
			}

			// 检查是否是自定义游戏
			if lobby.GameConfig.IsCustom {
				continue
			}

			// 检查是否是房主
			if !isLeader(lobby.Members) {
				continue
			}

			// 开始匹配
			api.PostMatchSearch()
			// 这里等待用户接受匹配,等待状态变更
			time.Sleep(6 * time.Second) // 等待6秒钟
		}
	}
}

// 判断是否是房主
func isLeader(members []api.Member) bool {
	mySummoner, _ := api.GetCurSummoner()
	myPuuid := mySummoner.Puuid
	for _, member := range members {
		if member.Puuid == myPuuid && member.IsLeader {
			return true
		}
	}
	return false
}
