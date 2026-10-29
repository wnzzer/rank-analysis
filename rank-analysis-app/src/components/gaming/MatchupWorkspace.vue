<script setup lang="ts">
/** 敌方区域一级战绩/二级对位页面容器，始终保留原战绩节点和滚动。 */
import { nextTick, ref, watch } from 'vue'
import type { MatchupEnemy } from '@renderer/types/matchup'
import type { OpggTier } from '@renderer/services/opgg'
import MatchupPanel from './MatchupPanel.vue'
const props = withDefaults(
  defineProps<{
    /** 仅敌方传统峡谷选人阶段开启。 */
    enabled: boolean
    /** 本局可见敌方槽位。 */
    enemies: MatchupEnemy[]
    /** 共享统计段位。 */
    tier: OpggTier
    /** 共享段位切换状态。 */
    tierLoading?: boolean
    /** 公开的禁用/已选英雄。 */
    unavailableIds?: number[]
  }>(),
  { tierLoading: false, unavailableIds: () => [] }
)
const emit = defineEmits<{
  /** 转交父页面统一修改统计段位。 */
  (event: 'change-tier', tier: OpggTier): void
}>()
const opened = ref(false)
const selectedSlot = ref(-1)
const detail = ref<HTMLElement | null>(null)
const nav = ref<HTMLElement | null>(null)
let trigger: HTMLElement | null = null

/** 从指定槽位入口进入内页。
 * @param slot 本局敌方槽位。
 * @param event 入口点击事件，保存元素供返回恢复焦点。
 */
async function open(slot: number, event?: Event): Promise<void> {
  if (!props.enabled || !props.enemies.find(enemy => enemy.slot === slot)?.championId) return
  selectedSlot.value = slot
  if (event?.currentTarget instanceof HTMLElement) trigger = event.currentTarget
  await nextTick()
  // 首次打开先建立隐藏样式，避免挂载当帧跳过进入过渡。
  void detail.value?.offsetWidth
  opened.value = true
  await nextTick()
  detail.value?.querySelector<HTMLElement>('[data-back]')?.focus({ preventScroll: true })
}

/** 返回原列表，不重建节点；原入口已消失时聚焦导航。 */
async function back(): Promise<void> {
  opened.value = false
  await nextTick()
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  else nav.value?.focus({ preventScroll: true })
}

/** 局部 Escape 返回，输入框/下拉已有自己的 Escape 语义。
 * @param event 来自当前内页的键盘事件。
 */
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    target.closest('input,select,[role="combobox"],.n-base-selection')
  )
    return
  event.stopPropagation()
  void back()
}

watch(
  () => props.enabled,
  enabled => {
    if (!enabled) {
      opened.value = false
      selectedSlot.value = -1
      trigger = null
    }
  }
)
</script>
<template>
  <slot v-if="!enabled" :open="open"></slot>
  <div v-else class="matchup-workspace">
    <div
      v-if="enabled"
      ref="nav"
      class="workspace-nav"
      tabindex="-1"
      data-page-nav
      aria-label="敌方区域页面"
    >
      <button type="button" :aria-pressed="!opened" @click="back">玩家战绩</button>
      <button
        type="button"
        :aria-pressed="opened"
        :disabled="selectedSlot < 0"
        title="从敌方卡片选择要分析的英雄"
        @click="open(selectedSlot)"
      >
        英雄对位
      </button>
    </div>
    <div class="workspace-pages" :class="{ 'detail-open': opened }">
      <div
        class="workspace-records workspace-page"
        data-records
        :inert="opened || undefined"
        :aria-hidden="opened || undefined"
      >
        <slot :open="open"></slot>
      </div>
      <div
        v-if="enabled && selectedSlot >= 0"
        ref="detail"
        class="workspace-detail workspace-page"
        :inert="!opened || undefined"
        :aria-hidden="!opened || undefined"
        @keydown="onKeydown"
      >
        <MatchupPanel
          :enemies="enemies"
          :selected-slot="selectedSlot"
          :tier="tier"
          :tier-loading="tierLoading"
          :unavailable-ids="unavailableIds"
          :active="enabled && opened"
          @back="back"
          @select-slot="selectedSlot = $event"
          @change-tier="emit('change-tier', $event)"
        />
      </div>
    </div>
  </div>
</template>
<style scoped>
.matchup-workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  flex: 1;
  gap: var(--space-6);
}
.workspace-nav {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
}
.workspace-nav button {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  padding: var(--space-4) var(--space-8);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast);
}
.workspace-nav button[aria-pressed='true'] {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
}
.workspace-nav button:hover:not(:disabled) {
  background: var(--bg-elevated);
}
.workspace-nav button:disabled {
  opacity: 0.4;
  cursor: default;
}
.workspace-nav button:focus-visible {
  outline: 2px solid var(--semantic-win);
  outline-offset: 1px;
}
.workspace-pages {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.workspace-page {
  position: absolute;
  inset: 0;
  transition:
    opacity var(--dur-normal) var(--ease-out-expo),
    transform var(--dur-normal) var(--ease-out-expo);
}
.workspace-records {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}
.workspace-detail {
  opacity: 0;
  transform: translateX(8px);
  pointer-events: none;
}
.detail-open .workspace-records {
  opacity: 0;
  transform: translateX(-8px);
  pointer-events: none;
}
.detail-open .workspace-detail {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
@media (prefers-reduced-motion: reduce) {
  .workspace-page,
  .workspace-nav button {
    transition: none;
  }
}
</style>
