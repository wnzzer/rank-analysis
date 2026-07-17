<template>
  <n-flex justify="space-between" class="header-inner">
    <div class="header-left">
      <div class="logo-badge">R</div>
      <span class="header-title">Rank Analysis</span>
    </div>
    <div class="header-center">
      <n-input
        class="input-lolid header-search"
        type="text"
        size="small"
        placeholder="召唤师名#Tag"
        v-model:value="searchValue"
        @keyup.enter="onClinkSearch"
      >
        <!-- 前缀：大区下拉（框内左侧，细分隔线隔开），整体仍是一个搜索框 -->
        <template #prefix>
          <n-dropdown
            trigger="click"
            size="small"
            :options="regionDropdownOptions"
            @select="onRegionSelect"
          >
            <button class="region-trigger" type="button" @mousedown.prevent>
              <span class="region-trigger-label">{{ selectedRegionLabel }}</span>
              <n-icon :size="11" class="region-trigger-caret"><ChevronDownOutline /></n-icon>
            </button>
          </n-dropdown>
          <span class="region-divider" />
        </template>
        <template #suffix>
          <n-button text quaternary @click="onClinkSearch" class="header-icon-btn">
            <n-icon :component="Search" />
          </n-button>
        </template>
      </n-input>
    </div>
    <div class="header-right">
      <n-popconfirm positive-text="关闭游戏" negative-text="取消" @positive-click="closeLeague">
        <template #trigger>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button
                quaternary
                circle
                class="header-icon-btn close-league-btn"
                :disabled="!isConnected"
                :loading="closingLeague"
              >
                <n-icon :component="PowerOutline" />
              </n-button>
            </template>
            {{ isConnected ? '关闭游戏客户端' : '游戏客户端未运行' }}
          </n-tooltip>
        </template>
        确定关闭游戏客户端？
      </n-popconfirm>
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
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  Search,
  LogoGithub,
  RemoveOutline,
  SquareOutline,
  CloseOutline,
  SunnyOutline,
  MoonOutline,
  ChevronDownOutline,
  PowerOutline
} from '@vicons/ionicons5'
import { darkTheme, useMessage } from 'naive-ui'
import { Window } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'

import router from '@renderer/router'
import { useSettingsStore } from '@renderer/pinia/setting'
import { useGameState } from '@renderer/composables/useGameState'
import { closeLeagueByIpc } from '@renderer/services/ipc'

/**
 * 应用顶部导航栏组件
 *
 * 提供应用的核心导航和控制功能：
 * - 品牌展示（Logo + 标题）
 * - 召唤师搜索功能
 * - 主题切换（亮色/暗色）
 * - 窗口控制（最小化/最大化/关闭）
 * - GitHub 项目链接
 *
 * @example
 * <!-- 在 Framework.vue 中使用 -->
 * <n-layout-header class="header" bordered>
 *   <Header />
 * </n-layout-header>
 */

/** 当前应用窗口实例，用于执行窗口控制操作 */
const currentWindow = Window.getCurrent()

/** 搜索输入框的值 */
const searchValue = ref('')

/** 选中的大区 platformId（空 = 当前区，走本地 LCU；非空走 SGP 跨区查询） */
const selectedRegion = ref('')
/** 大区下拉选项：当前区 + 各腾讯大区（来自后端 get_sgp_regions） */
const regionOptions = ref<{ label: string; value: string }[]>([{ label: '当前区', value: '' }])

onMounted(async () => {
  try {
    const regions = await invoke<{ label: string; value: string }[]>('get_sgp_regions')
    regionOptions.value = [{ label: '当前区', value: '' }, ...regions]
  } catch (e) {
    console.error('加载大区列表失败', e)
  }
})

/** n-dropdown 选项格式（key=platformId） */
const regionDropdownOptions = computed(() =>
  regionOptions.value.map(r => ({ label: r.label, key: r.value }))
)
/** 当前选中大区的显示文案（前缀按钮上的文字） */
const selectedRegionLabel = computed(
  () => regionOptions.value.find(r => r.value === selectedRegion.value)?.label ?? '当前区'
)
const onRegionSelect = (key: string): void => {
  selectedRegion.value = key
}

/** 设置状态管理 Store */
const settingsStore = useSettingsStore()

/** LCU 连接状态：仅在客户端运行（已连接）时允许点击关闭游戏 */
const { isConnected } = useGameState()

const message = useMessage()

/** 关闭游戏请求进行中（防重复点击 + 按钮 loading 态） */
const closingLeague = ref(false)

/**
 * 关闭游戏客户端（顶栏电源按钮的确认回调）
 *
 * 调用后端 close_league：优先 LCU 优雅退出，失败兜底强杀客户端进程链。
 * 成功/失败均以 message 反馈；连接断开由 game-state-changed 事件自然驱动
 * UI（按钮变为禁用态），无需在此额外处理。
 */
const closeLeague = async (): Promise<void> => {
  if (closingLeague.value) return
  closingLeague.value = true
  try {
    await closeLeagueByIpc()
    message.success('已关闭游戏客户端')
  } catch (e) {
    message.error(String(e))
  } finally {
    closingLeague.value = false
  }
}

/**
 * 主题开关状态
 * 根据当前主题是否为暗色主题计算开关状态
 */
const themeSwitch = computed(() => settingsStore.theme.name !== darkTheme.name)

/**
 * 打开项目 GitHub 主页
 * 使用 Tauri 的 open API 打开项目仓库链接
 */
const openGithubLink = async (): Promise<void> => {
  await openUrl('https://github.com/wnzzer/rank-analysis')
}

/**
 * 执行召唤师搜索
 * 将用户输入的召唤师名称作为查询参数跳转到战绩查询页面
 * 使用时间戳作为查询参数确保每次搜索都会触发页面刷新
 *
 * @example
 * 用户输入 "SummonerName" 后按回车或点击搜索按钮
 * 页面跳转到 /Record?name=SummonerName&t=1234567890
 */
const onClinkSearch = async (): Promise<void> => {
  if (!searchValue.value.trim()) return

  await router.push({
    path: '/Record',
    // region 为空表示当前区，不带该参数即走原本地 LCU 流程
    query: { name: searchValue.value, region: selectedRegion.value || undefined, t: Date.now() }
  })
  searchValue.value = ''
}

/**
 * 最小化应用窗口
 */
const minimizeWindow = (): void => {
  currentWindow.minimize()
}

/**
 * 最大化/还原应用窗口
 */
const maximizeWindow = (): void => {
  currentWindow.toggleMaximize()
}

/**
 * 关闭应用窗口
 */
const closeWindow = (): void => {
  currentWindow.close()
}
</script>
<style lang="css" scoped>
/* 不加 backdrop-filter：顶栏底色近实色，模糊毫无视觉贡献；且透明窗口
   （tauri transparent:true）+ backdrop-filter 会诱发 WebView2 合成层
   冻结——运行时切主题后顶栏卡死在旧主题配色，整页刷新才恢复 */
.header-inner {
  width: 100%;
  height: 100%;
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

.logo-badge {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--semantic-win) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--semantic-win) 28%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--semantic-win) 18%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 900;
  color: var(--semantic-win);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.header-title {
  color: var(--text-primary);
  font-weight: 700;
  font-size: var(--font-size-md);
  letter-spacing: 0.02em;
}

.header-center {
  flex: 1;
  width: 33%;
  display: flex;
  justify-content: center;
  max-width: 340px;
  margin: 0 auto;
}

.input-lolid {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

/* 单一搜索框：大区做成框内左侧下拉前缀，整体一个边框/背景/聚焦态 */
.header-search {
  width: 100%;
  border-radius: var(--radius-md);
}

.header-search :deep(.n-input-wrapper) {
  transition:
    box-shadow var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

/* 聚焦时整框发光 */
.header-center:focus-within .header-search :deep(.n-input-wrapper) {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--semantic-win) 20%, transparent);
  border-color: color-mix(in srgb, var(--semantic-win) 35%, transparent) !important;
}

/* 前缀：大区下拉触发器（小号文字 + 箭头，hover 淡底） */
.region-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  -webkit-app-region: no-drag;
  transition:
    color var(--dur-fast) var(--ease-expo),
    background-color var(--dur-fast) var(--ease-expo);
}

.region-trigger:hover {
  color: var(--text-primary);
  background: var(--glass-bg-high);
}

.region-trigger-caret {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 前缀与输入文本之间的细分隔线 */
.region-divider {
  width: 1px;
  height: 14px;
  margin: 0 var(--space-8) 0 5px;
  background: var(--glass-border);
  flex-shrink: 0;
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
    background-color var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-expo);
}

.header-icon-btn:hover {
  color: var(--text-primary);
  background-color: var(--glass-bg-high);
  transform: scale(1.08);
}

/* 关闭游戏按钮：hover 用败方红提示这是个"下线"动作；禁用态（未连接）淡化 */
.close-league-btn:hover:not(:disabled) {
  color: var(--semantic-loss);
  background-color: color-mix(in srgb, var(--semantic-loss) 14%, transparent);
}

.close-league-btn:disabled {
  opacity: 0.4;
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
  padding: var(--space-6) var(--space-12);
  font-size: var(--font-size-md);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--dur-fast) var(--ease-expo),
    background-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-expo);
  position: relative;
}

.window-control-btn:hover {
  color: var(--text-primary);
  background-color: var(--glass-bg-high);
  transform: scale(1.05);
}

.window-control-btn:active {
  transform: scale(0.98);
}

.close-btn:hover {
  background-color: color-mix(in srgb, var(--semantic-loss) 75%, transparent);
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
