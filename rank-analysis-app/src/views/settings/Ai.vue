<!--
  设置页「AI 模型」：选服务 → 接入点信息 → 按功能指定模型 → 其他 AI 相关开关。

  设计见 docs/superpowers/specs/2026-11-21-ai-endpoint-settings-design.md。
  原则是全部透明：实际用的地址、密钥来源、每个功能用哪个模型都摆出来，都能改；
  内置的那套只是预填好的一组值。Claude 走自建中转，模型不在这里配，只保留它自己的密钥输入。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NCard, NForm, NFormItem, NSpace, NSwitch, NText, useMessage } from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import {
  BUILTIN_DEFAULT_MODEL,
  loadModelSettings,
  saveModelOverride
} from '@renderer/services/ai/modelConfig'
import type {
  AiProvider,
  AiScene,
  ConfigurableProvider,
  ModelSettings
} from '@renderer/services/ai/modelConfig'
import AiProviderPicker from './AiProviderPicker.vue'
import AiEndpointForm from './AiEndpointForm.vue'
import AiSceneModels from './AiSceneModels.vue'

const message = useMessage()

/** 当前选中的服务；服务卡片读到配置前为 null（此时先不渲染接入点，免得按错的服务去拉模型列表） */
const provider = ref<AiProvider | null>(null)
const settings = ref<ModelSettings>({
  remote: undefined,
  models: { dashscope: {}, custom: {} },
  recommendedDefault: BUILTIN_DEFAULT_MODEL
})
/** 接入点的模型列表（接入点表单拉到后交上来，给按功能指定的下拉共用） */
const modelOptions = ref<string[]>([])
/** AI 分析是否携带玩家备注（默认开：键不存在时视为 true） */
const aiUseNotes = ref(true)
/** 复盘是否拉对局时间线（默认开） */
const aiUseTimeline = ref(true)

/** 能配模型的服务；选了 Claude（或还没读到配置）时为 null，不显示接入点与模型两块 */
const configurable = computed<ConfigurableProvider | null>(() =>
  provider.value === 'claude' ? null : provider.value
)

onMounted(async () => {
  settings.value = await loadModelSettings()
  for (const [key, target] of [
    [CONFIG_KEYS.aiUsePlayerNotes, aiUseNotes],
    [CONFIG_KEYS.aiUseTimeline, aiUseTimeline]
  ] as const) {
    try {
      const v = await getConfigByIpc<boolean>(key)
      if (typeof v === 'boolean') target.value = v
    } catch (e) {
      console.error(e)
    }
  }
})

/**
 * 保存一个模型覆盖并刷新界面上的显示
 * @param key - `default` 或某个功能
 * @param model - 空串表示恢复跟随
 */
async function saveModel(key: AiScene | 'default', model: string): Promise<void> {
  if (!configurable.value) return
  try {
    const models = await saveModelOverride(configurable.value, key, model)
    settings.value = { ...settings.value, models }
    message.success(model ? '设置已保存' : '已恢复')
  } catch {
    message.error('保存失败')
  }
}

async function saveSwitch(key: string, value: boolean): Promise<void> {
  try {
    await putConfigByIpc(key, value)
    message.success('设置已保存')
  } catch {
    message.error('保存失败')
  }
}
</script>

<template>
  <n-card title="AI 模型">
    <n-form label-placement="left" label-width="120">
      <n-form-item label="服务">
        <AiProviderPicker @change="(p: AiProvider) => (provider = p)" />
      </n-form-item>

      <template v-if="configurable">
        <n-form-item label="接入点">
          <AiEndpointForm
            :provider="configurable"
            :settings="settings"
            @save-default="(m: string) => saveModel('default', m)"
            @listed="(list: string[]) => (modelOptions = list)"
          />
        </n-form-item>
        <n-form-item label="各功能的模型">
          <n-space vertical :size="8" style="width: 100%">
            <AiSceneModels
              :provider="configurable"
              :settings="settings"
              :options="modelOptions"
              @save="saveModel"
            />
            <n-text :depth="3" class="hint">
              提示词是针对内置推荐的模型调的，换用其他模型时回复质量可能下降。
            </n-text>
          </n-space>
        </n-form-item>
      </template>

      <n-form-item label="携带玩家备注">
        <n-space vertical :size="4">
          <n-switch
            v-model:value="aiUseNotes"
            data-test="ai-use-notes"
            @update:value="(v: boolean) => saveSwitch(CONFIG_KEYS.aiUsePlayerNotes, v)"
          />
          <n-text :depth="3" class="hint">
            开启后你的玩家备注会随分析请求发送给上面选择的 AI 服务。
          </n-text>
        </n-space>
      </n-form-item>
      <n-form-item label="使用对局时间线">
        <n-space vertical :size="4">
          <n-switch
            v-model:value="aiUseTimeline"
            data-test="ai-use-timeline"
            @update:value="(v: boolean) => saveSwitch(CONFIG_KEYS.aiUseTimeline, v)"
          />
          <n-text :depth="3" class="hint">
            开启后赛后复盘会拉取官方对局时间线（出装、加点、团战、死亡位置），拉取失败自动按终局数据复盘。
          </n-text>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>
</template>

<style scoped>
.hint {
  font-size: var(--font-size-sm);
}
</style>
