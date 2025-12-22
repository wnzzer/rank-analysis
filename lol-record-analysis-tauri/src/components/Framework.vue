<template>
  <div class="full-container">
    <n-flex vertical size="large">
      <!-- 整体布局 -->
      <n-layout>
        <!-- 顶部区域 -->
        <n-layout-header class="header">
          <Header></Header>
        </n-layout-header>
        <n-divider style="margin: 1px 0; line-height: 1px" />

        <!-- 中间部分：左侧导航 + 内容区域 -->
        <n-layout has-sider class="content" style="width: 100%">
          <!-- 左侧导航 -->
          <n-layout-sider collapse-mode="width" class="left" style="width: 60px">
            <SideNavigation />
          </n-layout-sider>
          <n-divider vertical :style="dividerStyle" />
          <!-- 内容区域 -->
          <n-layout-content :style="contentStyle">
            <router-view :key="$route.fullPath"></router-view>
          </n-layout-content>
        </n-layout>
      </n-layout>
    </n-flex>
  </div>
</template>

<script lang="ts" setup>
import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import { useSettingsStore } from '../pinia/setting'
import { computed } from 'vue'

const settingsStore = useSettingsStore()
const isDark = computed(() => settingsStore.theme?.name === 'dark')

const contentStyle = computed(() => ({
  backgroundColor: isDark.value ? '#101014' : '#f5f7fa'
}))

const dividerStyle = computed(() => ({
  margin: '0 1px',
  lineHeight: '5px',
  height: '100%',
  borderColor: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
  borderWidth: '2px'
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
  /* 设置该属性表明这是可拖拽区域，用来移动窗口 */
  -webkit-app-region: drag;
  pointer-events: auto;
  margin: 0;
  height: 40px;
  line-height: 40px;
  text-align: center;
}

.content {
  height: calc(100vh - 40px);
}

.left {
  width: 60px;
  min-width: 60px;
}
</style>
