<template>
  <div class="lane-filter" aria-label="按分路筛选英雄">
    <span class="lane-filter__label">战术坐标</span>
    <div ref="laneTrack" class="lane-filter__track" role="toolbar" aria-label="英雄分路">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        class="lane-filter__chip"
        :class="{ 'lane-filter__chip--active': modelValue === option.value }"
        :aria-pressed="modelValue === option.value"
        :title="`${option.label}英雄`"
        @click="$emit('update:modelValue', option.value)"
        @keydown="onKeydown($event, index)"
      >
        <span class="lane-filter__glyph" aria-hidden="true">
          <i :class="`lane-filter__route--${option.value}`" />
        </span>
        <span>{{ option.label }}</span>
        <small>{{ option.code }}</small>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ChampionLane } from '@renderer/types/domain/championCollection'

type LaneFilter = ChampionLane | 'all'

defineProps<{
  modelValue: LaneFilter
}>()

const emit = defineEmits<{
  'update:modelValue': [value: LaneFilter]
}>()

const laneTrack = ref<HTMLElement | null>(null)

const options: ReadonlyArray<{ value: LaneFilter; label: string; code: string }> = [
  { value: 'all', label: '全部', code: 'ALL' },
  { value: 'top', label: '上路', code: 'TOP' },
  { value: 'jungle', label: '打野', code: 'JGL' },
  { value: 'middle', label: '中路', code: 'MID' },
  { value: 'bottom', label: '下路', code: 'BOT' },
  { value: 'support', label: '辅助', code: 'SUP' }
]

function onKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()

  let nextIndex = index
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = options.length - 1
  if (event.key === 'ArrowLeft') nextIndex = (index - 1 + options.length) % options.length
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % options.length

  const buttons = laneTrack.value?.querySelectorAll<HTMLButtonElement>('button')
  buttons?.[nextIndex]?.focus()
  emit('update:modelValue', options[nextIndex].value)
}
</script>

<style scoped>
.lane-filter {
  --tactics-ink: #0b0e11;
  --tactics-panel: #12171c;
  --tactics-line: rgba(171, 184, 193, 0.18);
  --tactics-muted: #75818a;
  --tactics-text: #d9e0e4;
  --tactics-accent: #c7a86b;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.lane-filter__label {
  flex: 0 0 auto;
  color: var(--tactics-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.lane-filter__track {
  display: flex;
  min-width: 0;
  gap: 5px;
  overflow-x: auto;
  padding: 3px;
  border: 1px solid var(--tactics-line);
  border-radius: 10px;
  background:
    linear-gradient(90deg, rgba(199, 168, 107, 0.035) 1px, transparent 1px) 0 0 / 22px 100%,
    var(--tactics-ink);
  scrollbar-width: none;
}

.lane-filter__track::-webkit-scrollbar {
  display: none;
}

.lane-filter__chip {
  position: relative;
  display: grid;
  grid-template-columns: 22px auto;
  grid-template-rows: auto auto;
  flex: 0 0 auto;
  min-width: 76px;
  padding: 7px 10px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--tactics-muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.05;
  text-align: left;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.lane-filter__chip:hover {
  border-color: var(--tactics-line);
  color: var(--tactics-text);
  transform: translateY(-1px);
}

.lane-filter__chip:focus-visible {
  outline: 2px solid var(--tactics-accent);
  outline-offset: 2px;
}

.lane-filter__chip--active {
  border-color: color-mix(in srgb, var(--tactics-accent) 48%, transparent);
  background: linear-gradient(135deg, rgba(199, 168, 107, 0.16), rgba(199, 168, 107, 0.04));
  color: var(--tactics-text);
  box-shadow: inset 2px 0 var(--tactics-accent);
}

.lane-filter__chip small {
  grid-column: 2;
  color: var(--tactics-muted);
  font-size: 8px;
  letter-spacing: 0.12em;
}

.lane-filter__glyph {
  position: relative;
  grid-row: 1 / 3;
  width: 14px;
  height: 14px;
  align-self: center;
  border: 1px solid currentColor;
  opacity: 0.72;
  transform: rotate(45deg);
}

.lane-filter__glyph i {
  position: absolute;
  display: block;
  background: currentColor;
}

.lane-filter__route--all {
  inset: 3px;
}

.lane-filter__route--top {
  top: 1px;
  left: 2px;
  width: 2px;
  height: 9px;
}

.lane-filter__route--jungle {
  top: 3px;
  left: 5px;
  width: 2px;
  height: 7px;
  transform: rotate(28deg);
}

.lane-filter__route--middle {
  top: 5px;
  left: 1px;
  width: 10px;
  height: 2px;
}

.lane-filter__route--bottom,
.lane-filter__route--support {
  right: 2px;
  bottom: 1px;
  width: 2px;
  height: 9px;
}

.lane-filter__route--support::after {
  position: absolute;
  right: 3px;
  bottom: 0;
  width: 3px;
  height: 3px;
  border: 1px solid currentColor;
  content: '';
}

@media (max-width: 720px) {
  .lane-filter {
    display: block;
  }

  .lane-filter__label {
    display: block;
    margin-bottom: 6px;
  }
}
</style>
