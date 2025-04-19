<template>
  <n-config-provider :theme="settingsStore.theme">
    <n-message-provider>

      <n-loading-bar-provider>
        <Framework></Framework>
        </n-loading-bar-provider>

    </n-message-provider>
  </n-config-provider>
</template>

<script lang="ts" setup>
import Framework from '../src/components/Framework.vue'
import { useSettingsStore } from './pinia/setting';

const settingsStore = useSettingsStore()
</script>
<style lang="css">
html,
body {
  margin: 0;
  /* 禁止 html,body 滚动，避免滚动条出现在标题栏右边 */
  overflow: hidden;
}

.root {
  /* 使用 flex 来实现 */
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: black;
  color: white;
}

.custom-titlebar {
  display: flex;
  align-items: center;
  /* 避免被收缩 */
  flex-shrink: 0;
  /* 高度与 main.js 中 titleBarOverlay.height 一致  */
  height: 35px;
  width: 100%;
  /* 标题栏始终在最顶层（避免后续被 Modal 之类的覆盖） */
  z-index: 9999;

  background-color: #23272e;
  color: white;
  padding-left: 12px;
  font-size: 14px;
}

.content {
  /* 内容区需要设置可滚动 */
  overflow: auto;
}
</style>