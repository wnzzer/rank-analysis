<template>
  <div class="match-detail-window-page">
    <div class="match-detail-window-bar" data-tauri-drag-region>
      <div class="match-detail-window-title">对局详情</div>
      <div class="match-detail-window-actions">
        <Transition name="zoom-badge">
          <span v-if="zoomBadge" class="match-detail-zoom-badge font-number">{{ zoomBadge }}</span>
        </Transition>
        <button class="match-detail-window-close" type="button" @click="closeWindow">关闭</button>
      </div>
    </div>
    <!-- 可用区不缩放、负责横向溢出滚动；缩放容器按设计宽排版并挂 CSS zoom（useDetailZoom） -->
    <div ref="area" class="match-detail-window-body">
      <div
        ref="container"
        class="match-detail-window-inner"
        :style="{ width: `${DETAIL_DESIGN_WIDTH}px` }"
      >
        <MatchDetailModal ref="modal" :game="game" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import MatchDetailModal from '../components/record/MatchDetailModal.vue'
import type { Game } from '../components/record/match'
import { isMatchDetailWindow, revealCurrentDetailWindow } from '../components/record/detailWindow'
import { DETAIL_DESIGN_WIDTH, useDetailZoom } from '../composables/useDetailZoom'

/** 首屏数据（「我」是谁）等待上限：LCU 慢时不因此一直不亮窗 */
const FIRST_DATA_WAIT_MS = 800

const route = useRoute()
const game = ref<Game | null>(null)
const currentWindow = getCurrentWindow()
const modal = ref<InstanceType<typeof MatchDetailModal> | null>(null)
const area = ref<HTMLElement | null>(null)
const container = ref<HTMLElement | null>(null)
const { badge: zoomBadge, recompute, loadSavedFactor } = useDetailZoom({ area, container })

function getStorageKeyFromWindowLabel() {
  if (!currentWindow.label.startsWith('match-detail-')) {
    return undefined
  }

  return currentWindow.label.replace('match-detail-', 'match-detail:')
}

function readGameFromStorage(storageKey?: string | null) {
  if (!storageKey) {
    game.value = null
    return
  }

  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    game.value = null
    return
  }

  try {
    game.value = JSON.parse(raw) as Game
  } catch (error) {
    console.error('Failed to parse match detail payload:', error)
    game.value = null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 首帧即最终态：读对局 → 恢复倍率 → 等首屏数据 → 算缩放 → 字体就绪后按终稿再量一次 → 亮窗。
 * 窗口此前一直隐藏（detailWindow.ts visible:false），中间态用户看不到。
 * 不等 requestAnimationFrame：隐藏的 WebView 可能暂停 rAF。
 */
onMounted(async () => {
  const storageKey =
    (route.query.storageKey as string | undefined) ?? getStorageKeyFromWindowLabel()
  readGameFromStorage(storageKey)
  await loadSavedFactor()
  await nextTick()
  await Promise.race([modal.value?.whenReady(), delay(FIRST_DATA_WAIT_MS)])
  await nextTick()
  recompute()
  // 字体到位后文本度量才是终稿（document.fonts 在测试环境可能缺失）
  await document.fonts?.ready
  recompute()
  if (isMatchDetailWindow()) await revealCurrentDetailWindow()
})

function closeWindow() {
  currentWindow.close()
}
</script>

<style scoped>
.match-detail-window-page {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  /* 固定字阶：内容按 DETAIL_DESIGN_WIDTH(1280) 设计宽排版，整体缩放交给 useDetailZoom 的
     CSS zoom。取值 = 旧 clamp(100vw) 公式在 1280 宽下的结果取整到 0.5px——默认窗口观感与改前一致 */
  --font-size-2xs: 10.5px;
  --font-size-xs: 11.5px;
  --font-size-sm: 12.5px;
  --font-size-base: 13.5px;
  --font-size-md: 14.5px;
  --font-size-lg: 16.5px;
  --font-size-xl: 19px;
}

.match-detail-window-bar {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: 0 var(--space-6) 0 var(--space-10);
  box-sizing: border-box;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-win) 12%, var(--bg-surface)),
      var(--bg-surface)
    ),
    var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  -webkit-app-region: drag;
}

.match-detail-window-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.match-detail-window-close {
  height: 20px;
  padding: 0 var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text-primary);
  font-size: 10px;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
  -webkit-app-region: no-drag;
}

.match-detail-window-close:hover {
  background: color-mix(in srgb, var(--semantic-loss) 18%, transparent);
  border-color: color-mix(in srgb, var(--semantic-loss) 35%, var(--border-subtle));
}

.theme-light .match-detail-window-bar {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--semantic-win) 10%, var(--bg-surface)),
      var(--bg-surface)
    ),
    var(--bg-surface);
}

/* 可用区：未溢出时内容居中；Ctrl+滚轮放大超出窗口时 safe center 仍能滚到左缘。
   纵向滚动由 MatchDetailModal 的队伍区负责（缩放容器视觉高已钉成可用高） */
.match-detail-window-body {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: safe center;
  align-items: flex-start;
  overflow-x: auto;
  overflow-y: hidden;
}

.match-detail-window-inner {
  flex: 0 0 auto;
}

.match-detail-window-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

/* Ctrl+滚轮倍率提示（浏览器同款），1.2s 后淡出 */
.match-detail-zoom-badge {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 0 var(--space-6);
  border-radius: var(--radius-pill);
  background: var(--glass-bg-high);
}

.zoom-badge-enter-active,
.zoom-badge-leave-active {
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.zoom-badge-enter-from,
.zoom-badge-leave-to {
  opacity: 0;
}
</style>
