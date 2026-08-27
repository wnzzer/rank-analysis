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
      <n-form-item label="战绩每页条数">
        <n-space vertical :size="4" style="width: 100%">
          <n-space align="center" :size="12">
            <n-select
              :value="matchPageMode"
              :options="matchPageModeOptions"
              style="width: 220px"
              @update:value="handleMatchPageModeUpdate"
            />
            <n-input-number
              v-if="matchPageMode === 'fixed'"
              :value="matchPageSize"
              :min="1"
              :max="50"
              style="width: 120px"
              @update:value="handleMatchPageSizeUpdate"
            />
          </n-space>
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            {{
              matchPageMode === 'auto'
                ? '按窗口高度自动计算（约 6~15 条），窗口缩放时实时调整。'
                : '固定每页显示条数（1~50，默认 10）。'
            }}
          </n-text>
        </n-space>
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
          <n-space align="center" :size="8" style="width: 100%">
            <n-select
              :value="aiProvider"
              :options="providerOptions"
              style="flex: 1"
              @update:value="handleProviderUpdate"
            />
            <n-button size="small" secondary :loading="testing" @click="handleTestConnection">
              测试连接
            </n-button>
          </n-space>
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
      <n-form-item label="战术情报">
        <n-space vertical :size="4" style="width: 100%">
          <n-space align="center" :size="12">
            <n-switch v-model:value="intelEnabled" @update:value="handleIntelUpdate" />
            <n-badge
              :type="
                intelStatus ? (intelStatus.source === 'remote' ? 'success' : 'info') : 'default'
              "
              :processing="intelRefreshing"
            >
              <n-tag :bordered="false" size="small">
                {{
                  intelStatus
                    ? intelStatus.source === 'remote'
                      ? `远程知识库 v${intelStatus.patch}`
                      : `内置知识库 v${intelStatus.patch}`
                    : '知识库未就绪'
                }}
              </n-tag>
            </n-badge>
            <n-text v-if="intelStatus" :depth="3" style="font-size: var(--font-size-sm)">
              {{ formatTime(new Date(intelStatus.updatedAt).getTime()) }} 更新
            </n-text>
            <n-button
              size="tiny"
              secondary
              :loading="intelRefreshing"
              :disabled="!intelEnabled"
              @click="handleIntelRefresh"
            >
              刷新知识库
            </n-button>
          </n-space>
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            开启后，整队 / 对局 AI
            分析会附带本局英雄版本情报、对线克制、近期战绩关联信号与模式知识（数据来自周期性更新的知识库）。关闭后分析不再携带此类情报。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="图标本地缓存">
        <n-space vertical :size="4" style="width: 100%">
          <n-space align="center" :size="12">
            <n-button
              size="tiny"
              secondary
              :loading="cdragonCaching"
              :disabled="cdragonCaching"
              @click="handleCdragonCache"
            >
              一键缓存 CDragon 图标
            </n-button>
            <n-text v-if="cdragonCacheResult" :depth="3" style="font-size: var(--font-size-sm)">
              {{ cdragonCacheResult }}
            </n-text>
          </n-space>
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            手动下载英雄 / 符文 / 召唤师技能图标到本地。缓存成功后，客户端取图失败时用本地
            数据兜底（未缓存的图标直接快速失败，不再等待外网超时）。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="对局浮窗">
        <n-space vertical :size="4" style="width: 100%">
          <n-space align="center" :size="12">
            <span style="font-size: var(--font-size-sm); color: var(--text-secondary)"
              >建议条数</span
            >
            <n-input-number
              v-model:value="overlayPrefs.maxItems"
              size="tiny"
              :min="1"
              :max="6"
              style="width: 90px"
              @update:value="persistOverlay"
            />
            <span style="font-size: var(--font-size-sm); color: var(--text-secondary)"
              >不透明度</span
            >
            <n-slider
              v-model:value="overlayPrefs.opacity"
              :min="0.5"
              :max="1"
              :step="0.05"
              :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
              @update:value="persistOverlay"
            />
            <span style="font-size: var(--font-size-sm); color: var(--text-secondary)">锚点</span>
            <n-select
              v-model:value="overlayPrefs.anchor"
              size="tiny"
              style="width: 110px"
              :options="overlayAnchorOptions"
              @update:value="persistOverlay"
            />
            <span style="font-size: var(--font-size-sm); color: var(--text-secondary)"
              >全局热键</span
            >
            <n-switch
              v-model:value="overlayPrefs.hotkeyEnabled"
              size="small"
              @update:value="persistOverlay"
            />
            <n-text :depth="3" style="font-size: var(--font-size-xs)">Alt+A 开/关浮窗</n-text>
          </n-space>
          <n-text :depth="3" style="font-size: var(--font-size-sm)">
            对局中悬浮的「下一动作建议」与搭子气泡浮窗样式；改动即时生效。
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
import { DEFAULT_PAGE_SIZE, type MatchPageMode } from '@renderer/components/record/pageSize'
import {
  clearAiUsageLog,
  estimateCost,
  getAiUsageLog,
  sumAiUsage,
  type AiUsageEntry
} from '@renderer/services/ai/shared/usage'
import { getAiProviderConfig, type AiProviderKind } from '@renderer/services/ai/stream'
import {
  getKnowledgeStatus,
  forceUpdateKnowledge,
  type KnowledgeStatus
} from '@renderer/services/knowledge'
import { invoke } from '@tauri-apps/api/core'
import { useMessage } from 'naive-ui'
import { emit } from '@tauri-apps/api/event'
import { loadOverlayPrefs, saveOverlayPrefs } from '@renderer/utils/overlayPrefs'
import { applyOverlayHotkey } from '@renderer/features/overlay/hotkeys'

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
/** 战术情报开关（默认开：键不存在或非 false 均视为开） */
const intelEnabled = ref(true)
/** 知识库状态（版本 / 更新时间 / 来源） */
const intelStatus = ref<KnowledgeStatus | null>(null)
const intelRefreshing = ref(false)
/** D-P1：AI 用量台账（每次完整分析一条，倒序展示） */
const usageLog = ref<AiUsageEntry[]>([])
const usageTotal = computed(() => sumAiUsage(usageLog.value))
const message = useMessage()

/** 对局浮窗偏好（localStorage，overlay 窗口同源读取；见 utils/overlayPrefs.ts） */
const overlayPrefs = ref(loadOverlayPrefs())

/** 持久化并实时广播给 overlay 窗口（Tauri emit 全局事件，无需后端参与） */
async function persistOverlay() {
  saveOverlayPrefs(overlayPrefs.value)
  // 热键开关即时生效（幂等：先解绑再按需绑定）
  try {
    await applyOverlayHotkey(overlayPrefs.value.hotkeyEnabled)
  } catch (e) {
    console.warn('全局热键注册失败:', e)
  }
  // 浮窗锚点与位置即时生效
  try {
    const { setOverlayLayout } = await import('@renderer/features/overlay/panels')
    await setOverlayLayout(320, 200, overlayPrefs.value.anchor)
  } catch {
    /* overlay 未运行时可忽略 */
  }
  try {
    await emit('overlay:config', overlayPrefs.value)
  } catch {
    /* overlay 未运行时广播失败可忽略 */
  }
}

const overlayAnchorOptions = [
  { label: '左上', value: 'top-left' },
  { label: '顶中', value: 'top-center' },
  { label: '右上', value: 'top-right' }
]

const cdragonCaching = ref(false)
const cdragonCacheResult = ref('')

/** 战绩每页条数模式（auto=动态 / fixed=固定）与固定条数 */
const matchPageMode = ref<MatchPageMode>('fixed')
const matchPageSize = ref(DEFAULT_PAGE_SIZE)
const matchPageModeOptions = [
  { label: '按窗口高度自动', value: 'auto' },
  { label: '固定条数', value: 'fixed' }
]

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
    const mode = await getConfigByIpc<MatchPageMode>(CONFIG_KEYS.matchPageMode)
    if (mode === 'auto' || mode === 'fixed') {
      matchPageMode.value = mode
    }
  } catch (e) {
    console.error(e)
  }
  try {
    const size = await getConfigByIpc<number>(CONFIG_KEYS.matchPageSize)
    if (typeof size === 'number' && size >= 1) {
      matchPageSize.value = size
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
  try {
    const enabled = await getConfigByIpc<boolean>(CONFIG_KEYS.opggEnabled)
    // 键不存在视为默认开（!== false 语义）；仅显式 false 才关闭
    if (typeof enabled === 'boolean') {
      intelEnabled.value = enabled !== false
    }
  } catch (e) {
    console.error(e)
  }
  loadIntelStatus()
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

const handleMatchPageModeUpdate = async (value: MatchPageMode) => {
  matchPageMode.value = value
  try {
    await putConfigByIpc(CONFIG_KEYS.matchPageMode, value)
    message.success('设置已保存，战绩页刷新时生效')
  } catch (e) {
    message.error('保存失败')
  }
}

const handleMatchPageSizeUpdate = async (value: number | null) => {
  if (!value || value < 1) return
  matchPageSize.value = value
  try {
    await putConfigByIpc(CONFIG_KEYS.matchPageSize, value)
    message.success('设置已保存，战绩页刷新时生效')
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

const handleIntelUpdate = async (value: boolean) => {
  try {
    await putConfigByIpc(CONFIG_KEYS.opggEnabled, value)
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

const loadIntelStatus = async () => {
  intelStatus.value = await getKnowledgeStatus()
}

const handleIntelRefresh = async () => {
  if (intelRefreshing.value) return
  intelRefreshing.value = true
  try {
    const data = await forceUpdateKnowledge()
    if (data) {
      message.success(`知识库已更新至 v${data.patch}`)
    } else {
      message.warning('知识库更新失败，当前使用内置数据')
    }
    await loadIntelStatus()
  } catch (e) {
    message.error(String(e) || '刷新失败')
  } finally {
    intelRefreshing.value = false
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

/** 测试连接：提交当前表单可见的服务商配置（含未保存值）给后端做一次最小非流式请求 */
const testing = ref(false)
const handleTestConnection = async () => {
  if (testing.value) return
  testing.value = true
  try {
    const result = (await invoke('test_ai_provider_connection', {
      request: {
        prompt: '',
        systemPrompt: '只回复 OK',
        model: aiModel.value.trim() || undefined,
        provider: aiProvider.value === 'dashscope' ? undefined : aiProvider.value,
        baseUrl: aiBaseUrl.value.trim() || undefined,
        apiKey:
          aiProvider.value === 'dashscope'
            ? dashscopeKey.value.trim() || undefined
            : aiProvider.value === 'openai'
              ? aiApiKey.value.trim() || undefined
              : undefined,
        responseFormat: undefined
      }
    })) as { model?: string; totalTokens?: number }
    message.success(`连接成功：${result.model || '模型'} · ${result.totalTokens ?? 0} tokens`)
  } catch (e) {
    message.error((e instanceof Error && e.message) || String(e) || '连接失败')
  } finally {
    testing.value = false
  }
}

const handleCdragonCache = async () => {
  if (cdragonCaching.value) return
  cdragonCaching.value = true
  cdragonCacheResult.value = ''
  try {
    const [ok, total] = (await invoke('cache_cdragon_icons')) as [number, number]
    if (total === 0) {
      cdragonCacheResult.value = '缓存任务进行中，请稍候…'
      return
    }
    cdragonCacheResult.value =
      ok >= total
        ? `缓存完成：${ok}/${total} 图标已落盘`
        : `缓存完成：${ok}/${total} 成功（部分失败，未成功的将在取图时快速跳过）`
    message.success(cdragonCacheResult.value)
  } catch (e) {
    cdragonCacheResult.value = ''
    message.error((e instanceof Error && e.message) || String(e) || '缓存失败')
  } finally {
    cdragonCaching.value = false
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
