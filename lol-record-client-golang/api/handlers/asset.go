package handlers

import (
	"github.com/gin-gonic/gin"
	"lol-record-analysis/lcu/client/asset"
	"net/http"
)

func GetAsset(c *gin.Context) {
	key := c.DefaultQuery("key", "")
	resourceEntry := asset.GetAsset(key)
	c.Header("etag", key)
	c.Header("content-type", resourceEntry.FileType)

	// Set cache control header for one day (86400 seconds)
	c.Header("Cache-Control", "max-age=86400")

	// Serve the binary data as response
	c.Data(http.StatusOK, resourceEntry.FileType, resourceEntry.BinaryData)
}
