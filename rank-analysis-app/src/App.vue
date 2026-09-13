<template>
  <n-config-provider :theme="settingsStore.theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-notification-provider>
        <n-dialog-provider>
          <Framework></Framework>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script lang="ts" setup>
import Framework from '@renderer/components/Framework.vue'
import { useSettingsStore } from '@renderer/pinia/setting'
import { syncThemeClass, useTheme } from '@renderer/composables/useTheme'
import { buildThemeOverrides } from '@renderer/theme/overrides'
import { computed } from 'vue'
import { GlobalThemeOverrides } from 'naive-ui'

const settingsStore = useSettingsStore()
const { isDark } = useTheme()
// theme-light 挂 <html>：浮层也能取到亮色 token（见 syncThemeClass）
syncThemeClass(isDark)

/**
 * naive 主题覆盖：颜色全部从 <html> 上的 token 读取（单一数据源 global.css）。
 * 读 isDark 只为建立依赖——类已由 syncThemeClass 同步翻到 <html>，此时读到的就是新主题值
 */
const themeOverrides = computed<GlobalThemeOverrides>(() => {
  void isDark.value
  return buildThemeOverrides()
})
</script>
<style lang="css">
html,
body {
  margin: 0;
  /* 禁止 html,body 滚动，避免滚动条出现在标题栏右边 */
  overflow: hidden;
}

.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-base);
  color: var(--text-primary);
}

.custom-titlebar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 35px;
  width: 100%;
  z-index: 9999;
  background-color: var(--bg-surface);
  color: var(--text-primary);
  padding-left: var(--space-12);
  font-size: var(--font-size-md);
}

.content {
  /* 内容区需要设置可滚动 */
  overflow: auto;
}
</style>
