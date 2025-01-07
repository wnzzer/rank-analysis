package util

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// 基本配置
var (
	baseUrlTemplate = "https://riot:%s@127.0.0.1:%s/%s"
	authToken       string
	port            string
)

var (
	lcuClient      *http.Client
	clientInitOnce sync.Once
)

// 获取HTTP客户端
func getLCUClient() *http.Client {
	clientInitOnce.Do(func() {
		lcuClient = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: true, // 忽略证书验证
				},
			},
		}
	})
	return lcuClient
}

// 通用的结果结构体
type Result struct {
	ErrCode    string `json:"errCode"`
	HttpStatus int    `json:"httpStatus"`
	Message    string `json:"message"`
}

// Get 方法获取响应并反序列化
func Get(uri string, result interface{}) error {

	for i := 0; i < 2; i++ {
		var allError error
		if authToken == "" || port == "" {
			authToken, port, allError = GetAuth()
			allError = fmt.Errorf("failed to get auth: %w", allError)
		}

		if uri != "" && uri[0] == '/' {
			uri = uri[1:]
		}

		// 构建请求 URL
		url := fmt.Sprintf(baseUrlTemplate, authToken, port, uri)
		fmt.Println("Request URL:", url)

		// 发起 HTTP 请求
		res, err := getLCUClient().Get(url)
		if err != nil {
			authToken, port, err = GetAuth()
			allError = fmt.Errorf("HTTP request failed: %w", err)
			continue
		}
		defer res.Body.Close()

		// 如果响应状态码为 200，尝试反序列化
		if res.StatusCode == http.StatusOK {
			// 反序列化 JSON 数据到 result
			err := json.NewDecoder(res.Body).Decode(result)
			if err != nil {
				return fmt.Errorf("failed to decode response: %w", err)
			}
			return nil
		} else {
			authToken, port, err = GetAuth()
		}
	}

	// 超过最大重试次数
	return fmt.Errorf("failed to get valid response after retries")
}

func GetImgAsBase64(uri string) (string, error) {
	for i := 0; i < 2; i++ {
		if authToken == "" || port == "" {
			var err error
			authToken, port, err = GetAuth()
			if err != nil {

				return "", fmt.Errorf("failed to get auth: %w", err)
			}
		}

		if uri != "" && uri[0] == '/' {
			uri = uri[1:]
		}

		// 构建请求 URL
		url := fmt.Sprintf(baseUrlTemplate, authToken, port, uri)
		fmt.Println("Request URL:", url)

		// 发起 HTTP 请求
		res, err := getLCUClient().Get(url)
		if err != nil {
			return "", fmt.Errorf("HTTP request failed: %w", err)
		}
		defer res.Body.Close()

		// 如果响应状态码为 200，读取图片内容
		if res.StatusCode == http.StatusOK {
			// 将图片内容读取到字节切片中
			imgData, err := io.ReadAll(res.Body)
			if err != nil {
				return "", fmt.Errorf("failed to read image: %w", err)
			}
			imgType := res.Header.Get("content-type")

			// 将字节数据编码为Base64
			base64Str := base64.StdEncoding.EncodeToString(imgData)
			return fmt.Sprintf("data:%s;base64,", imgType) + base64Str, nil
		} else {
			authToken, port, err = GetAuth()
		}
	}

	// 超过最大重试次数
	return "", fmt.Errorf("failed to get valid response after retries")
}
func BuildUrl(uri string) string {
	if uri != "" && uri[0] == '/' {
		uri = uri[1:]
	}
	return fmt.Sprintf(baseUrlTemplate, authToken, port, uri)
}
