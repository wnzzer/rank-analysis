<template>
  <n-config-provider
    :theme="settingsStore.theme"
    :theme-overrides="themeOverrides"
    :class="{ 'theme-light': !isDark }"
  >
    <n-message-provider>
      <n-notification-provider>
        <n-dialog-provider>
          <n-loading-bar-provider>
            <Framework></Framework>
          </n-loading-bar-provider>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script lang="ts" setup>
import Framework from '@renderer/components/Framework.vue'
import { useSettingsStore } from '@renderer/features/settings/stores/setting'
import { useTheme } from '@renderer/composables/useTheme'
import { buildThemeOverrides } from '@renderer/theme/overrides'
import { computed, watch } from 'vue'
import { GlobalThemeOverrides } from 'naive-ui'

const settingsStore = useSettingsStore()
const { isDark } = useTheme()

const themeOverrides = computed<GlobalThemeOverrides>(() => buildThemeOverrides(isDark.value))

// naive 弹层（popover/tooltip/dropdown）默认 teleport 到 body（#app 组件树之外），
// 浅色变量若只挂在组件树上，弹层里 var(--text-primary) 会回落到 :root 的深色
// 白字 → 浅色主题下弹层白底白字看不清。把主题 class 同步挂到 <html>，让
// :root.theme-light 的变量作用域覆盖整个文档。
watch(
  isDark,
  v => {
    const el = document.documentElement
    el.classList.toggle('theme-light', !v)
    el.classList.toggle('theme-dark', v)
  },
  { immediate: true }
)
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
