<template>
  <div class="match-detail-window-page">
    <div class="match-detail-window-bar">
      <div class="match-detail-window-title">对局详情</div>
      <button class="match-detail-window-close" type="button" @click="closeWindow">关闭</button>
    </div>
    <div class="match-detail-window-body">
      <div class="match-detail-window-inner">
        <MatchDetailModal :game="game" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import MatchDetailModal from '../components/record/MatchDetailModal.vue'
import type { Game } from '../components/record/match'

const route = useRoute()
const game = ref<Game | null>(null)
const currentWindow = getCurrentWindow()

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

onMounted(async () => {
  const storageKey =
    (route.query.storageKey as string | undefined) ?? getStorageKeyFromWindowLabel()
  readGameFromStorage(storageKey)
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
  /* 整页 font-size token override: 子组件用 var(--font-size-*) 自动随 viewport 缩放 (1100→2200) */
  --font-size-2xs: clamp(10px, calc(10px + (100vw - 1100px) * 2 / 1100), 12px);
  --font-size-xs: clamp(11px, calc(11px + (100vw - 1100px) * 2 / 1100), 13px);
  --font-size-sm: clamp(12px, calc(12px + (100vw - 1100px) * 2 / 1100), 14px);
  --font-size-base: clamp(13px, calc(13px + (100vw - 1100px) * 3 / 1100), 16px);
  --font-size-md: clamp(14px, calc(14px + (100vw - 1100px) * 4 / 1100), 18px);
  --font-size-lg: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  --font-size-xl: clamp(18px, calc(18px + (100vw - 1100px) * 5 / 1100), 23px);
}

/* 宽屏时内容居中：版心上限 1360，多余宽度变成对称留白——
   避免弹性列把空间吐在表格中部形成大片死空间（松散、不成版心） */
.match-detail-window-inner {
  max-width: 1360px;
  margin: 0 auto;
  height: 100%;
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

.match-detail-window-body {
  flex: 1;
  min-height: 0;
}
</style>
