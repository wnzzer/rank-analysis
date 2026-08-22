<script setup lang="ts">
/**
 * 对局内 Overlay 视图（v3 §C7：同语言重绘 + 可配置）。
 *
 * 监听主窗口推送的 "overlay:update" 渲染 NextAction 建议卡；
 * "overlay:config" 可选推送 { maxItems, opacity } 覆盖本地偏好。
 * 透明背景 + 鼠标穿透由 Rust 端窗口属性控制（set_ignore_cursor_events）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'
import { loadOverlayPrefs, saveOverlayPrefs, type OverlayPrefs } from '@renderer/utils/overlayPrefs'

const actions = ref<NextAction[]>([])
const visible = ref(false)
const prefs = ref<OverlayPrefs>(loadOverlayPrefs())

const shown = computed(() => actions.value.slice(0, prefs.value.maxItems))
const cardStyle = computed(() => ({ opacity: String(prefs.value.opacity) }))

let unlistenUpdate: UnlistenFn | null = null
let unlistenConfig: UnlistenFn | null = null

onMounted(async () => {
  // listen 失败（如 capability 缺失被 ACL 拒绝）不能让 Promise 悬空成
  // unhandled rejection：记日志并保持 UI 可用（后续轮询推送仍会重试投递）。
  try {
    unlistenUpdate = await listen<NextAction[]>('overlay:update', event => {
      actions.value = Array.isArray(event.payload) ? event.payload : []
      visible.value = actions.value.length > 0
    })
    unlistenConfig = await listen<Partial<OverlayPrefs>>('overlay:config', event => {
      const merged = { ...prefs.value, ...(event.payload ?? {}) }
      prefs.value = { ...merged }
      saveOverlayPrefs(prefs.value)
    })
  } catch (e) {
    console.warn('overlay event listen failed:', e)
  }
})

onUnmounted(() => {
  unlistenUpdate?.()
  unlistenConfig?.()
})
</script>

<template>
  <div v-if="visible" class="overlay-container">
    <div class="overlay-card" :style="cardStyle">
      <div class="overlay-header">下一动作建议</div>
      <div class="overlay-list">
        <div
          v-for="(a, i) in shown"
          :key="i"
          class="overlay-item"
          :class="`overlay-item-${a.urgency}`"
        >
          <span
            class="overlay-urgency"
            :style="{ color: URGENCY_COLORS[a.urgency] ?? 'var(--text-tertiary)' }"
          >
            {{ a.urgency === 'high' ? '!' : '·' }}
          </span>
          <span class="overlay-kind">{{ NEXT_ACTION_LABELS[a.kind] ?? a.kind }}</span>
          <span class="overlay-reason">{{ a.reason }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 全局透明背景：Rust 端 transparent:true + CSS 透明 */
html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

#overlay-app {
  background: transparent;
}
</style>

<style scoped>
.overlay-container {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  max-height: 100vh;
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
  pointer-events: none;
}

.overlay-card {
  background: var(--bg-raised);
  border: 1px solid var(--brand-border);
  clip-path: var(--clip-corner-md);
  padding: 12px;
  backdrop-filter: blur(8px);
}

.overlay-header {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: 8px;
}

.overlay-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overlay-item {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.4;
}

.overlay-urgency {
  flex-shrink: 0;
  font-weight: var(--font-weight-bold);
  width: 12px;
}

.overlay-kind {
  font-weight: var(--font-weight-semibold);
  flex-shrink: 0;
  min-width: 60px;
  color: var(--text-secondary);
}

.overlay-reason {
  color: var(--text-tertiary);
}
</style>
