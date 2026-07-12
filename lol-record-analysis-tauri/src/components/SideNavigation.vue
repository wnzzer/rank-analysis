<template>
  <div class="sidenav-wrap">
    <div class="nav-items">
      <button
        v-if="!!mySummoner?.gameName"
        type="button"
        class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Record' }"
        @click="handleMenuClick('Record')"
      >
        <n-icon :size="18"><BarChartOutline /></n-icon>
        <span class="nav-item-label">战绩</span>
      </button>
      <button
        v-if="!!mySummoner?.gameName"
        type="button"
        class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Gaming' }"
        @click="handleMenuClick('Gaming')"
      >
        <n-icon :size="18"><GameControllerOutline /></n-icon>
        <span class="nav-item-label">对局</span>
      </button>
      <!-- 设置不依赖 LCU 连接，未连接（Loading 页）时也保持可见可进 -->
      <button
        type="button"
        class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Settings' }"
        @click="handleMenuClick('Settings')"
      >
        <n-icon :size="18"><SettingsOutline /></n-icon>
        <span class="nav-item-label">设置</span>
      </button>
    </div>
    <div class="status-icons">
      <n-tooltip placement="right" :delay="200">
        <template #trigger>
          <button
            type="button"
            class="status-icon-btn"
            :class="{ 'status-icon-btn--on': isConnected }"
            :disabled="!isConnected"
            @click="toMe"
          >
            <n-icon :size="15"><LinkOutline /></n-icon>
            <span
              class="status-dot"
              :class="isConnected ? 'status-dot--green' : 'status-dot--off'"
            />
          </button>
        </template>
        {{ isConnected ? `已连接：${mySummoner.gameName}` : '未连接客户端' }}
      </n-tooltip>
      <n-tooltip placement="right" :delay="200">
        <template #trigger>
          <button
            type="button"
            class="status-icon-btn"
            :class="{ 'status-icon-btn--blue': isInGame }"
            @click="goGaming"
          >
            <n-icon :size="15"><GameControllerOutline /></n-icon>
            <span class="status-dot" :class="isInGame ? 'status-dot--blue' : 'status-dot--off'" />
          </button>
        </template>
        {{ isInGame ? '游戏中' : '未在游戏中' }}
      </n-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import router from '../router'
import { getFirstPath } from '../router'
import {
  BarChartOutline,
  GameControllerOutline,
  SettingsOutline,
  LinkOutline
} from '@vicons/ionicons5'
import { computed, ref, watch } from 'vue'
import { Summoner } from './record/type'
import { useGameState } from '@renderer/composables/useGameState'

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

function handleMenuClick(key: string) {
  // 跳转到对应路由；未连接时（如从 Loading 页进设置）没有召唤师信息，不带 name
  // 参数，避免生成 "undefined#undefined" 的脏 query
  router.push({
    name: key,
    query: mySummoner.value?.gameName
      ? { name: mySummoner.value.gameName + '#' + mySummoner.value.tagLine }
      : undefined
  })
}

const isConnected = computed(() => !!(mySummoner.value?.gameName && mySummoner.value?.tagLine))

/** 游戏中：由 phase 状态判断（后端已推送），与路由无关 */
const VALID_GAME_PHASES = ['ChampSelect', 'InProgress', 'PreEndOfGame', 'EndOfGame']
const isInGame = computed(() => {
  const p = currentPhase.value
  return !!p && VALID_GAME_PHASES.includes(p)
})

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
.sidenav-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-6) 0 var(--space-4);
  overflow: hidden;
}

.nav-items {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  width: 100%;
  padding: 0 var(--space-8);
}

.nav-item {
  width: 100%;
  height: 44px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-3xs);
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring),
    box-shadow var(--dur-fast) var(--ease-expo);
  -webkit-app-region: no-drag;
  position: relative;
}

.nav-item:hover {
  background: var(--glass-bg-mid);
  color: var(--text-secondary);
  transform: scale(1.04);
}

.nav-item:active {
  transform: scale(0.97);
  transition-duration: var(--dur-instant);
}

.nav-item--active {
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
  color: var(--semantic-win);
  border-color: color-mix(in srgb, var(--semantic-win) 20%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--semantic-win) 15%, transparent);
}

/* 键盘聚焦时让位给全局 focus ring，激活态描边/辉光暂时退场，避免双环 */
.nav-item--active:focus-visible {
  border-color: transparent;
  box-shadow: none;
}

/* Active indicator — INSIDE the button, NOT bleeding outside */
.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  background: var(--win-bar-gradient);
  border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  box-shadow: 0 0 8px color-mix(in srgb, var(--semantic-win) 40%, transparent);
}

.nav-item-label {
  font-size: var(--font-size-3xs);
}

/* Status icons */
.status-icons {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-8);
  width: 100%;
  flex-shrink: 0;
  margin-bottom: var(--space-6);
}

.status-icon-btn {
  width: 100%;
  height: 28px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
  -webkit-app-region: no-drag;
}

.status-icon-btn:hover:not(:disabled) {
  background: var(--glass-bg-mid);
  color: var(--text-secondary);
}

.status-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.status-icon-btn--on {
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
  color: var(--semantic-win);
}

.status-icon-btn--blue {
  background: color-mix(in srgb, var(--accent-sky) 10%, transparent);
  color: var(--accent-sky);
}

.status-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-base);
}

.status-dot--green {
  background: var(--semantic-win-bright);
  box-shadow: 0 0 5px color-mix(in srgb, var(--semantic-win-bright) 60%, transparent);
  animation: dot-pulse 2s ease-in-out infinite;
}

.status-dot--blue {
  background: var(--accent-sky);
  box-shadow: 0 0 5px color-mix(in srgb, var(--accent-sky) 50%, transparent);
  animation: dot-pulse 2s ease-in-out infinite;
}

.status-dot--off {
  background: var(--text-tertiary);
  opacity: 0.5;
}

/* LIGHT THEME */
.theme-light .nav-item:hover {
  background: var(--glass-bg-high);
}

.theme-light .status-icon-btn:hover:not(:disabled) {
  background: var(--glass-bg-high);
}

.theme-light .nav-item--active {
  background: color-mix(in srgb, var(--semantic-win) 12%, transparent);
  border-color: color-mix(in srgb, var(--semantic-win) 18%, transparent);
}

.theme-light .nav-item--active:focus-visible {
  border-color: transparent;
  box-shadow: none;
}

.theme-light .nav-item--active::before {
  box-shadow: 0 0 6px color-mix(in srgb, var(--semantic-win) 30%, transparent);
}

.theme-light .status-icon-btn--on {
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
}

.theme-light .status-dot--green {
  background: var(--semantic-win);
  box-shadow: 0 0 4px color-mix(in srgb, var(--semantic-win-bright) 40%, transparent);
}

.theme-light .status-dot--blue {
  box-shadow: 0 0 4px color-mix(in srgb, var(--accent-sky) 35%, transparent);
}
</style>
