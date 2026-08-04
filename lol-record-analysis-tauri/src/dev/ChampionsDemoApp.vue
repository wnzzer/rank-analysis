<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <router-view />
  </n-config-provider>
</template>

<script setup lang="ts">
import { darkTheme, NConfigProvider } from 'naive-ui'
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
