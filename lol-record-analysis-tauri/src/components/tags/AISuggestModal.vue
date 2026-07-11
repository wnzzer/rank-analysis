<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { NModal, NCard, NButton, NSpace, NText, NTag, NEmpty, NSpin } from 'naive-ui'
import {
  requestTagSuggestions,
  markAdopted,
  type TagSuggestOutcome
} from '@renderer/services/ai/tagSuggest'
import type { TagSuggestion, TagConfig } from '@renderer/types/tagSuggest'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'adopted'): void // tells Tags.vue to refresh its list
}>()

const loading = ref(false)
const outcome = ref<TagSuggestOutcome | null>(null)
const adoptingIds = ref<Set<string>>(new Set())

async function load(forceRefresh = false) {
  loading.value = true
  try {
    outcome.value = await requestTagSuggestions(forceRefresh)
  } catch (e) {
    outcome.value = { kind: 'aiError', error: (e as Error).message }
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  isShown => {
    if (isShown && outcome.value === null) {
      void load(false)
    }
  },
  { immediate: true }
)

const sections = computed(() => {
  if (outcome.value?.kind !== 'ok') return []
  return [
    {
      title: '好标签（赢局共同点）',
      items: outcome.value.result.good,
      tagType: 'success' as const,
      emptyText: '无（最近没有赢局）'
    },
    {
      title: '坏标签（输局共同点）',
      items: outcome.value.result.bad,
      tagType: 'error' as const,
      emptyText: '无（最近没有输局）'
    }
  ]
})

async function adopt(s: TagSuggestion) {
  if (adoptingIds.value.has(s.id)) return
  if (outcome.value?.kind !== 'ok') return // defensive
  const puuid = outcome.value.puuid

  adoptingIds.value.add(s.id)
  try {
    const existing = await invoke<TagConfig[]>('get_all_tag_configs')
    // Strip adopted marker before saving
    const { adopted: _adopted, ...clean } = s
    await invoke('save_tag_configs', { configs: [...existing, clean] })
    markAdopted(puuid, s.id)

    // Reflect adopted state in current view
    if (outcome.value?.kind === 'ok') {
      const tagged = outcome.value.result.good.find(x => x.id === s.id)
      if (tagged) tagged.adopted = true
      const tagged2 = outcome.value.result.bad.find(x => x.id === s.id)
      if (tagged2) tagged2.adopted = true
    }
    emit('adopted')
  } catch (e) {
    console.error('采用标签失败', e)
  } finally {
    adoptingIds.value.delete(s.id)
  }
}

function close() {
  emit('update:show', false)
}
</script>

<template>
  <n-modal :show="show" @update:show="close">
    <n-card style="width: 720px; max-height: 80vh; overflow: auto" title="AI 看了你最近 20 把">
      <template #header-extra>
        <n-button size="small" :loading="loading" @click="load(true)">🔄 重新生成</n-button>
      </template>

      <div v-if="loading" style="padding: 40px; text-align: center">
        <n-spin />
        <div style="margin-top: var(--space-12); color: var(--n-text-color-disabled)">
          AI 分析中（约 5-10s）
        </div>
      </div>

      <div v-else-if="outcome?.kind === 'insufficient'">
        <n-empty :description="`近期对局太少（${outcome.gameCount} 局），打几局再来`" />
      </div>

      <div v-else-if="outcome?.kind === 'aiError'">
        <n-empty description="AI 暂时不可用">
          <template #extra>
            <n-button @click="load(true)">重试</n-button>
            <n-text
              depth="3"
              style="display: block; margin-top: var(--space-8); font-size: var(--font-size-sm)"
            >
              {{ outcome.error }}
            </n-text>
          </template>
        </n-empty>
      </div>

      <div v-else-if="outcome?.kind === 'parseError'">
        <n-empty description="AI 输出格式异常，点重新生成">
          <template #extra>
            <n-button @click="load(true)">重新生成</n-button>
          </template>
        </n-empty>
      </div>

      <div v-else-if="outcome?.kind === 'ok'">
        <n-text
          v-if="outcome.result.droppedCount > 0"
          depth="3"
          style="font-size: var(--font-size-sm)"
        >
          AI 产出
          {{ outcome.result.good.length + outcome.result.bad.length + outcome.result.droppedCount }}
          条建议，{{ outcome.result.droppedCount }} 条无效已过滤
        </n-text>

        <div v-if="outcome.result.good.length === 0 && outcome.result.bad.length === 0">
          <n-empty description="这次没产出有效建议">
            <template #extra>
              <n-button @click="load(true)">重新生成</n-button>
            </template>
          </n-empty>
        </div>

        <template v-else>
          <template v-for="section in sections" :key="section.title">
            <div class="section-title" :style="{ marginTop: 'var(--space-16)' }">
              {{ section.title }}
            </div>
            <n-space v-if="section.items.length > 0">
              <n-card
                v-for="s in section.items"
                :key="s.id"
                size="small"
                style="width: 220px"
                :style="s.adopted ? 'opacity: 0.5' : ''"
              >
                <n-tag :type="section.tagType" size="small" round>{{ s.name }}</n-tag>
                <div
                  style="
                    margin-top: var(--space-8);
                    font-size: var(--font-size-sm);
                    color: var(--n-text-color-2);
                  "
                >
                  {{ s.desc }}
                </div>
                <n-button
                  size="small"
                  type="primary"
                  style="margin-top: var(--space-8); width: 100%"
                  :disabled="s.adopted || adoptingIds.has(s.id)"
                  :loading="adoptingIds.has(s.id)"
                  @click="adopt(s)"
                >
                  {{ s.adopted ? '已采用' : '采用' }}
                </n-button>
              </n-card>
            </n-space>
            <div v-else style="color: var(--n-text-color-disabled); font-size: var(--font-size-sm)">
              {{ section.emptyText }}
            </div>
          </template>
        </template>
      </div>
    </n-card>
  </n-modal>
</template>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: var(--space-8);
}
</style>
