<template>
  <n-flex justify="space-between" class="header-inner">
    <div class="header-left">
      <img src="../assets/logo.png" alt="Logo" class="header-logo" />
      <span class="header-title">Rank Analysis</span>
    </div>
    <div class="header-center">
      <n-input
        class="input-lolid header-search"
        type="text"
        size="small"
        placeholder="输入召唤师"
        v-model:value="value"
        @keyup.enter="onClinkSearch"
      >
        <template #suffix>
          <n-button text quaternary @click="onClinkSearch" class="header-icon-btn">
            <n-icon :component="Search" />
          </n-button>
        </template>
      </n-input>
    </div>
    <div class="header-right">
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button quaternary circle class="header-icon-btn" @click="openGithubLink">
            <n-icon :component="LogoGithub" />
          </n-button>
        </template>
        访问 wnzzer 的项目主页
      </n-tooltip>
      <n-divider vertical />
      <n-switch
        :value="themeSwitch"
        @click="settingsStore.toggleTheme()"
        size="small"
        class="header-theme-switch"
      >
        <template #checked>
          <n-icon>
            <sunny-outline />
          </n-icon>
        </template>
        <template #unchecked>
          <n-icon>
            <moon-outline />
          </n-icon>
        </template>
      </n-switch>
      <div class="window-controls">
        <n-button quaternary text @click="minimizeWindow" class="window-control-btn">
          <n-icon><remove-outline /></n-icon>
        </n-button>
        <n-button quaternary text @click="maximizeWindow" class="window-control-btn">
          <n-icon><square-outline /></n-icon>
        </n-button>
        <n-button quaternary text @click="closeWindow" class="window-control-btn close-btn">
          <n-icon><close-outline /></n-icon>
        </n-button>
      </div>
    </div>
  </n-flex>
</template>
<script lang="ts" setup>
import router from '../router'
import {
  Search,
  LogoGithub,
  RemoveOutline,
  SquareOutline,
  CloseOutline,
  SunnyOutline,
  MoonOutline
} from '@vicons/ionicons5'
import { computed, ref } from 'vue'
import { Window } from '@tauri-apps/api/window'
import { useSettingsStore } from '@renderer/pinia/setting'
import { darkTheme } from 'naive-ui'
const currentWindow = Window.getCurrent()

const openGithubLink = () => {
  window.open('https://github.com/wnzzer/rank-analysis', '_blank')
}

const value = ref('')
const settingsStore = useSettingsStore()
const themeSwitch = computed(() => {
  return settingsStore.theme.name !== darkTheme.name
})

function onClinkSearch() {
  router
    .push({
      path: '/Record',
      query: { name: value.value, t: Date.now() } // 添加动态时间戳作为查询参数
    })
    .then(() => {
      value.value = ''
    })
}

const minimizeWindow = () => {
  currentWindow.minimize()
}

const maximizeWindow = () => {
  currentWindow.toggleMaximize()
}

const closeWindow = () => {
  currentWindow.close()
}
</script>
<style lang="css" scoped>
.header-inner {
  width: 100%;
  align-items: center;
}

.header-left {
  width: 33%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding-left: var(--space-12);
}

.header-logo {
  height: 22px;
  display: block;
}

.header-title {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
}

.header-center {
  flex: 1;
  width: 33%;
  display: flex;
  justify-content: center;
  max-width: 240px;
  margin: 0 auto;
}

.input-lolid {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.header-search {
  width: 100%;
  border-radius: var(--radius-md);
}

.header-right {
  width: 33%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
}

.header-icon-btn {
  -webkit-app-region: no-drag;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}
.header-icon-btn:hover {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.06);
}

.theme-light .header-icon-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.header-theme-switch {
  margin-right: var(--space-8);
}

.window-controls {
  display: inline-flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.window-control-btn {
  padding: 6px 12px;
  font-size: 14px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
  position: relative;
}

.window-control-btn:hover {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.06);
}

.theme-light .window-control-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.close-btn:hover {
  background-color: #c45c5c;
  color: white;
}

.window-control-btn::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
}
</style>
