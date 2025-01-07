package handlers

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

func Cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")                                // 允许所有来源
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE") // 允许的请求方法
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")     // 允许的自定义头
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length")                 // 暴露的头信息
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")                        // 是否支持 cookie

		// OPTIONS 请求直接返回
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
