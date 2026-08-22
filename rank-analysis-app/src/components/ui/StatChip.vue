<template>
  <span class="statc">
    <span v-if="label" class="statc__l">{{ label }}</span>
    <span class="statc__v num" :class="'statc__v--' + tone">{{ value }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * StatChip —— 数值芯片（设计系统 v3 §7.6）
 * label + 数值的原子展示；数字强制走 --font-num。
 * 胜负数据必须用 win/loss tone，禁止借用 brand 表达胜负（不变式 1）。
 */
withDefaults(
  defineProps<{
    /** 小标签，如 "近20场" */
    label?: string
    /** 数值文本 */
    value: string | number
    /** 语义色调 */
    tone?: 'neutral' | 'win' | 'loss' | 'brand' | 'info'
  }>(),
  { label: '', tone: 'neutral' }
)
</script>

<style scoped>
.statc {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-6);
}
.statc__l {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.statc__v {
  font-family: var(--font-num);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.statc__v--win {
  color: var(--win);
}
.statc__v--loss {
  color: var(--loss);
}
.statc__v--brand {
  color: var(--brand);
}
.statc__v--info {
  color: var(--info);
}
</style>
