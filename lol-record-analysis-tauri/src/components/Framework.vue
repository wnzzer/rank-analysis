<template>
  <div class="full-container">
    <n-flex vertical size="large">
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

<script lang="ts" setup>
import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useGameState } from '../composables/useGameState'

const route = useRoute()
const isSettingsRoute = computed(() => route.path.startsWith('/Settings'))

// 使用 GameState composable，其中包含了自动跳转逻辑
useGameState()

onMounted(() => {
  // Framework mounted
})

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
  background-color: var(--bg-surface) !important;
  border-bottom: 1px solid var(--border-subtle) !important;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.06);
}

.content {
  height: calc(100vh - 36px);
}

.left {
  width: 68px;
  min-width: 68px;
  background-color: var(--bg-base) !important;
  border-right: 1px solid var(--border-subtle) !important;
}

/* 页面切换过渡 */
.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--transition-normal),
    transform var(--transition-normal);
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
