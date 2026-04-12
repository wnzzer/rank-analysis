<template>
  <n-card title="常规设置">
    <n-form label-placement="left" label-width="120">
      <n-form-item label="默认战绩场数">
        <n-input-number
          v-model:value="matchCount"
          :min="1"
          :max="20"
          @update:value="handleUpdate"
        />
      </n-form-item>
    </n-form>
  </n-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useMessage } from 'naive-ui'

const matchCount = ref(4)
const message = useMessage()

onMounted(async () => {
  try {
    const val = await invoke('get_config', { key: 'matchHistoryCount' })
    // Handle explicit number or string fallback
    if (typeof val === 'number') {
      matchCount.value = val
    } else if (typeof val === 'string' && val) {
      matchCount.value = parseInt(val) || 4
    }
  } catch (e) {
    console.error(e)
  }
})

const handleUpdate = async (value: number | null) => {
  if (!value) return
  try {
    await invoke('put_config', { key: 'matchHistoryCount', value })
    message.success('设置已保存，下次获取数据时生效')
  } catch (e) {
    message.error('保存失败')
  }
}
</script>
