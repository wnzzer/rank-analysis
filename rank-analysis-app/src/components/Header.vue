<template>
  <n-flex justify="space-between" class="header-inner">
    <div class="header-left" data-tauri-drag-region>
      <div class="logo-badge">R</div>
      <span class="header-title">Rank Analysis</span>
    </div>
    <div class="header-center">
      <SuperSearch />
    </div>
    <div class="header-right" data-tauri-drag-region>
      <!-- 升级药丸：只在探测到新版本时出现，点击直接走升级流程（不跳转关于页）。
           availableUpdate 来自 useAppUpdate 的模块级单例状态，无论是这里的启动
           静默检查，还是用户在「关于」页手动检查，两处共用同一份状态。 -->
      <Transition name="update-pill-fade">
        <button
          v-if="availableUpdate"
          type="button"
          class="update-pill"
          :title="`发现新版本 v${availableUpdate.version}，点击立即更新`"
          @click="onUpdatePillClick"
        >
          <n-icon :size="13" :component="ArrowUpCircleOutline" />
          <span>新版 v{{ availableUpdate.version }}</span>
        </button>
      </Transition>
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
import { ref, computed, onMounted, watch } from 'vue'
import {
  LogoGithub,
  RemoveOutline,
  SquareOutline,
  CloseOutline,
  SunnyOutline,
  MoonOutline,
  PowerOutline,
  ArrowUpCircleOutline
} from '@vicons/ionicons5'
import { darkTheme, useMessage } from 'naive-ui'
import { Window } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'

import SuperSearch from './SuperSearch.vue'
import { useSettingsStore } from '@renderer/pinia/setting'
import { useGameState, lcuConnected } from '@renderer/composables/useGameState'
import { closeLeagueByIpc } from '@renderer/services/ipc'
import { useAppUpdate } from '@renderer/composables/useAppUpdate'
import { GATE_SETTLE_MS, GATE_FALLBACK_MS } from '@renderer/composables/useStartupDialogs'

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

// ─── 顶栏升级药丸 ───────────────────────────────────────────────────────────
// availableUpdate 是 useAppUpdate 的模块级单例状态：无论是这里的启动静默检查
// 查到的，还是用户在「关于」页手动检查查到的，都共享同一份，药丸都能感知到。
const { availableUpdate, checkForUpdates, showUpdateDialog } = useAppUpdate()

/** 药丸点击：已经是"已发现更新"的信号，直接弹确认框走升级流程，不用再查一遍 */
const onUpdatePillClick = (): void => {
  if (availableUpdate.value) showUpdateDialog(availableUpdate.value)
}

/**
 * 启动时静默查一次更新。
 *
 * 借用 useStartupDialogs 同款"等首屏就绪 + 兜底超时"开闸节奏（GATE_SETTLE_MS /
 * GATE_FALLBACK_MS，见该文件说明）：优先等 LCU 连接建立后再沉淀一小段时间，
 * 避免与首屏加载抢资源；一直连不上则靠兜底超时兜底触发，不然先开工具后开
 * 游戏的用户永远等不到检查。更新检查与启动弹窗队列是两回事，这里只借时间
 * 常量保持"不抢首屏"的口径一致，不接入 useStartupDialogs 的弹窗队列本身。
 *
 * Header 只在主窗口挂载一次（详情子窗口不渲染 Header，见 Framework.vue），
 * 无需处理重复触发/卸载清理。
 */
function scheduleSilentUpdateCheck(): void {
  let scheduled = false
  function fire(): void {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => {
      checkForUpdates('silent')
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

/**
 * 打开项目 GitHub 主页
 * 使用 Tauri 的 open API 打开项目仓库链接
 */
const openGithubLink = async (): Promise<void> => {
  await openUrl('https://github.com/wnzzer/rank-analysis')
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
  box-shadow: var(--decor-glow-win);
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

/* 升级药丸：探测到新版本才出现，金色强调（与 MatchDetailModal 的 MVP/荣誉
   chip 同一套 --accent-gold token 语言），不占用未检测到更新时的空间 */
.update-pill {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  height: 22px;
  padding: 0 var(--space-8);
  border: none;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--accent-gold) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-gold) 40%, transparent);
  color: var(--accent-gold-deep);
  font-size: var(--font-size-xs);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-expo);
}

.update-pill:hover {
  background: color-mix(in srgb, var(--accent-gold) 28%, transparent);
  transform: scale(1.04);
}

.update-pill-fade-enter-active,
.update-pill-fade-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}

.update-pill-fade-enter-from,
.update-pill-fade-leave-to {
  opacity: 0;
  transform: scale(0.85);
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
  color: white; /* theme-fixed: 红底白字,两主题一致 */
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
