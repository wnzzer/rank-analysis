<template>
  <n-flex justify="space-between" style="height: 90vh" vertical>
    <n-menu
      :collapsed="true"
      :collapsed-width="68"
      :collapsed-icon-size="20"
      @update:value="handleMenuClick"
      :value="getFirstPath(router.currentRoute.value.path)"
      :options="menuOptions"
    />
    <div class="nav-status">
      <div class="nav-status-track">
        <button
          type="button"
          class="nav-status-item"
          :class="{ 'nav-status-item--on': isConnected }"
          :disabled="!isConnected"
          @click="toMe"
        >
          <span
            class="nav-status-dot nav-status-dot--green"
            :class="{ 'nav-status-dot--on': isConnected }"
          />
          <span class="nav-status-label">已连接</span>
        </button>
        <button
          type="button"
          class="nav-status-item"
          :class="{ 'nav-status-item--blue-on': isInGame }"
          @click="goGaming"
        >
          <span
            class="nav-status-dot nav-status-dot--blue"
            :class="{ 'nav-status-dot--on': isInGame }"
          />
          <span class="nav-status-label">游戏中</span>
        </button>
      </div>
    </div>
  </n-flex>
</template>

<script setup lang="ts">
import router from '../router'
import { getFirstPath } from '../router'
import { BarChartOutline, GameControllerOutline, SettingsOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { Component, computed, h, ref, watch } from 'vue'
import { Summoner } from './record/type'
import { useGameState } from '@renderer/composables/useGameState'
import { invoke } from '@tauri-apps/api/core'

const { summoner: gameStateSummoner, currentPhase } = useGameState()

// 将后端数据转换为前端 Summoner 类型
const mySummoner = ref<Summoner>({} as Summoner)

watch(
  gameStateSummoner,
  newSummoner => {
    if (newSummoner) {
      mySummoner.value = newSummoner as unknown as Summoner
    } else {
      mySummoner.value = {} as Summoner
    }
  },
  { immediate: true }
)

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}
function handleMenuClick(key: string) {
  // 跳转到对应路由
  router.push({
    name: key,
    query: { name: mySummoner.value.gameName + '#' + mySummoner.value.tagLine }
  })
}

const isConnected = computed(() => !!(mySummoner.value?.gameName && mySummoner.value?.tagLine))

/** 游戏中：由 phase 状态判断（后端已推送），与路由无关 */
const VALID_GAME_PHASES = ['ChampSelect', 'InProgress', 'PreEndOfGame', 'EndOfGame']
const isInGame = computed(() => {
  const p = currentPhase.value
  return !!p && VALID_GAME_PHASES.includes(p)
})

/** phase 进入对局时预加载 session 数据，加快进入对局页的加载速度 */
watch(
  isInGame,
  inGame => {
    if (inGame) {
      invoke('get_session_data').catch(() => {})
    }
  },
  { immediate: true }
)

const menuOptions = computed(() => [
  {
    label: '战绩',
    key: 'Record',
    icon: renderIcon(BarChartOutline),
    show: !!mySummoner.value?.gameName
  },
  {
    label: '对局',
    key: 'Gaming',
    icon: renderIcon(GameControllerOutline),
    show: !!mySummoner.value?.gameName
  },
  {
    label: '设置',
    key: 'Settings',
    icon: renderIcon(SettingsOutline),
    show: !!mySummoner.value?.gameName
  }
])

const toMe = () => {
  if (!isConnected.value) return
  router.push({
    path: '/Record',
    query: { name: mySummoner.value.gameName + '#' + mySummoner.value.tagLine }
  })
}

const goGaming = () => {
  router.push({
    name: 'Gaming',
    query: mySummoner.value?.gameName
      ? { name: mySummoner.value.gameName + '#' + mySummoner.value.tagLine }
      : undefined
  })
}
</script>

<style lang="css" scoped>
.left-container {
  width: 60px;
  height: 100%;
}

.nav-status {
  padding: 0 6px;
  margin-bottom: var(--space-8);
  min-width: 0;
}

.nav-status-track {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px 4px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  min-width: 0;
}

.nav-status-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  min-width: 0;
  border: none;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
  text-align: left;
  -webkit-app-region: no-drag;
  letter-spacing: 0.02em;
  background: transparent;
  color: var(--text-tertiary);
}

.nav-status-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  transform: translateX(2px);
}

.nav-status-item:active:not(:disabled) {
  transform: translateX(0) scale(0.98);
}

.nav-status-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.nav-status-item--on {
  background: rgba(61, 155, 122, 0.18);
  color: #6ee7b7;
}

.nav-status-item--on:hover {
  background: rgba(61, 155, 122, 0.25);
  color: #6ee7b7;
}

.nav-status-item--blue-on {
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
}

.nav-status-item--blue-on:hover {
  background: rgba(56, 189, 248, 0.22);
  color: #7dd3fc;
}

.nav-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  transition:
    box-shadow var(--transition-fast),
    opacity var(--transition-fast);
}

.nav-status-dot--green {
  background: rgba(255, 255, 255, 0.25);
}

.nav-status-dot--green.nav-status-dot--on {
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
  animation: status-dot-pulse 2s ease-in-out infinite;
}

.nav-status-dot--blue {
  background: rgba(255, 255, 255, 0.25);
}

.nav-status-dot--blue.nav-status-dot--on {
  background: #38bdf8;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.5);
  animation: status-dot-pulse 2s ease-in-out infinite;
}

@keyframes status-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

.nav-status-label {
  white-space: nowrap;
  overflow: visible;
  font-size: 9px;
  letter-spacing: 0.01em;
}

/* 亮色主题：提高对比度与可读性 */
.theme-light .nav-status-track {
  background: rgba(0, 0, 0, 0.04);
  border-color: var(--border-subtle);
}

.theme-light .nav-status-item {
  color: var(--text-tertiary);
}

.theme-light .nav-status-item:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-secondary);
}

.theme-light .nav-status-item--on {
  background: rgba(45, 138, 108, 0.15);
  color: #0d9668;
}

.theme-light .nav-status-item--on:hover {
  background: rgba(45, 138, 108, 0.22);
  color: #0d9668;
}

.theme-light .nav-status-item--blue-on {
  background: rgba(2, 132, 199, 0.12);
  color: #0369a1;
}

.theme-light .nav-status-item--blue-on:hover {
  background: rgba(2, 132, 199, 0.18);
  color: #0369a1;
}

.theme-light .nav-status-dot--green {
  background: rgba(0, 0, 0, 0.2);
}

.theme-light .nav-status-dot--green.nav-status-dot--on {
  background: #0d9668;
  box-shadow: 0 0 6px rgba(13, 150, 104, 0.4);
}

.theme-light .nav-status-dot--blue {
  background: rgba(0, 0, 0, 0.2);
}

.theme-light .nav-status-dot--blue.nav-status-dot--on {
  background: #0284c7;
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.35);
}
</style>
