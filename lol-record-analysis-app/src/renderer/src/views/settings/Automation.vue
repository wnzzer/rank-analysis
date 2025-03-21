<template>
    <n-space vertical>
      <!-- Display Settings -->
      <n-card>
        <n-text tag="div" class="setting-title">基本设置</n-text>
        
        <n-space vertical>
          <div class="setting-item">
            <span class="setting-label">自动接受对局</span>
                <n-switch v-model:value="autoAccept" />

          </div>      


          <div class="setting-item">
            <span class="setting-label">自动选择英雄</span>
                <n-switch v-model:value="autoPick" />

          </div>
          <div class="setting-item">
            <span class="setting-label">自动禁止英雄</span>
                <n-switch v-model:value="autoBan" />

          </div>
  
        </n-space>
      </n-card>

    </n-space>
  </template>
<script setup lang="ts">
import { ref } from 'vue'
const autoAccept = ref(false)
const autoPick = ref(false)
const autoBan = ref(false)



// Helper settings
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