<!--
  按功能指定模型（默认收起）：每个功能一行。
  没改过的显示实际会用的模型与来源（内置推荐 / 跟随默认）；改过的显示用户填的值，可恢复。
-->
<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem } from 'naive-ui'
import { AI_SCENES, explainModel } from '@renderer/services/ai/modelConfig'
import type {
  AiScene,
  ConfigurableProvider,
  ModelSettings
} from '@renderer/services/ai/modelConfig'
import ModelInput from './ModelInput.vue'

/**
 * @property provider - 内置服务还是自定义接入点
 * @property settings - 远程推荐与用户改过的模型
 * @property options - 接入点的模型列表（拉不到为空数组）
 */
const props = defineProps<{
  provider: ConfigurableProvider
  settings: ModelSettings
  options: string[]
}>()

const emit = defineEmits<{
  /** 用户给某个功能指定了模型（空串 = 恢复跟随） */
  save: [scene: AiScene, model: string]
}>()

/** 用户给这个功能单独填的值；没填为空串 */
function own(scene: AiScene): string {
  return props.settings.models[props.provider][scene] ?? ''
}

/**
 * 没单独指定时显示在输入框里的提示：实际会用哪个模型、为什么。
 * 与真正发请求时走的是同一个函数（explainModel → pickModel），不会说一套做一套。
 */
function followText(scene: (typeof AI_SCENES)[number]): string {
  // 只看「没单独指定时」会用什么，所以把这个功能自己的覆盖去掉再算
  const models = { ...props.settings.models }
  const { [scene.key]: _own, ...rest } = models[props.provider]
  models[props.provider] = rest
  const choice = explainModel(scene, props.provider, { ...props.settings, models })
  if (choice.source === 'recommended') return `内置推荐：${choice.model}`
  return choice.model ? `跟随默认：${choice.model}` : '跟随默认（还没填默认模型）'
}
</script>

<template>
  <n-collapse class="scene-models">
    <n-collapse-item title="按功能指定模型" name="scenes">
      <div
        v-for="scene in AI_SCENES"
        :key="scene.key"
        class="scene"
        :data-test="`scene-${scene.key}`"
      >
        <span class="scene__label">{{ scene.label }}</span>
        <ModelInput
          class="scene__input"
          :value="own(scene.key)"
          :options="options"
          :placeholder="followText(scene)"
          @commit="(m: string) => emit('save', scene.key, m)"
        />
        <n-button
          v-if="own(scene.key)"
          text
          type="primary"
          class="scene__reset"
          data-test="scene-reset"
          @click="emit('save', scene.key, '')"
        >
          恢复
        </n-button>
        <span v-else class="scene__reset" />
      </div>
    </n-collapse-item>
  </n-collapse>
</template>

<style scoped>
.scene-models {
  width: 100%;
  max-width: 520px;
}
.scene {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-8);
}
.scene__label {
  flex: 0 0 96px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.scene__input {
  flex: 1;
  min-width: 0;
}
.scene__reset {
  flex: 0 0 32px;
  font-size: var(--font-size-sm);
}
</style>
