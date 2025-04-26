package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/common/config"
)

// ConfigResponse 响应结构体
type ConfigResponse struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

// GetFullConfig 获取完整配置
func GetFullConfig(c *gin.Context) {
	allSettings := config.GetAll()
	c.JSON(200, gin.H{"config": allSettings})
}

// GetConfig 获取指定配置项
func GetConfig(c *gin.Context) {
	key := c.Param("key")

	// 根据类型自动获取值
	value := config.Get[any](key)
	if value == nil {
		c.JSON(404, gin.H{"error": "配置项不存在"})
		return
	}

	c.JSON(200, value)
}

type UpdateConfigRequest struct {
	Value interface{} `json:"value"`
}

// UpdateConfig 更新配置项
func UpdateConfig(c *gin.Context) {
	key := c.Param("key")

	// 解析请求体
	var value UpdateConfigRequest
	if err := c.ShouldBindJSON(&value); err != nil {
		c.JSON(400, gin.H{"error": "无效请求"})
		return
	}

	// 安全更新配置
	config.Set(key, value.Value)

	// 持久化到文件
	if err := config.OverwriteConfig(); err != nil {
		c.JSON(500, gin.H{"error": "配置保存失败"})
		return
	}

	c.JSON(200, gin.H{"message": "配置更新成功"})
}
