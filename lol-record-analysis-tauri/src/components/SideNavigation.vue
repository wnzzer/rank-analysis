<template>
  <div class="sidenav-wrap">
    <div class="nav-items">
      <button v-if="!!mySummoner?.gameName" type="button" class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Record' }"
        @click="handleMenuClick('Record')">
        <n-icon :size="18"><BarChartOutline /></n-icon>
        <span class="nav-item-label">战绩</span>
      </button>
      <button v-if="!!mySummoner?.gameName" type="button" class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Gaming' }"
        @click="handleMenuClick('Gaming')">
        <n-icon :size="18"><GameControllerOutline /></n-icon>
        <span class="nav-item-label">对局</span>
      </button>
      <button v-if="!!mySummoner?.gameName" type="button" class="nav-item"
        :class="{ 'nav-item--active': getFirstPath(router.currentRoute.value.path) === 'Settings' }"
        @click="handleMenuClick('Settings')">
        <n-icon :size="18"><SettingsOutline /></n-icon>
        <span class="nav-item-label">设置</span>
      </button>
    </div>
    <div class="status-icons">
      <n-tooltip placement="right" :delay="200">
        <template #trigger>
          <button type="button" class="status-icon-btn"
            :class="{ 'status-icon-btn--on': isConnected }"
            :disabled="!isConnected" @click="toMe">
            <n-icon :size="15"><LinkOutline /></n-icon>
            <span class="status-dot" :class="isConnected ? 'status-dot--green' : 'status-dot--off'" />
          </button>
        </template>
        {{ isConnected ? `已连接：${mySummoner.gameName}` : '未连接客户端' }}
      </n-tooltip>
      <n-tooltip placement="right" :delay="200">
        <template #trigger>
          <button type="button" class="status-icon-btn"
            :class="{ 'status-icon-btn--blue': isInGame }"
            @click="goGaming">
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
import { BarChartOutline, GameControllerOutline, SettingsOutline, LinkOutline } from '@vicons/ionicons5'
import { computed, ref, watch } from 'vue'
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
  padding: 10px 0 8px;
  overflow: hidden; /* CRITICAL: prevent any horizontal overflow */
}

.nav-items {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
  width: 100%;
  padding: 0 8px;
}

.nav-item {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 9px;
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
  background: var(--glass-bg-high);
  color: var(--text-secondary);
  transform: scale(1.04);
}

.nav-item:active {
  transform: scale(0.97);
  transition-duration: var(--dur-instant);
}

.nav-item--active {
  background: rgba(61, 155, 122, 0.14);
  color: var(--semantic-win);
  border-color: rgba(61, 155, 122, 0.2);
  box-shadow: 0 0 12px rgba(61, 155, 122, 0.15);
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
  background: linear-gradient(180deg, #5ecfa4, #2d7a5e);
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 8px rgba(61, 155, 122, 0.4);
}

.nav-item-label { font-size: 9px; }

/* Status icons */
.status-icons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
  width: 100%;
  margin-bottom: 4px;
}

.status-icon-btn {
  width: 100%;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid transparent;
  background: var(--glass-bg-low);
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
  -webkit-app-region: no-drag;
}

.status-icon-btn:hover:not(:disabled) {
  background: var(--glass-bg-high);
  color: var(--text-secondary);
}

.status-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.status-icon-btn--on {
  background: rgba(61, 155, 122, 0.12);
  color: var(--semantic-win);
}

.status-icon-btn--blue {
  background: rgba(56, 189, 248, 0.1);
  color: #38bdf8;
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
  background: #4ade80;
  box-shadow: 0 0 5px rgba(74, 222, 128, 0.6);
  animation: dot-pulse 2s ease-in-out infinite;
}

.status-dot--blue {
  background: #38bdf8;
  box-shadow: 0 0 5px rgba(56, 189, 248, 0.5);
  animation: dot-pulse 2s ease-in-out infinite;
}

.status-dot--off {
  background: var(--text-tertiary);
  opacity: 0.5;
}

/* LIGHT THEME — override every dark-specific value */
.theme-light .nav-item--active {
  background: rgba(45, 138, 108, 0.12);
  border-color: rgba(45, 138, 108, 0.18);
}

.theme-light .nav-item--active::before {
  background: linear-gradient(180deg, #0d9668, #2d8a6c);
  box-shadow: 0 0 6px rgba(45, 138, 108, 0.3);
}

.theme-light .status-icon-btn--on {
  background: rgba(45, 138, 108, 0.1);
}

.theme-light .status-icon-btn--blue {
  background: rgba(2, 132, 199, 0.1);
  color: #0369a1;
}

.theme-light .status-dot--green {
  background: #0d9668;
  box-shadow: 0 0 4px rgba(13, 150, 104, 0.4);
}

.theme-light .status-dot--blue {
  background: #0284c7;
  box-shadow: 0 0 4px rgba(2, 132, 199, 0.35);
}
</style>
