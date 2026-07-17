<template>
  <div class="full-container">
    <MatchDetail v-if="isStandaloneDetailWindow" />
    <n-flex v-else vertical size="large">
      <ErrorReportingConsentDialog v-model:show="showConsent" @decide="onConsentDecide" />
      <CloudSyncNoticeDialog :show="showCloudNotice" @decide="onCloudNoticeDecide" />
      <!-- 让位给错误上报/云同步告知弹窗，关掉后本弹窗自然浮现（pendingCloudConfig 响应式） -->
      <CloudConfigPullDialog
        :show="cloudStore.pendingCloudConfig !== null && !showConsent && !showCloudNotice"
        :updated-at="cloudStore.pendingCloudConfig?.updatedAt ?? 0"
        @decide="onCloudConfigDecide"
      />
      <!-- 整体布局 -->
      <n-layout>
        <!-- 顶部区域 -->
        <n-layout-header class="header" bordered>
          <Header></Header>
        </n-layout-header>

        <!-- 中间部分：左侧导航 + 内容区域 -->
        <n-layout has-sider class="content" style="width: 100%">
          <!-- 左侧导航 -->
          <n-layout-sider collapse-mode="width" class="left" style="width: 68px" bordered>
            <SideNavigation />
          </n-layout-sider>
          <!-- 内容区域 -->
          <n-layout-content :content-style="contentStyle">
            <router-view v-slot="{ Component }">
              <Transition v-if="!isSettingsRoute" name="page" mode="out-in">
                <component :is="Component" :key="$route.fullPath" />
              </Transition>
              <component v-else :is="Component" :key="$route.fullPath" />
            </router-view>
          </n-layout-content>
        </n-layout>
      </n-layout>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMessage } from 'naive-ui'

import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import MatchDetail from '@renderer/views/MatchDetail.vue'
import ErrorReportingConsentDialog from '@renderer/components/common/ErrorReportingConsentDialog.vue'
import CloudSyncNoticeDialog from '@renderer/components/common/CloudSyncNoticeDialog.vue'
import CloudConfigPullDialog from './common/CloudConfigPullDialog.vue'
import { useGameState } from '@renderer/composables/useGameState'
import { useZoom } from '@renderer/composables/useZoom'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { useCloudSyncStore } from '@renderer/pinia/cloudSync'

/**
 * 应用主布局框架组件
 *
 * 提供应用的整体布局结构，包括：
 * - 顶部标题栏（Header）
 * - 左侧导航栏（SideNavigation）
 * - 主内容区域（router-view）
 *
 * 支持两种显示模式：
 * 1. 完整布局模式：显示完整的侧边栏 + 头部 + 内容区
 * 2. 独立窗口模式：用于战绩详情弹窗，仅渲染 MatchDetail 组件
 *
 * @example
 * <!-- 在 App.vue 中使用 -->
 * <Framework />
 */

const route = useRoute()
const router = useRouter()
const currentWindow = getCurrentWindow()

/**
 * 判断当前路由是否为设置页面
 * 设置页面不使用页面切换动画，避免过渡效果干扰表单交互
 */
const isSettingsRoute = computed(() => route.path.startsWith('/Settings'))

/**
 * 判断当前窗口是否为独立的战绩详情窗口
 * 独立窗口通过窗口标签前缀 'match-detail-' 识别，用于多开战绩查看
 */
const isStandaloneDetailWindow = computed(() => currentWindow.label.startsWith('match-detail-'))

/**
 * 初始化游戏状态监听
 * 包含自动跳转逻辑：当检测到游戏开始时自动切换到对局页面
 */
const { isConnected } = useGameState()

// 浏览器式缩放（Ctrl+滚轮 / Ctrl±0）：Framework 是所有窗口的根，详情窗一并生效
useZoom()

const message = useMessage()

/** 是否展示错误上报首次同意弹窗 */
const showConsent = ref(false)

/** 防止"连接事件"与"兜底超时"重复弹窗 */
let consentRevealed = false

/**
 * 首次启动征求错误上报同意。
 *
 * Sentry 上报本身默认关闭（opt-in）；此弹窗只在首次启动出现一次，提高透明度并
 * 默认推荐启用，但保留真实的"保持关闭"选项、不强制。仅主窗口弹，排除 match-detail
 * 子窗口。UI 见 {@link ErrorReportingConsentDialog}。
 *
 * 关键：**不在首屏加载阶段弹**。首屏（Record）依赖客户端连接事件跳转并拉取数据，
 * 若此时弹模态框会打断首屏的关键路径、让人误以为"弹窗导致加载失败"。因此这里等
 * `isConnected`（客户端已连、首屏就绪）后再延时弹出；若长时间未连接则兜底弹出，
 * 避免永远问不到。
 *
 * @see commit 6163f86（Sentry opt-in 接入）
 */
async function maybeAskErrorReportingConsent(): Promise<void> {
  if (isStandaloneDetailWindow.value) return
  try {
    const shown = await getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingConsentShown)
    if (shown) return
  } catch {
    // 读不到配置时按"未问过"处理
  }

  if (isConnected.value) {
    revealConsent()
    return
  }
  // 等首屏就绪后再弹；最多兜底等待 8s
  const stop = watch(isConnected, connected => {
    if (connected) {
      stop()
      revealConsent()
    }
  })
  window.setTimeout(() => {
    stop()
    revealConsent()
  }, 8000)
}

/** 首屏稳定后再弹（留 500ms 让首屏渲染/动画落定），仅弹一次 */
function revealConsent(): void {
  if (consentRevealed) return
  consentRevealed = true
  window.setTimeout(() => {
    showConsent.value = true
  }, 500)
}

/**
 * 处理用户在同意弹窗中的选择。无论选择什么都标记"已问过"，之后不再弹。
 * @param enabled - true 启用上报，false 保持关闭
 */
async function onConsentDecide(enabled: boolean): Promise<void> {
  showConsent.value = false
  try {
    // 无论"启用"还是"保持关闭"，都把用户的明确选择持久化到 errorReportingEnabled。
    // 否则当用户此前已在设置里开过（配置为 true）时，点"保持关闭"不会真正关掉，
    // 与按钮文案不符。
    await putConfigByIpc(CONFIG_KEYS.errorReportingEnabled, enabled)
    if (enabled) message.success('已开启，重启后生效')
  } catch {
    message.error('保存失败')
  }
  putConfigByIpc(CONFIG_KEYS.errorReportingConsentShown, true).catch(() => {})
}

/** 是否展示云同步功能告知弹窗 */
const showCloudNotice = ref(false)

/**
 * 首次启动（或升级后首次）一次性介绍云同步功能。
 *
 * 时机：排在错误上报同意弹窗之后，避免两个模态框叠放——仅当
 * `errorReportingConsentShown` 已为 true（老用户，本次启动不会再弹错误上报同意
 * 弹窗）时，本次启动才弹本弹窗；刚回答完错误上报弹窗的新用户，下次启动再弹。
 * 仅主窗口弹，排除 match-detail 子窗口。UI 见 {@link CloudSyncNoticeDialog}。
 *
 * 与姊妹函数不同，这里刻意不做 `isConnected` 门控、只用平坦的 1.5s 延时：本弹窗
 * 是被动告知（看完即关，不要求用户当场做阻塞性决策），即使恰逢首屏加载出现，
 * 也不至于让人误以为"弹窗导致加载失败"，不值得为它复制一套连接等待逻辑。
 */
async function maybeShowCloudSyncNotice(): Promise<void> {
  if (isStandaloneDetailWindow.value) return
  try {
    const noticeShown = await getConfigByIpc<boolean>(CONFIG_KEYS.cloudSyncNoticeShown)
    if (noticeShown) return
    const consentShown = await getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingConsentShown)
    if (!consentShown) return // 本次启动让位给错误上报弹窗
  } catch {
    return
  }
  window.setTimeout(() => {
    showCloudNotice.value = true
  }, 1500)
}

/**
 * 处理云同步告知弹窗的用户选择。两种选择都标记"已告知"，之后不再弹；
 * 仅当选择"去看看"时跳转到设置页的数据与同步页签，不在此处开启任何开关。
 * @param goto - true 跳转设置页，false 仅关闭
 */
function onCloudNoticeDecide(goto: boolean): void {
  showCloudNotice.value = false
  putConfigByIpc(CONFIG_KEYS.cloudSyncNoticeShown, true).catch(() => {})
  if (goto) router.push({ name: 'DataSync' })
}

const cloudStore = useCloudSyncStore()

/** 首次配置同步弹窗裁决:成功/失败都给 toast 反馈,失败细节在 store.lastError */
async function onCloudConfigDecide(useCloud: boolean): Promise<void> {
  try {
    await cloudStore.resolveCloudConfig(useCloud)
    message.success(useCloud ? '已应用云端配置' : '已保留本机配置并推送云端')
  } catch {
    message.error(cloudStore.lastError ?? '配置同步失败')
  }
}

onMounted(() => {
  maybeAskErrorReportingConsent()
  maybeShowCloudSyncNotice()
})

/**
 * 内容区域样式配置
 * 使用 CSS 变量确保主题一致性
 */
const contentStyle = computed(() => ({
  backgroundColor: 'var(--bg-base)',
  height: '100%'
}))
</script>
<style scoped>
.full-container {
  width: 100vw;
  /* 占满整个宽度 */
  height: 100vh;
  /* 占满整个高度 */
  margin: 0;
  padding: 0;
}

.header {
  user-select: none;
  -webkit-app-region: drag;
  pointer-events: auto;
  margin: 0;
  height: 36px;
  line-height: 36px;
  text-align: center;
  background-color: var(--glass-bg-low) !important;
  border-bottom: 1px solid var(--glass-border) !important;
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.15),
    var(--glass-highlight);
}

.content {
  height: calc(100vh - 36px);
}

.left {
  width: 68px;
  min-width: 68px;
  background-color: var(--bg-base) !important;
  border-right: 1px solid var(--glass-border) !important;
  overflow: hidden;
}

.left :deep(.n-layout-sider-scroll-container) {
  overflow: hidden !important;
}

.left :deep(.n-scrollbar-rail) {
  display: none !important;
}

/* 页面切换过渡 */
.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
