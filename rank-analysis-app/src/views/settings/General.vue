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
      <n-form-item label="帮助改进">
        <ShareSwitch />
      </n-form-item>
      <n-form-item label="赛后右下角弹卡">
        <n-space vertical :size="4">
          <n-switch
            v-model:value="postGameToast"
            data-test="postgame-toast-switch"
            @update:value="handlePostGameToastUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            排位结束后在屏幕右下角弹出本局战报小卡，不抢焦点，25 秒后自动收起，进选人时立刻关闭。
          </n-text>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { useMessage } from 'naive-ui'
import ShareSwitch from './ShareSwitch.vue'
import { POSTGAME_TOAST_CONFIG_KEY } from '@renderer/services/postGameToast'

const matchCount = ref(4)
/** 赛后右下角弹卡（默认开：键不存在时视为 true） */
const postGameToast = ref(true)
const message = useMessage()

onMounted(async () => {
  try {
    const val = await getConfigByIpc<number>('matchHistoryCount')
    if (typeof val === 'number') {
      matchCount.value = val
    }
  } catch (e) {
    console.error(e)
  }
  try {
    postGameToast.value = (await getConfigByIpc<boolean>(POSTGAME_TOAST_CONFIG_KEY)) !== false
  } catch (e) {
    console.error(e)
  }
})

const handleUpdate = async (value: number | null) => {
  if (!value) return
  try {
    await putConfigByIpc('matchHistoryCount', value)
    message.success('设置已保存，下次获取数据时生效')
  } catch (e) {
    message.error('保存失败')
  }
}

const handlePostGameToastUpdate = async (value: boolean) => {
  try {
    await putConfigByIpc(POSTGAME_TOAST_CONFIG_KEY, value)
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}
</script>
