<template>
    <div class="loading-container">
      <n-icon class="loading-icon" size="40">
        <ion-icon name="reload-outline"></ion-icon>
      </n-icon>
      <span>加载中...</span>
    </div>
  </template>
  
  <script lang="ts" setup>
  import 'https://unpkg.com/ionicons@5.5.2/dist/ionicons.js';
  </script>
  
  <style scoped>
  /* 外部容器样式 */
  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  
  /* 图标旋转动画 */
  .loading-icon {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
  </style>
  