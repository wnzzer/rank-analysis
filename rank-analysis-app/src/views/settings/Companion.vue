<template>
  <div class="companion">
    <CornerCard title="AI 搭子">
      <n-space vertical :size="12" style="width: 100%">
        <n-space align="center" :size="12">
          <span class="lbl">当前人设</span>
          <n-select
            v-model:value="activeId"
            size="tiny"
            style="width: 200px"
            :options="personaOptions"
            @update:value="onSwitch"
          />
          <n-button size="tiny" quaternary @click="onTestSpeak">试说一句</n-button>
        </n-space>

        <n-form-item label="性格设定" :show-feedback="false">
          <n-input
            v-model:value="draft.persona"
            type="textarea"
            size="small"
            :rows="2"
            placeholder="一句话描述 TA 的性格（注入 LLM 润色 prompt）"
          />
        </n-form-item>

        <n-form-item label="语气规则" :show-feedback="false">
          <n-input
            v-model:value="toneRulesText"
            type="textarea"
            size="small"
            :rows="2"
            placeholder="每行一条，如「每句不超过 18 字」"
          />
        </n-form-item>

        <n-form-item label="记忆条数" :show-feedback="false">
          <n-input-number v-model:value="draft.memoryTurns" size="tiny" :min="0" :max="20" />
        </n-form-item>

        <div>
          <n-text depth="2" style="font-size: var(--font-size-sm)">触发器</n-text>
          <n-space :size="16" style="margin-top: 6px">
            <label v-for="t in TRIGGER_ITEMS" :key="t.key" class="trg">
              <n-switch
                size="small"
                :value="triggerEnabled(draft, t.key)"
                @update:value="(v: boolean) => (draft.triggers[t.key] = v)"
              />
              {{ t.label }}
            </label>
          </n-space>
        </div>

        <n-space :size="8">
          <n-button size="tiny" type="primary" @click="onSave">保存为我的版本</n-button>
          <n-button v-if="isCustom" size="tiny" quaternary type="error" @click="onDelete">
            删除此副本
          </n-button>
        </n-space>

        <n-text :depth="3" style="font-size: var(--font-size-xs)">
          台词两级生成：模板即时响应（离线可用），可选 LLM 异步润色（走常规 AI 服务商配置，
          下轮接入）。内置人设只读——保存会生成你的专属副本。
        </n-text>

        <n-text v-if="previewLine" depth="1" style="font-size: var(--font-size-sm)">
          「{{ previewLine }}」
        </n-text>
      </n-space>
    </CornerCard>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 搭子设置（feature-expansion-plan C1）
 * 人设选择/编辑（内置自动转副本）/触发器开关/试说。
 * 与 Gaming 页事件流的实时接线在 C2 后续轮次接入。
 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'

import CornerCard from '@renderer/components/ui/CornerCard.vue'
import {
  BUILT_IN_PERSONAS,
  getActivePersonaId,
  getPersona,
  listPersonas,
  setActivePersonaId,
  triggerEnabled,
  upsertPersona,
  deletePersona,
  type CompanionPersona,
  type CompanionTriggerKey
} from '@renderer/companion/persona'
import { createSpeaker, type CompanionEvent } from '@renderer/companion/engine'

const TRIGGER_ITEMS: Array<{ key: CompanionTriggerKey; label: string }> = [
  { key: 'kill', label: '击杀' },
  { key: 'multikill', label: '多杀' },
  { key: 'death', label: '阵亡' },
  { key: 'ace', label: '团灭' },
  { key: 'augmentPick', label: '强化选择' },
  { key: 'victory', label: '胜利' },
  { key: 'defeat', label: '失败' },
  { key: 'lossStreak', label: '连败关怀' }
]

const message = useMessage()

const activeId = ref(getActivePersonaId())
const draft = ref<CompanionPersona>(JSON.parse(JSON.stringify(getPersona(activeId.value))))
const previewLine = ref('')

const isCustom = computed(() => !BUILT_IN_PERSONAS.some(p => p.id === draft.value.id))

watch(activeId, id => {
  draft.value = JSON.parse(JSON.stringify(getPersona(id)))
})

function reloadDraft() {
  draft.value = JSON.parse(JSON.stringify(getPersona(activeId.value)))
}

const toneRulesText = computed({
  get: () => draft.value.toneRules.join('\n'),
  set: (v: string) => {
    draft.value.toneRules = v
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  }
})

const personaOptions = computed(() => listPersonas().map(p => ({ label: p.name, value: p.id })))

function onSwitch() {
  setActivePersonaId(activeId.value)
  reloadDraft()
}

function onSave() {
  const savedId = upsertPersona({ ...draft.value })
  activeId.value = savedId
  setActivePersonaId(savedId)
  reloadDraft()
  message.success(`已保存人设「${getPersona(savedId).name}」`)
}

function onDelete() {
  if (!isCustom.value) return
  deletePersona(draft.value.id)
  activeId.value = BUILT_IN_PERSONAS[0]?.id ?? ''
  setActivePersonaId(activeId.value)
  reloadDraft()
  message.success('副本已删除')
}

/** 试说：按当前草稿生成一条强化选择的台词（纯模板，不调 LLM） */
async function onTestSpeak() {
  const speaker = createSpeaker({ ...draft.value })
  const sample: CompanionEvent = {
    type: 'augmentPick',
    at: Date.now(),
    augmentName: '双刀流',
    championName: '薇恩'
  }
  const line = await speaker.onEvent(sample)
  previewLine.value = line?.text ?? '该触发器已关闭或无可用模板'
}
</script>

<style scoped>
.companion {
  max-width: 720px;
}
.lbl {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.trg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
</style>
