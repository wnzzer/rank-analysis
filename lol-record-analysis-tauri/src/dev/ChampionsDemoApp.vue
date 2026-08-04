<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <Champions demo />
  </n-config-provider>
</template>

<script setup lang="ts">
import { darkTheme, NConfigProvider } from 'naive-ui'
import Champions from '@renderer/views/Champions.vue'
import { buildThemeOverrides } from '@renderer/theme/overrides'

const themeOverrides = buildThemeOverrides(true)
</script>

<style>
html,
body,
#app {
  min-height: 100%;
  margin: 0;
  background: var(--bg-base);
}
</style>
