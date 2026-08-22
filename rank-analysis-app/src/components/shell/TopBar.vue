<template>
  <header class="tbar" data-tauri-drag-region>
    <div class="tbar__left" data-tauri-drag-region>
      <span class="tbar__title">{{ title }}</span>
    </div>

    <div class="tbar__spacer" data-tauri-drag-region></div>

    <div class="tbar__right">
      <button class="tb-search nodrag" @click="$emit('openPalette')">
        <span>⌕ 搜索</span>
        <KeyHint keys="Ctrl K" />
      </button>

      <Transition name="pill">
        <button
          v-if="availableUpdate"
          class="update-pill nodrag"
          :title="`发现新版本 v${availableUpdate.version}，点击立即更新`"
          @click="onUpdateClick"
        >
          ↑ 新版 v{{ availableUpdate.version }}
        </button>
      </Transition>

      <button
        class="tb-ico nodrag"
        :title="isDark ? '切换到亮色主题' : '切换到暗色主题'"
        :aria-label="isDark ? '切换到亮色主题' : '切换到暗色主题'"
        @click="settingsStore.toggleTheme()"
      >
        {{ isDark ? '☀' : '☾' }}
      </button>

      <span class="tb-divider nodrag"></span>

      <div class="winb nodrag">
        <button aria-label="最小化" @click="controls.minimize()">─</button>
        <button aria-label="最大化/还原" @click="controls.toggleMaximize()">□</button>
        <button class="x" aria-label="关闭" @click="controls.close()">✕</button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * TopBar —— 新壳层顶栏（设计系统 v3 §4.1）
 *
 * 三段式：左=页面上下文（可拖拽）/ 中=弹性拖拽区 / 右=动作区。
 * 与旧 Header 的差异：
 * - 主题切换从 switch 改为 icon-button（动作语义）；
 * - 「关闭游戏」危险动作移入 NavRail 状态舱，不再常驻顶栏；
 * - 窗控按钮纯变色，无 scale 动画（Windows 原生手感）；
 * - 更新药丸沿用 useAppUpdate 单例状态。
 */
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '../../composables/useTheme'
import { useSettingsStore } from '../../features/settings/stores/setting'
import { useAppUpdate } from '../../composables/useAppUpdate'
import { lcuConnected } from '../../composables/useGameState'
import { GATE_SETTLE_MS, GATE_FALLBACK_MS } from '../../composables/useStartupDialogs'
import { useWindowControls } from '../../composables/useWindowControls'
import { isMainWindow } from '../../utils/windows'
import KeyHint from '../ui/KeyHint.vue'

defineEmits<{ openPalette: [] }>()

const route = useRoute()
const settingsStore = useSettingsStore()
const { isDark } = useTheme()
const controls = useWindowControls()

/** availableUpdate 是模块级单例状态：启动静默检查与手动检查共用同一份 */
const { availableUpdate, showUpdateDialog, checkForUpdates } = useAppUpdate()

const updateBusy = ref(false)
function onUpdateClick() {
  const u = availableUpdate.value
  if (!u || updateBusy.value) return
  updateBusy.value = true
  try {
    // 药丸本身就是"已发现更新"的信号：直接弹确认框，不再联网查询
    showUpdateDialog(u)
  } finally {
    updateBusy.value = false
  }
}

/**
 * 启动静默更新检查（自旧 Header 平移——v2 壳层不再挂载旧 Header）。
 * 等 LCU 连接建立后沉淀一小段再查；一直连不上则兜底超时触发。
 *
 * 仅主窗口执行：record-* 子窗口同样挂载 TopBar，不拦截会 N 窗并发打
 * updater endpoint，且更新确认框/relaunch 可能从子窗口发起。
 */
function scheduleSilentUpdateCheck(): void {
  if (!isMainWindow()) return
  let scheduled = false
  function fire(): void {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => {
      void checkForUpdates('silent')
    }, GATE_SETTLE_MS)
  }
  if (lcuConnected.value) {
    fire()
    return
  }
  const stop = watch(lcuConnected, connected => {
    if (connected) {
      stop()
      fire()
    }
  })
  window.setTimeout(() => {
    stop()
    fire()
  }, GATE_FALLBACK_MS)
}
onMounted(() => {
  scheduleSilentUpdateCheck()
})

const title = computed(() => (route.meta.title as string | undefined) ?? '')
</script>

<style scoped>
.tbar {
  height: 56px;
  flex: none;
  display: flex;
  align-items: stretch;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  user-select: none;
}
.tbar__left {
  display: flex;
  align-items: center;
  padding-left: var(--space-16);
}
.tbar__title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-wide);
  color: var(--text-secondary);
}
.tbar__spacer {
  flex: 1;
}
.tbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding-right: var(--space-8);
}
.nodrag {
  -webkit-app-region: no-drag;
}

.tb-search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  clip-path: var(--clip-notch);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}
.tb-search:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
}

.update-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--brand) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 40%, transparent);
  color: var(--brand);
  font-family: var(--font-num);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  cursor: pointer;
}
.update-pill:hover {
  filter: brightness(1.15);
}
.pill-enter-active,
.pill-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}
.pill-enter-from,
.pill-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.tb-ico {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  clip-path: var(--clip-notch);
}
.tb-ico:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tb-divider {
  width: 1px;
  height: 18px;
  background: var(--border-subtle);
}

.winb {
  display: flex;
  gap: 2px;
}
.winb button {
  width: 42px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.winb button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.winb button.x:hover {
  background: var(--loss);
  color: #fff; /* theme-fixed：红底白字两主题一致 */
}
</style>
