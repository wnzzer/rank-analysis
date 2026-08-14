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
      <n-form-item label="AI 服务商">
        <n-space vertical :size="4" style="width: 100%">
          <n-select
            :value="aiProvider"
            :options="providerOptions"
            @update:value="handleProviderUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            {{ providerHelp }}
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item v-if="aiProvider !== 'dashscope'" label="服务端地址">
        <n-space vertical :size="4" style="width: 100%">
          <n-input
            v-model:value="aiBaseUrl"
            :placeholder="baseUrlPlaceholder"
            @blur="handleBaseUrlUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            {{ baseUrlHelp }}
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="AI 模型">
        <n-space vertical :size="4" style="width: 100%">
          <n-input
            v-model:value="aiModel"
            :placeholder="modelPlaceholder"
            @blur="handleModelUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            覆盖所有 AI 分析使用的模型名；留空用各服务商默认。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item v-if="aiProvider === 'dashscope'" label="自定义 AI Key">
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
      <n-form-item v-if="aiProvider === 'openai'" label="API Key">
        <n-space vertical :size="4">
          <n-input
            v-model:value="aiApiKey"
            type="password"
            show-password-on="click"
            placeholder="留空使用 OPENAI_API_KEY 环境变量"
            @blur="handleOpenaiKeyUpdate"
          />
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            填 OpenAI 兼容服务商（DeepSeek / 自建网关）的 API Key；Ollama 本地免密钥。
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
      <n-form-item label="AI 用量统计">
        <n-space vertical :size="4" style="width: 100%">
          <n-space align="center" :size="12">
            <n-text :depth="2" style="font-size: var(--font-size-sm)">
              累计 {{ usageTotal.totalTokens.toLocaleString() }} tokens（输入
              {{ usageTotal.promptTokens.toLocaleString() }} / 输出
              {{ usageTotal.completionTokens.toLocaleString() }}），约 ¥{{
                usageTotal.totalCostYuan.toFixed(4)
              }}
            </n-text>
            <n-button
              size="tiny"
              quaternary
              type="error"
              :disabled="usageLog.length === 0"
              @click="handleClearUsage"
            >
              清空记录
            </n-button>
          </n-space>
          <n-text v-if="usageLog.length === 0" :depth="3" style="font-size: var(--font-size-sm)">
            暂无用量记录。每次 AI 分析后这里会累计 token 用量并估算成本。
          </n-text>
          <div v-else class="usage-log">
            <div v-for="entry in usageLog" :key="entry.time" class="usage-row">
              <n-text :depth="2" style="font-size: var(--font-size-sm)">
                {{ formatTime(entry.time) }} · {{ entry.mode === 'player' ? '单人' : '整局' }} ·
                {{ entry.totalTokens.toLocaleString() }} tokens · 约 ¥{{
                  estimateCost(entry).toFixed(4)
                }}
              </n-text>
            </div>
          </div>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import {
  clearAiUsageLog,
  estimateCost,
  getAiUsageLog,
  sumAiUsage,
  type AiUsageEntry
} from '@renderer/services/ai/shared/usage'
import { getAiProviderConfig, type AiProviderKind } from '@renderer/services/ai/stream'
import { useMessage } from 'naive-ui'

const matchCount = ref(4)
const errorReporting = ref(false)
const dashscopeKey = ref('')
/** D-P4：AI 服务商配置（缺省 dashscope，兼容老配置） */
const aiProvider = ref<AiProviderKind>('dashscope')
const aiBaseUrl = ref('')
const aiModel = ref('')
const aiApiKey = ref('')
/** AI 分析是否携带玩家备注（默认开：键不存在时视为 true） */
const aiUseNotes = ref(true)
/** D-P1：AI 用量台账（每次完整分析一条，倒序展示） */
const usageLog = ref<AiUsageEntry[]>([])
const usageTotal = computed(() => sumAiUsage(usageLog.value))
const message = useMessage()

const providerOptions = [
  { label: 'DashScope（通义千问，内置 Key 可用）', value: 'dashscope' },
  { label: 'OpenAI 兼容（DeepSeek / 自建网关）', value: 'openai' },
  { label: 'Ollama（本地模型，免密钥）', value: 'ollama' }
]

const providerHelp = computed(() => {
  switch (aiProvider.value) {
    case 'openai':
      return 'OpenAI 兼容端点，如 DeepSeek / 自建网关；密钥填下方「API Key」或设 OPENAI_API_KEY 环境变量。'
    case 'ollama':
      return '本地模型（免密钥）。需先安装 Ollama 并拉取模型，地址默认 http://127.0.0.1:11434。'
    default:
      return '通义千问官方服务。不填 Key 时自动使用内置 Key（见下方「自定义 AI Key」）。'
  }
})

const modelPlaceholder = computed(() => {
  switch (aiProvider.value) {
    case 'openai':
      return '留空使用默认（deepseek-chat）'
    case 'ollama':
      return '留空使用默认（llama3.1）'
    default:
      return '留空使用默认（qwen-flash）'
  }
})

const baseUrlPlaceholder = computed(() =>
  aiProvider.value === 'ollama'
    ? 'http://127.0.0.1:11434（留空使用默认）'
    : 'https://api.deepseek.com/v1（留空使用默认）'
)

const baseUrlHelp = computed(() =>
  aiProvider.value === 'ollama'
    ? 'Ollama 服务的监听地址，需与实际运行地址一致。'
    : '留空使用 DeepSeek 官方端点；自建网关请填完整的 OpenAI 兼容地址（含 /v1）。'
)

const formatTime = (time: number) => new Date(time).toLocaleString()

const loadUsageLog = () => {
  usageLog.value = [...getAiUsageLog()].reverse()
}

const handleClearUsage = () => {
  clearAiUsageLog()
  loadUsageLog()
  message.success('用量记录已清空')
}

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
    const cfg = await getAiProviderConfig()
    aiProvider.value = cfg.provider
    aiBaseUrl.value = cfg.baseUrl
    aiModel.value = cfg.model
    // apiKey 字段按当前服务商归一到 dashscopeApiKey，openai 场景需读原始 aiApiKey
    const openaiKey = await getConfigByIpc<string>(CONFIG_KEYS.aiApiKey)
    if (typeof openaiKey === 'string') {
      aiApiKey.value = openaiKey
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
  loadUsageLog()
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

const handleProviderUpdate = async (value: AiProviderKind) => {
  // 先落 ref 再持久化（沿用 Automation.vue 单向绑定约定：select 不配 v-model）
  aiProvider.value = value
  try {
    await putConfigByIpc(CONFIG_KEYS.aiProvider, value)
    // 服务商切换时一并持久化当前可见配置，避免 v-if 隐藏未 blur 的输入被丢弃
    await putConfigByIpc(CONFIG_KEYS.aiBaseUrl, aiBaseUrl.value.trim())
    await putConfigByIpc(CONFIG_KEYS.aiModel, aiModel.value.trim())
    await putConfigByIpc(CONFIG_KEYS.aiApiKey, aiApiKey.value.trim())
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleBaseUrlUpdate = async () => {
  try {
    await putConfigByIpc(CONFIG_KEYS.aiBaseUrl, aiBaseUrl.value.trim())
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleModelUpdate = async () => {
  try {
    await putConfigByIpc(CONFIG_KEYS.aiModel, aiModel.value.trim())
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleOpenaiKeyUpdate = async () => {
  try {
    await putConfigByIpc(CONFIG_KEYS.aiApiKey, aiApiKey.value.trim())
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}
</script>

<style scoped>
.usage-log {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage-row {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
}
</style>
