package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/asset"
	"net/http"
)

func GetAsset(c *gin.Context) {
	key := c.DefaultQuery("key", "")

	// 1. 获取资源并检查错误
	resourceEntry := asset.GetAsset(key)

	// 3. 检查资源是否有效（可选，根据实际情况调整）
	if resourceEntry.FileType == "" || len(resourceEntry.BinaryData) == 0 {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	// 4. 正常响应时设置ETag和缓存头
	c.Header("etag", key)
	c.Header("content-type", resourceEntry.FileType)
	c.Header("Cache-Control", "max-age=86400")

	// 5. 返回成功响应
	c.Data(http.StatusOK, resourceEntry.FileType, resourceEntry.BinaryData)
}
