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
import Framework from '../src/components/Framework.vue'
import { useSettingsStore } from './pinia/setting'
import { computed } from 'vue'
import { GlobalThemeOverrides } from 'naive-ui'

const settingsStore = useSettingsStore()

const isDark = computed(() => {
  const name = settingsStore.theme?.name
  return name === 'Dark' || name === 'dark'
})

const themeOverrides = computed<GlobalThemeOverrides>(() => {
  if (isDark.value) {
    return {
      common: {
        borderRadius: '8px',
        borderRadiusSmall: '6px'
      },
      Card: {
        borderRadius: '8px',
        color: '#1a1a1e',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        borderColor: 'rgba(255,255,255,0.06)'
      },
      Input: {
        borderRadius: '8px',
        color: '#1a1a1e',
        border: '1px solid rgba(255,255,255,0.06)'
      },
      Button: {
        borderRadiusSmall: '6px',
        borderRadiusMedium: '8px'
      },
      Select: {
        borderRadius: '8px'
      },
      Layout: {
        color: '#0d0d0f'
      },
      Menu: {
        itemColorActive: 'rgba(255,255,255,0.1)',
        itemColorActiveHover: 'rgba(255,255,255,0.14)',
        itemBorderRadius: '8px'
      }
    }
  }
  return {
    common: {
      borderRadius: '8px',
      borderRadiusSmall: '6px'
    },
    Card: {
      borderRadius: '8px',
      color: '#ffffff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      borderColor: 'rgba(0,0,0,0.08)'
    },
    Input: {
      borderRadius: '8px',
      border: '1px solid rgba(0,0,0,0.08)'
    },
    Button: {
      borderRadiusSmall: '6px',
      borderRadiusMedium: '8px'
    },
    Select: {
      borderRadius: '8px'
    },
    Layout: {
      color: '#f6f9f8'
    },
    Menu: {
      itemColorActive: 'rgba(0,0,0,0.06)',
      itemColorActiveHover: 'rgba(0,0,0,0.1)',
      itemBorderRadius: '8px'
    }
  }
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
  padding-left: 12px;
  font-size: 14px;
}

.content {
  /* 内容区需要设置可滚动 */
  overflow: auto;
}
</style>
