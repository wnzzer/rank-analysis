<script setup lang="ts" generic="T extends string">
/**
 * 轻量分段切换：浅轨道 + 选中项微抬起，文字层级区分，不用主色实心填充。
 *
 * 替代 n-radio-group 按钮式：主色实心块在卡片区里过重（选人页敌方区、对位内页都踩过）。
 * 语义为 radiogroup，键盘可 Tab 到各项、Enter/Space 选中。
 */

/**
 * 一个选项
 * @property disabled - 不可选（如前置条件未满足）
 * @property title - 悬停提示（常用于说明禁用原因）
 */
interface SegmentedOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
  title?: string
}

defineProps<{
  /** 当前选中值 */
  value: T
  options: SegmentedOption<T>[]
  /** 读屏用的分组名 */
  ariaLabel: string
}>()

const emit = defineEmits<{
  /** 选中另一项时触发；点当前项不触发 */
  (event: 'update:value', value: T): void
}>()
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      class="segmented-item"
      :class="{ active: opt.value === value }"
      :aria-checked="opt.value === value"
      :disabled="opt.disabled"
      :title="opt.title"
      :data-segment="opt.value"
      @click="opt.value !== value && emit('update:value', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-group);
  border: 1px solid var(--border-subtle);
}
.segmented-item {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: var(--font-size-sm);
  line-height: 1;
  padding: 5px 10px;
  border-radius: calc(var(--radius-sm) - 2px);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}
.segmented-item:hover:not(:disabled):not(.active) {
  color: var(--text-secondary);
}
.segmented-item.active {
  color: var(--text-primary);
  font-weight: var(--font-weight-medium, 500);
  /* 深色：面板与 --bg-elevated 几乎同色，用半透明白抬起；浅色见下方覆盖 */
  background: rgba(255, 255, 255, 0.09);
  box-shadow: var(--shadow-card);
  cursor: default;
}
:global(.theme-light) .segmented-item.active {
  background: var(--bg-elevated);
}
.segmented-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.segmented-item:focus-visible {
  outline: 1px solid var(--accent-hover);
  outline-offset: 1px;
}
</style>
