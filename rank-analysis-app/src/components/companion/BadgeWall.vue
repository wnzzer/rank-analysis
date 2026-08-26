<script setup lang="ts">
/**
 * 徽章墙（C4）：赛后规则徽章的统一展示。
 * 金/银两档配色；hover 显示 desc。空数组整块隐藏由父层控制。
 */
import { computed } from 'vue'

import type { Badge } from '@renderer/companion/judges'

const props = defineProps<{ badges: Badge[]; compact?: boolean }>()

const sorted = computed(() =>
  [...props.badges].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'gold' ? -1 : 1))
)
</script>

<template>
  <div class="bwall" :class="{ compact }">
    <span
      v-for="b in sorted"
      :key="b.key"
      class="badge"
      :class="`badge--${b.tier}`"
      :title="b.desc"
    >
      {{ b.label }}
    </span>
  </div>
</template>

<style scoped>
.bwall {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.badge {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 2px 10px;
  border: 1px solid var(--border-strong);
  cursor: help;
}
.badge--gold {
  color: #ffd76a;
  border-color: #ffd76a88;
  background: rgba(255, 215, 106, 0.08);
}
.badge--silver {
  color: #b9c4d0;
  border-color: #b9c4d066;
}
.compact .badge {
  font-size: 10px;
  padding: 1px 6px;
}
</style>
