<script setup lang="ts">
import { computed } from 'vue'
import { NSelect, NButton } from 'naive-ui'
import {
  type RuleCondition,
  type Position,
  CONDITION_TYPE_LABEL,
  POSITION_LABEL
} from '@renderer/types/rules'
import type { championOption } from '@renderer/types/domain/champion'
import { filterChampionFunc, renderLabel } from '@renderer/utils/champion'

const props = defineProps<{
  modelValue: RuleCondition
  championOptions: championOption[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: RuleCondition): void
  (e: 'remove'): void
}>()

const typeOptions = (Object.keys(CONDITION_TYPE_LABEL) as Array<RuleCondition['type']>).map(t => ({
  label: CONDITION_TYPE_LABEL[t],
  value: t
}))

const positionOptions = (Object.keys(POSITION_LABEL) as Array<keyof typeof POSITION_LABEL>).map(
  p => ({ label: POSITION_LABEL[p], value: p })
)

const currentType = computed(() => props.modelValue.type)

function setType(next: RuleCondition['type']) {
  if (next === 'Position') {
    emit('update:modelValue', { type: 'Position', value: 'middle' })
  } else {
    // Preserve ids if switching between two ids-carrying variants
    const ids = props.modelValue.type === 'Position' ? [] : props.modelValue.ids
    emit('update:modelValue', { type: next, ids } as RuleCondition)
  }
}

function setPosition(value: Position) {
  emit('update:modelValue', { type: 'Position', value })
}

function setIds(ids: number[]) {
  if (props.modelValue.type === 'Position') return
  emit('update:modelValue', { ...props.modelValue, ids })
}
</script>

<template>
  <div class="rule-condition-row">
    <n-select
      :value="currentType"
      :options="typeOptions"
      style="width: 180px"
      @update:value="setType"
    />

    <n-select
      v-if="modelValue.type === 'Position'"
      :value="modelValue.value"
      :options="positionOptions"
      style="width: 120px"
      @update:value="setPosition"
    />

    <n-select
      v-else
      multiple
      filterable
      :filter="filterChampionFunc"
      :render-label="renderLabel"
      :value="modelValue.ids"
      :options="championOptions as any"
      placeholder="选择英雄"
      style="flex: 1; min-width: 200px"
      @update:value="setIds"
    />

    <n-button quaternary type="error" @click="emit('remove')">删除</n-button>
  </div>
</template>

<style scoped>
.rule-condition-row {
  display: flex;
  gap: var(--space-8);
  align-items: center;
  margin-bottom: var(--space-8);
}
</style>
