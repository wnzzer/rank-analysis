package main

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"lol-record-analysis/api"
	"lol-record-analysis/api/handlers"
	"lol-record-analysis/automation"
)

func main() {

	// 创建 Gin 路由器
	r := gin.Default()
	r.Use(handlers.Cors())

	// 初始化路由
	api.InitRoutes(r)
	go automation.StartAutomation()
	// 启动服务
	r.Run(":11451") // 在 11451 端口上运行

}
func handlePanic() {
	if r := recover(); r != nil {
		fmt.Println("Recovered from panic:", r)
	}
}
