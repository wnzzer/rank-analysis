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
// GetConfig 获取指定配置项
func GetConfig(c *gin.Context) {
	key := c.Param("key")

	// 先获取值到 interface{} 类型变量
	untypedValue := config.Get[any](key)

	// 然后检查 untypedValue 是否为 nil
	if untypedValue == nil {
		c.JSON(200, "")
		return
	}

	// 如果不是 nil，再将该值直接返回，Gin 的 JSON 处理会自动处理 interface{} 类型
	c.JSON(200, untypedValue)
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
