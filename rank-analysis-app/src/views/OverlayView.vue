<script setup lang="ts">
/**
 * 对局内 Overlay 视图（4b overlay POC）。
 *
 * 监听主窗口推送的 "overlay:update" 事件，渲染 NextAction 建议卡片。
 * 透明背景 + 鼠标穿透由 Rust 端窗口属性控制（set_ignore_cursor_events），
 * 本组件仅负责内容渲染。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'

const actions = ref<NextAction[]>([])
const visible = ref(false)
let unlisten: UnlistenFn | null = null

onMounted(async () => {
  unlisten = await listen<NextAction[]>('overlay:update', event => {
    actions.value = event.payload
    visible.value = (event.payload?.length ?? 0) > 0
  })
})

onUnmounted(() => {
  unlisten?.()
})
</script>

<template>
  <div v-if="visible" class="overlay-container">
    <div class="overlay-card">
      <div class="overlay-header">下一动作建议</div>
      <div class="overlay-list">
        <div
          v-for="(a, i) in actions"
          :key="i"
          class="overlay-item"
          :class="`overlay-item-${a.urgency}`"
        >
          <span
            class="overlay-urgency"
            :style="{ color: URGENCY_COLORS[a.urgency] ?? 'rgba(255,255,255,0.5)' }"
            >{{ a.urgency === 'high' ? '!' : '·' }}</span
          >
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
  background: rgba(10, 10, 15, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 10px;
  backdrop-filter: blur(8px);
}

.overlay-header {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.overlay-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overlay-item {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.4;
}

.overlay-urgency {
  flex-shrink: 0;
  font-weight: 700;
  width: 12px;
}

.overlay-kind {
  font-weight: 600;
  flex-shrink: 0;
  min-width: 60px;
}

.overlay-reason {
  color: rgba(255, 255, 255, 0.55);
}
</style>
