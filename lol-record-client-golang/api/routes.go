package api

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/api/handlers"
)

// InitRoutes 初始化所有路由
func InitRoutes(r *gin.Engine) {
	// v1版本
	userGroup := r.Group("/v1")
	{
		userGroup.GET("/GetSummonerAndRank", handlers.GetSummonerAndRank)

		userGroup.GET("/GetSummoner", handlers.GetSummoner)

		userGroup.GET("/GetMatchHistory", handlers.GetMatchHistory)

		userGroup.GET("/GetTag", handlers.GetTag)

		userGroup.GET("/GetSessionData", handlers.GetSessionData)

		//资源
		userGroup.GET("/GetAsset", handlers.GetAsset)

	}
	configGroup := userGroup.Group("/config")
	{
		configGroup.GET("", handlers.GetFullConfig)     // 获取全部配置
		configGroup.GET("/:key", handlers.GetConfig)    // 获取指定配置项
		configGroup.PUT("/:key", handlers.UpdateConfig) // 更新配置项
	}
}
