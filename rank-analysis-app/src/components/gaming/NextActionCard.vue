<template>
  <div v-if="actions.length > 0" class="next-action-card">
    <div
      v-for="(action, i) in actions"
      :key="i"
      class="next-action-item"
      :class="`next-action-${action.urgency}`"
    >
      <div class="na-left">
        <span class="na-kind">{{ labelOf(action.kind) }}</span>
        <span class="na-urgency" :style="{ color: URGENCY_COLORS[action.urgency] }">
          {{ urgencyLabel(action.urgency) }}
        </span>
      </div>
      <div class="na-reason">{{ action.reason }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'

defineProps<{
  actions: NextAction[]
}>()

function labelOf(kind: string): string {
  return NEXT_ACTION_LABELS[kind] ?? kind
}

function urgencyLabel(u: string): string {
  return u === 'high' ? '立即' : u === 'medium' ? '建议' : '参考'
}
</script>

<style scoped>
.next-action-card {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.next-action-item {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--glass-bg-mid);
  border-left: 3px solid transparent;
  font-size: 12px;
}

.next-action-high {
  border-left-color: #e65454;
}

.next-action-medium {
  border-left-color: #e6a854;
}

.next-action-low {
  border-left-color: #54a8e6;
}

.na-left {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.na-kind {
  font-weight: 600;
  color: var(--text-primary);
}

.na-urgency {
  font-size: 11px;
}

.na-reason {
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
