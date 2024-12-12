<template>
  <div full-container>
    <n-space vertical size="large" >
    <!-- 整体布局 -->
    <n-layout style="height: 100%; flex-direction: column;">
      <!-- 顶部区域 -->
      <n-layout-header class="header" >
        <Header></Header>
      </n-layout-header>
      <n-divider style="margin: 4px 0; line-height: 1px;" />
      
      <!-- 中间部分：左侧导航 + 内容区域 -->
      <n-layout has-sider style="flex: 1; display: flex;">
        <!-- 左侧导航 -->
        <n-layout-sider style="width: 60px; padding: 16px; height: 100%;">
          左
        </n-layout-sider>
        
        <!-- 内容区域 -->
        <n-layout-content style="padding: 24px; height: 100%;">
          主内容区域
        </n-layout-content>
      </n-layout>
    </n-layout>
  </n-space>
  </div>
</template>

<script lang="ts" setup>
import Header from './Header.vue';
</script>
<style scoped>
.full-container {
  width: 100vw; /* 占满整个宽度 */
  height: 100vh; /* 占满整个高度 */
  margin: 0;
  padding: 0;
  display: flex; /* 可选，用于灵活布局 */
  justify-content: center; /* 水平方向居中（可选） */
  align-items: center; /* 垂直方向居中（可选） */
}
.header{
  user-select: none;
    /* 设置该属性表明这是可拖拽区域，用来移动窗口 */
    -webkit-app-region: drag;
    pointer-events: auto;
    margin: 0; height: 40px; line-height: 40px; text-align: center;
}
</style>