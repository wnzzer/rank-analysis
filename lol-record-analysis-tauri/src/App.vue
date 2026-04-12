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
import { useSettingsStore } from '@renderer/pinia/setting'
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
        borderRadius: '10px',
        color: 'rgba(255,255,255,0.05)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.09)'
      },
      Input: {
        borderRadius: '8px',
        color: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)'
      },
      Button: {
        borderRadiusSmall: '6px',
        borderRadiusMedium: '8px'
      },
      Select: {
        borderRadius: '8px'
      },
      Layout: {
        color: '#0a0a0d'
      },
      Menu: {
        itemColorActive: 'rgba(61,155,122,0.14)',
        itemColorActiveHover: 'rgba(61,155,122,0.18)',
        itemBorderRadius: '10px',
        itemTextColorActive: '#3d9b7a',
        itemIconColorActive: '#3d9b7a'
      }
    }
  }
  return {
    common: {
      borderRadius: '8px',
      borderRadiusSmall: '6px'
    },
    Card: {
      borderRadius: '10px',
      color: 'rgba(0,0,0,0.035)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
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
      color: '#f0f2f5'
    },
    Menu: {
      itemColorActive: 'rgba(45,138,108,0.12)',
      itemColorActiveHover: 'rgba(45,138,108,0.18)',
      itemBorderRadius: '10px',
      itemTextColorActive: '#2d8a6c',
      itemIconColorActive: '#2d8a6c'
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
