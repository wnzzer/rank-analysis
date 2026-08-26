<template>
  <div class="full-container">
    <!-- 启动弹窗队列：同一时刻至多一个可见，顺序见 useStartupDialogs。
         云端配置拉取裁决（CloudConfigPullDialog）不再走这里自动弹出，改成
         设置页「数据与同步」里的被动角标引导入口，见 views/settings/DataSync.vue -->
    <ErrorReportingConsentDialog
      :show="active === 'errorReportingConsent'"
      @decide="onConsentDecide"
    />

    <TopBar @open-palette="paletteShow = true" />
    <div class="shellv2">
      <NavRail />
      <main class="shellv2__content">
        <!-- 路由级错误兜底：渲染异常不再无声白屏，给出可重试的出口 -->
        <div v-if="routeError" class="route-error">
          <CornerCard title="页面出错了" class="route-error__card">
            <p class="route-error__msg">{{ routeError }}</p>
            <div class="route-error__acts">
              <button class="btn gho sm" title="复制错误信息用于反馈" @click="copyError">
                复制错误信息
              </button>
              <button class="btn pri sm" @click="retryRoute">重试</button>
            </div>
          </CornerCard>
        </div>
        <router-view v-else v-slot="{ Component }">
          <Transition v-if="!isSettingsRoute" name="page" mode="out-in">
            <component :is="Component" :key="$route.fullPath + '-' + renderKey" />
          </Transition>
          <component v-else :is="Component" :key="$route.fullPath + '-' + renderKey" />
        </router-view>
      </main>
    </div>
    <CommandPalette v-model:show="paletteShow" />
  </div>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'

import TopBar from './shell/TopBar.vue'
import NavRail from './shell/NavRail.vue'
import CommandPalette from './shell/CommandPalette.vue'
import CornerCard from './ui/CornerCard.vue'
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

/* 路由级错误兜底：捕获子树渲染错误，展示可重试卡片而非无声白屏 */
const routeError = ref<string | null>(null)
const renderKey = ref(0)
onErrorCaptured(err => {
  routeError.value = err instanceof Error ? err.message : String(err)
  return false
})
function retryRoute() {
  routeError.value = null
  renderKey.value += 1
}
async function copyError(): Promise<void> {
  try {
    await navigator.clipboard.writeText(routeError.value ?? '')
    message.success('错误信息已复制')
  } catch {
    /* 剪贴板不可用静默 */
  }
}
watch(
  () => route.fullPath,
  () => {
    if (routeError.value) retryRoute()
  }
)

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

// AI 搭子桥（C2）：应用级单例，对局中周期拉取事件 → 台词 → 浮窗气泡。
// 桥内部自带阶段过滤与非对局静默，常驻开销可忽略。
import { startLiveBridge } from '@renderer/companion/bridge'
const liveBridge = startLiveBridge()
onMounted(() => liveBridge.start())
onUnmounted(() => liveBridge.stop())

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

/* 页面切换过渡：位移 + 微缩 + 轻模糊，一次导航 250ms 内完成（合成器友好） */
.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo),
    filter var(--dur-normal) var(--ease-expo);
  will-change: opacity, transform;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.995);
  filter: blur(3px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.997);
  filter: blur(2px);
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: opacity var(--dur-instant) linear;
    filter: none;
  }
  .page-enter-from,
  .page-leave-to {
    transform: none;
    filter: none;
  }
}

/* 路由错误兜底卡 */
.route-error {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-24);
}
.route-error__card {
  max-width: 460px;
  width: 100%;
  text-align: center;
}
.route-error__msg {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  word-break: break-all;
  margin-bottom: var(--space-12);
}
.route-error__acts {
  display: flex;
  justify-content: center;
  gap: var(--space-8);
  margin-top: var(--space-4);
}
.route-error__retry {
  background: var(--brand-gradient);
  color: var(--text-on-brand);
  border: none;
}
</style>
