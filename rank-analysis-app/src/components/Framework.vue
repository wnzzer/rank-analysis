<template>
  <div class="full-container">
    <!-- 启动弹窗队列：同一时刻至多一个可见，顺序见 useStartupDialogs。
         云端配置拉取裁决（CloudConfigPullDialog）不再走这里自动弹出，改成
         设置页「数据与同步」里的被动角标引导入口，见 views/settings/DataSync.vue -->
    <ErrorReportingConsentDialog :show="active === 'errorReportingConsent'" @decide="onConsentDecide" />

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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'

import TopBar from './shell/TopBar.vue'
import NavRail from './shell/NavRail.vue'
import CommandPalette from './shell/CommandPalette.vue'
import ErrorReportingConsentDialog from '@renderer/components/common/ErrorReportingConsentDialog.vue'
import { useGameState } from '@renderer/composables/useGameState'
import { useWindowShortcuts } from '@renderer/composables/useWindowShortcuts'
import { useZoom } from '@renderer/composables/useZoom'
import { useStartupDialogs } from '@renderer/composables/useStartupDialogs'

/**
 * 应用主布局框架组件（v3 壳层：舰桥导航 + 三段顶栏 + 命令面板）。
 * 共享职责（游戏状态监听 / 缩放 / 快捷键 / 启动弹窗队列）在此统一挂载。
 */

const route = useRoute()

/** 命令面板显隐：顶栏搜索按钮与 Ctrl+K（面板内部监听）都会打开 */
const paletteShow = ref(false)

/**
 * 判断当前路由是否为设置页面
 * 设置页面不使用页面切换动画，避免过渡效果干扰表单交互
 */
const isSettingsRoute = computed(() => route.path.startsWith('/Settings'))

useGameState()

// 浏览器式缩放（Ctrl+滚轮 / Ctrl±0）：页面级缩放，全窗口生效
useZoom()

// 多窗口快捷键（Ctrl+W 关子窗 / Ctrl+Tab 切窗）：主窗与战绩子窗共用
useWindowShortcuts()

const message = useMessage()

const { active, resolveErrorReportingConsent } = useStartupDialogs()

async function onConsentDecide(enabled: boolean): Promise<void> {
  try {
    await resolveErrorReportingConsent(enabled)
    if (enabled) message.success('已开启，重启后生效')
  } catch {
    message.error('保存失败')
  }
}
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

/* ===== 旧壳层样式已随 Header/SideNavigation 一并移除（P4） ===== */

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
