<template>
  <div full-container>
    <n-space vertical size="large" >
    <!-- 整体布局 -->
    <n-layout style="height: 100%; ">
      <!-- 顶部区域 -->
      <n-layout-header class="header" >
        <Header></Header>
      </n-layout-header>
      <n-divider style="margin: 1px 0; line-height: 1px;" />
      
      <!-- 中间部分：左侧导航 + 内容区域 -->
      <n-layout has-sider  style="width: 100vh; ">
        <!-- 左侧导航 -->
        <n-layout-sider  collapse-mode="width" class="left"  style="width: 60px; height: 100vh; ">
          <SideNavigation></SideNavigation>
        </n-layout-sider>
        <n-divider vertical style="margin: 0 1px; line-height: 1px; height: 100vh;" />
        <!-- 内容区域 -->
        <n-layout-content >
                         <router-view></router-view>
        </n-layout-content>
      </n-layout>
    </n-layout>
  </n-space>
  </div>
</template>

<script lang="ts" setup>
import Header from './Header.vue';
import SideNavigation from './SideNavigation.vue';

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
.left{
  width: 60px;
  min-width: 60px;
}
</style>