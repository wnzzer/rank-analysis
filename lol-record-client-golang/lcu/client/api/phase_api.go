package api

import (
	"lol-record-analysis/lcu/util"
	"lol-record-analysis/util/init_log"
	"sync"
	"time"
)

type PhaseCache struct {
	mu            sync.Mutex
	lastPhase     string
	lastFetchTime time.Time
}

// 创建全局缓存实例
var phaseCache = &PhaseCache{}

// GetPhase 获取游戏阶段，使用缓存机制
func GetPhase() (string, error) {
	phaseCache.mu.Lock()
	defer phaseCache.mu.Unlock()

	// 检查缓存是否在2秒内
	currentTime := time.Now()
	if !phaseCache.lastFetchTime.IsZero() &&
		currentTime.Sub(phaseCache.lastFetchTime) <= 2000*time.Millisecond {
		return phaseCache.lastPhase, nil
	}

	// 获取新的阶段
	uri := "lol-gameflow/v1/gameflow-phase"
	var phase string
	err := util.Get(uri, &phase)
	if err != nil {
		init_log.AppLog.Error("获取游戏阶段失败: " + err.Error())
		return "", err
	}

	// 更新缓存
	phaseCache.lastPhase = phase
	phaseCache.lastFetchTime = currentTime

	return phase, nil
}
