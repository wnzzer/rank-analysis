package config

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/spf13/viper"
)

var (
	v                   *viper.Viper
	once                sync.Once
	onChangeCallbackArr []func(key string, newValue interface{})
)

// Init 显式初始化配置（推荐替代init函数）
func init() {
	once.Do(func() {
		v = viper.New()

		// 基础配置
		v.SetConfigName("config")
		v.AddConfigPath("./config")
		v.SetConfigType("yaml")

		// 设置默认值
		setDefaults(v)

		// 创建配置目录
		configDir := "./config"
		if err := createDirIfNotExist(configDir); err != nil {
			return
		}

		// 生成或加载配置文件
		configPath := filepath.Join(configDir, "config.yaml")
		if err := setupConfigFile(v, configPath); err != nil {
			return
		}

	})
}

// 设置默认值
func setDefaults(v *viper.Viper) {
	v.SetDefault("settings.auto.acceptMatchSwitch", false)
	v.SetDefault("settings.auto.pickChampionSwitch", false)
	v.SetDefault("settings.auto.banChampionSwitch", false)
	v.SetDefault("settings.auto.startMatchSwitch", false)
	v.SetDefault("settings.auto.pickChampionSlice", make([]int, 0))
	v.SetDefault("settings.auto.banChampionSlice", make([]int, 0))

}

// 创建目录（如果不存在）
func createDirIfNotExist(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("创建配置目录失败: %w", err)
		}
	}
	return nil
}

// 处理配置文件
func setupConfigFile(v *viper.Viper, path string) error {
	// 如果文件不存在，生成默认配置
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := v.SafeWriteConfigAs(path); err != nil {
			return fmt.Errorf("生成默认配置文件失败: %w", err)
		}
		log.Printf("已生成默认配置文件: %s", path)
	}

	// 读取配置
	if err := v.ReadInConfig(); err != nil {
		return fmt.Errorf("读取配置文件失败: %w", err)
	}

	// 监听配置变更
	v.WatchConfig()
	return nil
}

// GetAll 获取所有配置（用于全量导出）
func GetAll() map[string]interface{} {
	return v.AllSettings()
}

// Set 设置配置值并触发回调
func Set(key string, value interface{}) {
	oldValue := v.Get(key)
	if oldValue != value {
		v.Set(key, value)
		err := OverwriteConfig()
		if err != nil {
			return
		}
		// 调用回调函数
		for _, onChangeCallback := range onChangeCallbackArr {
			onChangeCallback(key, value)
		}
	}
}

// RegisterOnChangeCallback 注册配置变更回调函数
func RegisterOnChangeCallback(callback func(key string, newValue interface{})) {
	onChangeCallbackArr = append(onChangeCallbackArr, callback)
}

func Get[T any](key string) T {
	var result T
	switch any(result).(type) {
	case string:
		return any(v.GetString(key)).(T)
	case int:
		return any(v.GetInt(key)).(T)
	case []int:
		return any(v.GetIntSlice(key)).(T)
	case []string:
		return any(v.GetStringSlice(key)).(T)
	case bool:
		return any(v.GetBool(key)).(T)
	default:
		return v.Get(key).(T)
	}
}

// OverwriteConfig 覆盖当前配置到文件
func OverwriteConfig() error {
	if err := v.WriteConfigAs(filepath.Join("./config", "config.yaml")); err != nil {
		return fmt.Errorf("覆盖配置文件失败: %w", err)
	}
	return nil
}
