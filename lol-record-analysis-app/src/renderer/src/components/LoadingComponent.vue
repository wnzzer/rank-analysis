<template>
  <div
      style="display: flex; justify-content: center; align-items: center; height: 95vh; width: 95vw; border: 1px solid black;">

      <div style="position: relative;">
          <span class="clip"><slot></slot></span>
          <span> <!-- 渲染图标 -->
              <n-icon size="20" class="rotating-icon" style="position: relative; top: 2px;;">
                  <Reload />
              </n-icon></span>
      </div>

  </div>
</template>
<script lang="ts" setup>
import { Reload } from '@vicons/ionicons5';
</script>

<style lang="css" scoped>
.clip {
  background: linear-gradient(120deg, hwb(189 2% 6%) 30%, hsl(30deg, 100%, 50%));
  color: transparent;
  background-clip: text;
  font-weight: 600;
  font-size: 16px;
}

@keyframes rotate {
  0% {
      transform: rotate(0deg);
  }

  100% {
      transform: rotate(360deg);
  }
}



.rotating-icon {
  animation: rotate 2s linear infinite;
}
</style>