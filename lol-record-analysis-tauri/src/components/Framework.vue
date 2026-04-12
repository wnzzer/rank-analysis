<template>
  <div class="full-container">
    <MatchDetail v-if="isStandaloneDetailWindow" />
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
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'

import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import MatchDetail from '@renderer/views/MatchDetail.vue'
import { useGameState } from '@renderer/composables/useGameState'

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
useGameState()

onMounted(() => {
  // Framework mounted
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
