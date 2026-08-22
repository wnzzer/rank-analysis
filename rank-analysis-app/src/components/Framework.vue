<template>
  <div class="full-container">
    <!-- 启动弹窗队列：同一时刻至多一个可见，顺序见 useStartupDialogs。
         云端配置拉取裁决（CloudConfigPullDialog）不再走这里自动弹出，改成
         设置页「数据与同步」里的被动角标引导入口，见 views/settings/DataSync.vue -->
    <ErrorReportingConsentDialog :show="active === 'errorReportingConsent'" @decide="onConsentDecide" />

    <!-- ============ v2 壳层：舰桥导航 + 顶栏（flags.shellV2，P4 移除分支） ============ -->
    <template v-if="SHELL_V2">
      <TopBar @open-palette="paletteShow = true" />
      <div class="shellv2">
        <NavRail />
        <main class="shellv2__content">
          <router-view v-slot="{ Component }">
            <Transition v-if="!isSettingsRoute" name="page" mode="out-in">
              <component :is="Component" :key="$route.fullPath" />
            </Transition>
            <component v-else :is="Component" :key="$route.fullPath" />
          </router-view>
        </main>
      </div>
      <CommandPalette v-model:show="paletteShow" />
    </template>

    <!-- ============ 旧壳层（flag 关闭时回退；P4 整块删除） ============ -->
    <n-flex v-else vertical size="large">
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
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'

import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import TopBar from './shell/TopBar.vue'
import NavRail from './shell/NavRail.vue'
import CommandPalette from './shell/CommandPalette.vue'
import ErrorReportingConsentDialog from '@renderer/components/common/ErrorReportingConsentDialog.vue'
import { SHELL_V2 } from '../flags'
import { useGameState } from '@renderer/composables/useGameState'
import { useWindowShortcuts } from '@renderer/composables/useWindowShortcuts'
import { useZoom } from '@renderer/composables/useZoom'
import { useStartupDialogs } from '@renderer/composables/useStartupDialogs'

/**
 * 应用主布局框架组件
 *
 * v3 重构期双壳并存（flags.SHELL_V2 切换）：
 * - v2：TopBar + NavRail + CommandPalette + 内容区；
 * - v1（旧）：36px Header + 68px SideNavigation，保持原样以便回退。
 * 共享职责（游戏状态监听 / 缩放 / 快捷键 / 启动弹窗队列）对两壳一视同仁。
 */

const route = useRoute()

/** 命令面板显隐：顶栏搜索按钮与 Ctrl+K（面板内部监听）都会打开 */
const paletteShow = ref(false)

/**
 * 判断当前路由是否为设置页面
 * 设置页面不使用页面切换动画，避免过渡效果干扰表单交互
 */
const isSettingsRoute = computed(() => route.path.startsWith('/Settings'))

/**
 * 初始化游戏状态监听
 * 包含自动跳转逻辑：当检测到游戏开始时自动切换到对局页面
 */
useGameState()

// 浏览器式缩放（Ctrl+滚轮 / Ctrl±0）：页面级缩放，全窗口生效
useZoom()

// 多窗口快捷键（Ctrl+W 关子窗 / Ctrl+Tab 切窗）：主窗与战绩子窗共用
useWindowShortcuts()

const message = useMessage()

/**
 * 启动弹窗队列：谁先弹、谁让位、什么时候弹，全部收敛在 useStartupDialogs 里。
 * 本组件只负责渲染和用户可见反馈（toast / 路由跳转）。
 */
const { active, resolveErrorReportingConsent } = useStartupDialogs()

/**
 * 错误上报同意弹窗的用户选择。无论选择什么都标记"已问过"，之后不再弹。
 * @param enabled - true 启用上报，false 保持关闭
 */
async function onConsentDecide(enabled: boolean): Promise<void> {
  try {
    await resolveErrorReportingConsent(enabled)
    if (enabled) message.success('已开启，重启后生效')
  } catch {
    message.error('保存失败')
  }
}

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
  display: flex;
  flex-direction: column;
}

/* ===== v2 壳层布局 ===== */
.shellv2 {
  flex: 1;
  min-height: 0;
  display: flex;
}
.shellv2__content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--bg-base);
}

/* ===== 旧壳层（P4 删除） ===== */
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
}.left {
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
