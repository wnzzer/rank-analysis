<template>
    <n-space vertical>
      <!-- Display Settings -->
      <n-card>
        <n-text tag="div" class="setting-title">显示设置</n-text>
        
        <n-space vertical>
          <div class="setting-item">
            <span class="setting-label">主题</span>
            <n-radio-group v-model:value="theme">
              <n-radio key="light" value="light">
                <span class="radio-label">
                  <i class="icon">☀️</i> 浅色
                </span>
              </n-radio>
              <n-radio key="dark" value="dark">
                <span class="radio-label">
                  <i class="icon">🌙</i> 深色
                </span>
              </n-radio>
              <n-radio key="auto" value="auto">
                <span class="radio-label">
                  <i class="icon">⚙️</i> 自动
                </span>
              </n-radio>
            </n-radio-group>
          </div>
        </n-space>
      </n-card>
  
      <!-- Tab Settings -->
      <n-card>
        <n-text tag="div" class="setting-title">活跃设置</n-text>
        
        <n-space vertical>
          <div class="setting-item">
            <span class="setting-label">活跃位置</span>
            <n-radio-group v-model:value="tabPosition">
              <n-radio key="left" value="left">左侧</n-radio>
              <n-radio key="right" value="right">右侧</n-radio>
            </n-radio-group>
          </div>
  
          <div class="setting-item">
            <span class="setting-label">自动切换到连接</span>
            <n-switch v-model:value="autoSwitchToConnected" />
          </div>
  
          <div class="setting-item">
            <span class="setting-label">显示活跃时间</span>
            <n-switch v-model:value="showTabTime" />
          </div>
        </n-space>
      </n-card>
  
      <!-- Helper Settings -->
      <n-card>
        <n-text tag="div" class="setting-title">助手设置</n-text>
        
        <n-space vertical>
          <div class="setting-item">
            <span class="setting-label">显示模型图标</span>
            <n-switch v-model:value="showModuleIcons" />
          </div>
        </n-space>
      </n-card>
    </n-space>
  </template>
<script setup lang="ts">
import { ref } from 'vue'


// Theme settings
const theme = ref<'light' | 'dark' | 'auto'>('light')

// Tab settings
const tabPosition = ref<'left' | 'right'>('left')
const autoSwitchToConnected = ref(false)
const showTabTime = ref(false)

// Helper settings
const showModuleIcons = ref(false)
</script>



<style scoped>
.setting-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 16px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.setting-label {
  font-size: 14px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon {
  font-style: normal;
}
</style>