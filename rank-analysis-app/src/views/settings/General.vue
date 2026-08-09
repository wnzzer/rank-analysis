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
      <n-form-item label="匿名错误上报">
        <n-space vertical :size="4">
          <n-switch v-model:value="errorReporting" @update:value="handleReportingUpdate" />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            开启后，崩溃与报错（已脱敏，不含召唤师名 / puuid）会上报以便排查问题。重启后生效。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="自定义 AI Key">
        <n-space vertical :size="4">
          <n-input
            v-model:value="dashscopeKey"
            type="password"
            show-password-on="click"
            placeholder="留空使用内置 Key"
            @blur="handleDashscopeKeyUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            填入你自己的 DashScope (通义千问) API Key 则走你的额度；留空使用内置 Key。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="AI 分析携带玩家备注">
        <n-space vertical :size="4">
          <n-switch v-model:value="aiUseNotes" @update:value="handleAiUseNotesUpdate" />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            开启后你的玩家备注会随分析请求发送到 AI 服务。
          </n-text>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { useMessage } from 'naive-ui'

const matchCount = ref(4)
const errorReporting = ref(false)
const dashscopeKey = ref('')
/** AI 分析是否携带玩家备注（默认开：键不存在时视为 true） */
const aiUseNotes = ref(true)
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
    const enabled = await getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingEnabled)
    if (typeof enabled === 'boolean') {
      errorReporting.value = enabled
    }
  } catch (e) {
    console.error(e)
  }
  try {
    const key = await getConfigByIpc<string>(CONFIG_KEYS.dashscopeApiKey)
    if (typeof key === 'string') {
      dashscopeKey.value = key
    }
  } catch (e) {
    console.error(e)
  }
  try {
    const useNotes = await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)
    if (typeof useNotes === 'boolean') {
      aiUseNotes.value = useNotes
    }
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

const handleReportingUpdate = async (value: boolean) => {
  try {
    await putConfigByIpc(CONFIG_KEYS.errorReportingEnabled, value)
    message.success('设置已保存，重启后生效')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleAiUseNotesUpdate = async (value: boolean) => {
  try {
    await putConfigByIpc(CONFIG_KEYS.aiUsePlayerNotes, value)
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleDashscopeKeyUpdate = async () => {
  try {
    await putConfigByIpc(CONFIG_KEYS.dashscopeApiKey, dashscopeKey.value.trim())
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}
</script>
