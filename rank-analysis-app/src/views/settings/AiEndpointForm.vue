<!--
  接入点信息：地址、密钥、默认模型、测试连接。内置服务与自定义接入点共用。

  内置服务下这些值都是预填好的——地址只读、密钥留空用内置的、默认模型跟随内置推荐——
  但都摆出来给用户看，密钥和默认模型可以改。自定义接入点下地址与默认模型必填。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NText, useMessage } from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import {
  DASHSCOPE_BASE_URL,
  formatElapsed,
  listAiModels,
  testAiEndpoint
} from '@renderer/services/ai/endpoint'
import type { EndpointTest } from '@renderer/services/ai/endpoint'
import type { ConfigurableProvider, ModelSettings } from '@renderer/services/ai/modelConfig'
import ModelInput from './ModelInput.vue'

/** 地址 / 密钥改动后隔多久重新拉模型列表（ms） */
const LIST_DEBOUNCE_MS = 800

/**
 * @property provider - 内置服务还是自定义接入点
 * @property settings - 远程推荐与用户改过的模型
 */
const props = defineProps<{
  provider: ConfigurableProvider
  settings: ModelSettings
}>()

const emit = defineEmits<{
  /** 用户改了默认模型（空串 = 恢复跟随内置推荐 / 清空） */
  'save-default': [model: string]
  /** 模型列表拉到了（拉不到为空数组），给「按功能指定模型」的下拉共用 */
  listed: [models: string[]]
}>()

const message = useMessage()
const custom = computed(() => props.provider === 'custom')

/** 自定义接入点的地址（内置服务的地址是常量，不存） */
const baseUrl = ref('')
/** 当前服务的密钥：内置对应 dashscopeApiKey，自定义对应 aiCustomApiKey */
const apiKey = ref('')
/** 默认模型输入框里正在填的内容（可能还没保存） */
const modelDraft = ref('')
/** 模型列表；null = 还没拉过或拉不到 */
const models = ref<string[] | null>(null)
const listing = ref(false)
const testing = ref(false)
const tested = ref<EndpointTest | null>(null)

const keyName = computed(() =>
  custom.value ? CONFIG_KEYS.aiCustomApiKey : CONFIG_KEYS.dashscopeApiKey
)
const savedDefault = computed(() => props.settings.models[props.provider].default ?? '')
/** 测试连接用的模型：正在填的 > 已保存的 > 内置推荐（仅内置服务有） */
const modelToTest = computed(
  () =>
    modelDraft.value ||
    savedDefault.value ||
    (custom.value ? '' : props.settings.recommendedDefault)
)
const endpoint = computed(() => ({
  baseUrl: custom.value ? baseUrl.value : undefined,
  apiKey: apiKey.value
}))
/** 拉不到列表时的提示：只在已经填了地址的自定义接入点上显示 */
const listUnavailable = computed(
  () => custom.value && !listing.value && models.value === null && baseUrl.value.trim() !== ''
)

let listTimer: ReturnType<typeof setTimeout> | undefined
/** 每次拉列表递增；晚到的旧结果据此丢弃（用户改得快时不会被旧地址的结果盖掉） */
let listSeq = 0

async function refreshModels(): Promise<void> {
  const seq = ++listSeq
  if (custom.value && !baseUrl.value.trim()) {
    models.value = null
    emit('listed', [])
    return
  }
  listing.value = true
  const list = await listAiModels(endpoint.value)
  if (seq !== listSeq) return
  listing.value = false
  models.value = list
  emit('listed', list ?? [])
}

function scheduleRefresh(): void {
  clearTimeout(listTimer)
  listTimer = setTimeout(refreshModels, LIST_DEBOUNCE_MS)
}

async function load(): Promise<void> {
  const [url, key] = await Promise.all([
    getConfigByIpc<string>(CONFIG_KEYS.aiCustomBaseUrl).catch(() => undefined),
    getConfigByIpc<string>(keyName.value).catch(() => undefined)
  ])
  baseUrl.value = typeof url === 'string' ? url : ''
  apiKey.value = typeof key === 'string' ? key : ''
  modelDraft.value = ''
  tested.value = null
  await refreshModels()
}

onMounted(load)
// 切换服务：换一套地址 / 密钥重新读
watch(() => props.provider, load)
onBeforeUnmount(() => clearTimeout(listTimer))

async function save(key: string, value: string): Promise<void> {
  try {
    await putConfigByIpc(key, value.trim())
    message.success('设置已保存')
  } catch {
    message.error('保存失败')
  }
}

async function saveBaseUrl(): Promise<void> {
  // 用户常把完整的 .../chat/completions 粘进来，存之前截掉
  baseUrl.value = baseUrl.value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
  await save(CONFIG_KEYS.aiCustomBaseUrl, baseUrl.value)
}

async function runTest(): Promise<void> {
  testing.value = true
  tested.value = null
  tested.value = await testAiEndpoint(endpoint.value, modelToTest.value)
  testing.value = false
}

const canTest = computed(
  () => !testing.value && modelToTest.value !== '' && (!custom.value || baseUrl.value.trim() !== '')
)
</script>

<template>
  <div class="endpoint-form">
    <div class="row">
      <span class="row__label">接入点地址</span>
      <div class="row__body">
        <n-input
          v-if="custom"
          v-model:value="baseUrl"
          data-test="ai-base-url"
          placeholder="https://api.example.com/v1"
          @update:value="scheduleRefresh"
          @blur="saveBaseUrl"
        />
        <n-input v-else :value="DASHSCOPE_BASE_URL" data-test="ai-base-url" readonly />
        <n-text :depth="3" class="hint">
          {{
            custom
              ? '任何兼容 OpenAI 接口的服务，填到 /v1 为止。必须是 https（本机地址除外）。'
              : '阿里云百炼，内置服务固定使用这个地址。'
          }}
        </n-text>
      </div>
    </div>

    <div class="row">
      <span class="row__label">密钥</span>
      <div class="row__body">
        <n-input
          v-model:value="apiKey"
          data-test="ai-api-key"
          type="password"
          show-password-on="click"
          :placeholder="custom ? '接入点的 API Key（本机模型可留空）' : '留空使用内置密钥'"
          @update:value="scheduleRefresh"
          @blur="save(keyName, apiKey)"
        />
        <n-text :depth="3" class="hint">
          {{
            custom
              ? '只保存在本机，不会随云同步上传。'
              : '填入你自己的阿里云百炼 API Key 则走你的额度；留空使用内置密钥。只保存在本机。'
          }}
        </n-text>
      </div>
    </div>

    <div class="row">
      <span class="row__label">默认模型</span>
      <div class="row__body">
        <div class="model-line">
          <ModelInput
            class="model-line__input"
            data-test="ai-default-model"
            :value="savedDefault"
            :options="models ?? []"
            :placeholder="custom ? '选择或输入模型名' : `内置推荐：${settings.recommendedDefault}`"
            @commit="(m: string) => emit('save-default', m)"
            @draft="(m: string) => (modelDraft = m)"
          />
          <n-button data-test="ai-test" :loading="testing" :disabled="!canTest" @click="runTest">
            测试
          </n-button>
        </div>
        <n-text v-if="tested?.ok" class="hint test-ok" data-test="ai-test-result">
          可用 · {{ formatElapsed(tested.ms) }}
        </n-text>
        <n-text v-else-if="tested" class="hint test-fail" data-test="ai-test-result">
          {{ tested.error || '不可用' }}
        </n-text>
        <n-text v-if="listUnavailable" :depth="3" class="hint" data-test="ai-list-unavailable">
          该接入点不提供模型列表，请手动填写模型名。
        </n-text>
        <n-text v-else-if="!custom && savedDefault" :depth="3" class="hint">
          已改用你指定的模型。清空即恢复内置推荐（{{ settings.recommendedDefault }}）。
        </n-text>
        <n-text v-else-if="!custom" :depth="3" class="hint">
          没改过时跟随内置推荐，推荐值更新后自动切换。
        </n-text>
      </div>
    </div>
  </div>
</template>

<style scoped>
.endpoint-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  width: 100%;
  max-width: 520px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.row__label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.row__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.model-line {
  display: flex;
  gap: var(--space-8);
}
.model-line__input {
  flex: 1;
  min-width: 0;
}
.hint {
  font-size: var(--font-size-sm);
}
.test-ok {
  color: var(--semantic-win);
}
.test-fail {
  color: var(--semantic-loss);
  word-break: break-word;
}
</style>
